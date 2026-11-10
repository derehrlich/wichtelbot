// Die eigentliche Logik: Anmeldung, Teilnehmer, Auslosung. Kein HTTP hier, damit man es gut testen kann.
import { createHash, randomBytes } from 'node:crypto';
import { draw } from './draw.mjs';
import * as T from './templates.mjs';

const LOGIN_MINUTES = 30;
const SESSION_DAYS = 14;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const clean = (s, max) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

export function createService({ db, mailer, siteUrl, adminEmails = [], now = () => new Date(), rng = Math.random }) {
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const iso = (d = now()) => d.toISOString();
  const plusMinutes = (m) => iso(new Date(now().getTime() + m * 60000));
  const lastLoginMail = new Map(); // userId -> ms, einfacher Schutz gegen Mail-Flut

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    users: db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE'),
    latestRound: db.prepare('SELECT * FROM rounds ORDER BY drawn_at DESC, id DESC LIMIT 1'),
    roundByYear: db.prepare('SELECT * FROM rounds WHERE year = ? ORDER BY id DESC LIMIT 1'),
    roundBefore: db.prepare('SELECT * FROM rounds WHERE year < ? ORDER BY year DESC, id DESC LIMIT 1'),
    assignmentsOf: db.prepare('SELECT * FROM assignments WHERE round_id = ?'),
    assignmentFor: db.prepare('SELECT * FROM assignments WHERE round_id = ? AND giver_id = ?'),
    assignmentByToken: db.prepare(
      `SELECT a.*, r.year, u.name AS receiver_name, u.wishes, u.no_gos, u.budget, u.wishes_updated_at, g.name AS giver_name
         FROM assignments a JOIN rounds r ON r.id = a.round_id
         JOIN users u ON u.id = a.receiver_id JOIN users g ON g.id = a.giver_id WHERE a.token = ?`,
    ),
    exclusions: db.prepare('SELECT a, b FROM exclusions'),
  };

  const isAdmin = (user) => Boolean(user && admins.has(user.email.toLowerCase()));
  const wichtelUrl = (token) => `${siteUrl}/wichtel/${token}`;

  // ---------- Anmeldung per Link ----------
  function createLoginUrl(user) {
    const token = newToken();
    db.prepare('INSERT INTO login_tokens (hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), user.id, plusMinutes(LOGIN_MINUTES));
    return `${siteUrl}/anmelden?token=${token}`;
  }

  async function mailLoginLink(user, template = T.loginMail) {
    const url = createLoginUrl(user);
    await mailer.send({ to: user.email, ...template({ siteUrl, name: user.name, url, hasWishes: Boolean(user.wishes) }) });
  }

  /** Antwort ist immer gleich, egal ob es die Adresse gibt (verrät nicht, wer teilnimmt). */
  async function requestLogin(email) {
    const user = q.userByEmail.get(clean(email, 200));
    if (!user) return;
    const last = lastLoginMail.get(user.id) ?? 0;
    if (now().getTime() - last < 60000) return;
    lastLoginMail.set(user.id, now().getTime());
    await mailLoginLink(user);
  }

  function consumeLoginToken(token) {
    const row = db.prepare('SELECT * FROM login_tokens WHERE hash = ?').get(sha(String(token ?? '')));
    if (!row) return null;
    db.prepare('DELETE FROM login_tokens WHERE hash = ?').run(row.hash);
    if (row.expires_at < iso()) return null;
    db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(iso());
    const session = newToken();
    db.prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha(session), row.user_id, plusMinutes(SESSION_DAYS * 24 * 60),
    );
    return { session, maxAgeSeconds: SESSION_DAYS * 86400 };
  }

  function userFromSession(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE hash = ?').get(sha(token));
    if (!row || row.expires_at < iso()) return null;
    return q.userById.get(row.user_id) ?? null;
  }

  function logout(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(token));
  }

  // ---------- Profil ----------
  const profile = (u) => ({
    id: u.id, name: u.name, email: u.email, active: Boolean(u.active),
    wishes: u.wishes, noGos: u.no_gos, budget: u.budget, wishesUpdatedAt: u.wishes_updated_at,
  });

  function updateProfile(userId, f) {
    const cur = q.userById.get(userId);
    if (!cur) throw new UserError('Person nicht gefunden', 404);
    const name = f.name === undefined ? cur.name : clean(f.name, 80);
    if (!name) throw new UserError('Bitte einen Namen angeben');
    const wishes = f.wishes === undefined ? cur.wishes : clean(f.wishes, 3000);
    const noGos = f.noGos === undefined ? cur.no_gos : clean(f.noGos, 1000);
    const budget = f.budget === undefined ? cur.budget : clean(f.budget, 100);
    const touched = wishes !== cur.wishes || noGos !== cur.no_gos || budget !== cur.budget;
    db.prepare('UPDATE users SET name=?, wishes=?, no_gos=?, budget=?, wishes_updated_at=? WHERE id=?').run(
      name, wishes, noGos, budget, touched ? iso() : cur.wishes_updated_at, userId,
    );
    return profile(q.userById.get(userId));
  }

  // ---------- Runden ----------
  const latestRound = () => q.latestRound.get() ?? null;

  function roundInfoFor(userId) {
    const round = latestRound();
    if (!round) return { drawn: false };
    const mine = q.assignmentFor.get(round.id, userId);
    return { drawn: true, year: round.year, drawnAt: round.drawn_at, participating: Boolean(mine) };
  }

  function meState(user) {
    return { user: profile(user), isAdmin: isAdmin(user), round: roundInfoFor(user.id) };
  }

  async function mailAssignment(round, assignment, { redo = false } = {}) {
    const giver = q.userById.get(assignment.giver_id);
    const receiver = q.userById.get(assignment.receiver_id);
    await mailer.send({
      to: giver.email,
      ...T.drawMail({
        siteUrl, name: giver.name, receiverName: receiver.name, year: round.year,
        wichtelUrl: wichtelUrl(assignment.token), redo,
      }),
    });
  }

  /** Per Mail verschickt, falls jemand die Mail verloren hat. Höchstens alle 10 Minuten. */
  async function resendMyAssignment(userId) {
    const round = latestRound();
    const a = round && q.assignmentFor.get(round.id, userId);
    if (!a) throw new UserError('Du bist in der aktuellen Auslosung nicht dabei.', 404);
    const key = `resend-${round.id}`;
    const row = db.prepare('SELECT sent_at FROM mail_log WHERE key = ? AND user_id = ?').get(key, userId);
    if (row && row.sent_at > plusMinutes(-10)) throw new UserError('Die Mail ist gerade erst rausgegangen. Schau bitte auch im Spam-Ordner.', 429);
    await mailAssignment(round, a);
    db.prepare('INSERT OR REPLACE INTO mail_log (key, user_id, sent_at) VALUES (?, ?, ?)').run(key, userId, iso());
  }

  function wichtelByToken(token) {
    const a = q.assignmentByToken.get(String(token ?? ''));
    if (!a) return null;
    return {
      year: a.year, receiverName: a.receiver_name, wishes: a.wishes, noGos: a.no_gos, budget: a.budget,
      wishesUpdatedAt: a.wishes_updated_at,
    };
  }

  // ---------- Verwaltung (nur Admin) ----------
  function adminState() {
    const round = latestRound();
    const inRound = new Set(round ? q.assignmentsOf.all(round.id).map((a) => a.giver_id) : []);
    return {
      mailConfigured: mailer.configured,
      round: round ? { year: round.year, drawnAt: round.drawn_at } : null,
      users: q.users.all().map((u) => ({ ...profile(u), isAdmin: isAdmin(u), inRound: inRound.has(u.id) })),
      exclusions: q.exclusions.all(),
    };
  }

  async function addUser({ name, email }) {
    name = clean(name, 80);
    email = clean(email, 200).toLowerCase();
    if (!name) throw new UserError('Bitte einen Namen angeben');
    if (!EMAIL_RE.test(email)) throw new UserError('Die E-Mail-Adresse sieht nicht richtig aus');
    if (q.userByEmail.get(email)) throw new UserError('Diese E-Mail-Adresse gibt es schon', 409);
    const info = db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)').run(email, name, iso());
    const user = q.userById.get(Number(info.lastInsertRowid));
    await mailLoginLink(user, T.inviteMail);
    return profile(user);
  }

  async function inviteAgain(userId) {
    const user = q.userById.get(userId);
    if (!user) throw new UserError('Person nicht gefunden', 404);
    await mailLoginLink(user, T.inviteMail);
  }

  function adminUpdateUser(userId, f) {
    const cur = q.userById.get(userId);
    if (!cur) throw new UserError('Person nicht gefunden', 404);
    if (f.email !== undefined) {
      const email = clean(f.email, 200).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new UserError('Die E-Mail-Adresse sieht nicht richtig aus');
      const other = q.userByEmail.get(email);
      if (other && other.id !== userId) throw new UserError('Diese E-Mail-Adresse gibt es schon', 409);
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    }
    if (f.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(f.active ? 1 : 0, userId);
    return updateProfile(userId, f);
  }

  function deleteUser(userId) {
    const u = q.userById.get(userId);
    if (!u) throw new UserError('Person nicht gefunden', 404);
    if (isAdmin(u)) throw new UserError('Der Organisator kann nicht gelöscht werden');
    const round = latestRound();
    if (round && db.prepare('SELECT 1 FROM assignments WHERE round_id = ? AND (giver_id = ? OR receiver_id = ?)').get(round.id, userId, userId)) {
      throw new UserError('Die Person steckt in der aktuellen Auslosung. Setze sie lieber auf „nimmt nicht teil“ oder lose neu aus.', 409);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  function addExclusion(x, y) {
    x = Number(x); y = Number(y);
    if (!q.userById.get(x) || !q.userById.get(y) || x === y) throw new UserError('Bitte zwei verschiedene Personen wählen');
    db.prepare('INSERT OR IGNORE INTO exclusions (a, b) VALUES (?, ?)').run(Math.min(x, y), Math.max(x, y));
  }

  function removeExclusion(x, y) {
    db.prepare('DELETE FROM exclusions WHERE a = ? AND b = ?').run(Math.min(Number(x), Number(y)), Math.max(Number(x), Number(y)));
  }

  /** Lost aus und verschickt die Mails. `redo` ersetzt eine schon vorhandene Auslosung dieses Jahres. */
  async function runDraw({ redo = false } = {}) {
    const year = now().getFullYear();
    const existing = q.roundByYear.get(year);
    if (existing && !redo) throw new UserError(`Für ${year} wurde schon ausgelost. Zum Neu-Auslosen bitte bestätigen.`, 409);

    const people = q.users.all().filter((u) => u.active);
    if (people.length < 3) throw new UserError('Zum Auslosen braucht es mindestens 3 Personen, die teilnehmen.');

    const forbidden = new Set();
    for (const { a, b } of q.exclusions.all()) { forbidden.add(`${a}>${b}`); forbidden.add(`${b}>${a}`); }

    // Niemand bekommt zwei Jahre hintereinander dieselbe Person (wenn es aufgeht, sonst ohne diese Regel).
    const prev = q.roundBefore.get(year);
    const lastYear = new Set(prev ? q.assignmentsOf.all(prev.id).map((a) => `${a.giver_id}>${a.receiver_id}`) : []);
    const ids = people.map((u) => u.id);
    let result = draw(ids, new Set([...forbidden, ...lastYear]), rng);
    let relaxed = false;
    if (!result && lastYear.size) { result = draw(ids, forbidden, rng); relaxed = Boolean(result); }
    if (!result) throw new UserError('Mit diesen Ausnahmen geht die Auslosung nicht auf. Bitte ein paar Ausnahmen entfernen.');

    let roundId;
    db.exec('BEGIN');
    try {
      if (existing) db.prepare('DELETE FROM rounds WHERE id = ?').run(existing.id);
      const info = db.prepare('INSERT INTO rounds (year, drawn_at) VALUES (?, ?)').run(year, iso());
      roundId = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO assignments (round_id, giver_id, receiver_id, token) VALUES (?, ?, ?, ?)');
      for (const [g, r] of result) ins.run(roundId, g, r, newToken());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);

    const failed = [];
    for (const a of q.assignmentsOf.all(roundId)) {
      try { await mailAssignment(round, a, { redo: Boolean(existing) }); }
      catch (e) { failed.push(q.userById.get(a.giver_id).name); console.error(e.message); }
    }
    return { year, count: result.size, relaxed, mailFailed: failed };
  }

  /** Nur für Tests und Erinnerungen. */
  const internals = { q, mailAssignment, wichtelUrl, mailLoginLink, createLoginUrl };

  /** Legt die Organisatoren an, falls es sie noch nicht gibt, damit sie sich anmelden können. */
  function ensureAdmins() {
    for (const email of admins) {
      if (q.userByEmail.get(email)) continue;
      const name = email.split('@')[0].replace(/[._-]+/g, ' ');
      db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)').run(email, name.charAt(0).toUpperCase() + name.slice(1), iso());
    }
  }

  return {
    ensureAdmins, requestLogin, consumeLoginToken, userFromSession, logout, isAdmin, meState, updateProfile,
    resendMyAssignment, wichtelByToken, adminState, addUser, inviteAgain, adminUpdateUser, deleteUser,
    addExclusion, removeExclusion, runDraw, latestRound, internals, now,
  };
}
