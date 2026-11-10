// Automatische Erinnerungen. Termine und Uhrzeit stellt der Organisator in der Oberfläche ein.
//   wishes  – „Wunschzettel eintragen/aktualisieren“ (nur wer dieses Jahr noch nichts eingetragen hat)
//   assign1 – „Du beschenkst …“ (erste Erinnerung, Standard 1. Oktober)
//   assign2 – „Du beschenkst …“ (zweite Erinnerung, Standard 1. November)
// Jede Mail geht pro Person nur einmal pro Jahr raus (Tabelle mail_log). War der Server am Termin aus,
// wird bis zu 14 Tage nachgeholt.
import * as T from './templates.mjs';
import { REMINDER_DEFAULTS, checkText } from './templates.mjs';

const CATCH_UP_DAYS = 14;

export const DEFAULT_REMINDERS = {
  hour: 9,
  wishes: { enabled: true, month: 8, day: 1 },
  assign1: { enabled: true, month: 10, day: 1 },
  assign2: { enabled: true, month: 11, day: 1 },
};
export const REMINDER_IDS = ['wishes', 'assign1', 'assign2'];

/** Datum in deutscher Zeit als { y, m, d, hour }. */
export function berlinParts(date, tz = 'Europe/Berlin') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hour: Number(parts.hour) };
}

const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const daysIn = (m) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export function loadSettings(db) {
  let saved = {};
  try { saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'reminders'").get()?.value ?? '{}'); } catch { /* kaputte Einstellung = Standard */ }
  const out = { hour: Number.isInteger(saved.hour) ? saved.hour : DEFAULT_REMINDERS.hour };
  for (const id of REMINDER_IDS) out[id] = { ...DEFAULT_REMINDERS[id], ...(saved[id] ?? {}) };
  return out;
}

/** Prüft die Eingabe aus der Oberfläche und speichert sie. Wirft Error mit verständlichem Text. */
export function saveSettings(db, input) {
  const hour = Number(input?.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Die Uhrzeit muss zwischen 0 und 23 liegen.');
  const out = { hour };
  for (const id of REMINDER_IDS) {
    const r = input?.[id] ?? {};
    const month = Number(r.month);
    const day = Number(r.day);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Bitte einen gültigen Monat wählen.');
    if (!Number.isInteger(day) || day < 1 || day > daysIn(month)) throw new Error('Bitte einen gültigen Tag wählen.');
    out[id] = { enabled: r.enabled === true, month, day };
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('reminders', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return out;
}

/** Gespeicherte, vom Organisator geänderte Texte: { id: { subject, body } }. Leer = Standard. */
export function loadTexts(db) {
  let saved = {};
  try { saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'reminderTexts'").get()?.value ?? '{}'); } catch { /* Standard */ }
  const out = {};
  for (const id of REMINDER_IDS) out[id] = { subject: String(saved[id]?.subject ?? ''), body: String(saved[id]?.body ?? '') };
  return out;
}

/** Prüft die Texte (Länge, Platzhalter) und gibt sie bereinigt zurück. Entspricht ein Text dem Standard, bleibt er leer. */
export function normalizeTexts(input) {
  const out = {};
  for (const id of REMINDER_IDS) {
    const t = input?.[id] ?? {};
    const subject = String(t.subject ?? '').replace(/\r/g, '').trim();
    const body = String(t.body ?? '').replace(/\r\n/g, '\n').trim();
    if (subject.length > 150) throw new Error('Der Betreff ist zu lang (höchstens 150 Zeichen).');
    if (body.length > 3000) throw new Error('Der Text ist zu lang (höchstens 3000 Zeichen).');
    checkText(subject, 'Betreff');
    checkText(body, 'Text');
    out[id] = {
      subject: subject === REMINDER_DEFAULTS[id].subject ? '' : subject,
      body: body === REMINDER_DEFAULTS[id].body ? '' : body,
    };
  }
  return out;
}

export function saveTexts(db, input) {
  const out = normalizeTexts(input);
  db.prepare("INSERT INTO settings (key, value) VALUES ('reminderTexts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(out));
  return out;
}

/** Für die Anzeige im Organisator-Bereich: Einstellungen, nächster Termin und letzter Versand. */
export function reminderOverview(db, now = new Date(), tz = 'Europe/Berlin') {
  const settings = loadSettings(db);
  const { y, m, d } = berlinParts(now, tz);
  const today = dayNumber(y, m, d);
  const items = REMINDER_IDS.map((id) => {
    const r = settings[id];
    const day = r.month === 2 && r.day === 29 ? 28 : r.day; // im Nicht-Schaltjahr: 28.
    const thisYear = dayNumber(y, r.month, day);
    const year = today > thisYear ? y + 1 : y; // Termin schon vorbei -> nächstes Jahr
    const last = db.prepare(
      'SELECT key, COUNT(*) AS n, MAX(sent_at) AS at FROM mail_log WHERE key LIKE ? GROUP BY key ORDER BY MAX(sent_at) DESC LIMIT 1',
    ).get(`${id}-%`);
    return {
      id, ...r,
      nextDate: r.enabled ? `${year}-${String(r.month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
      lastSent: last ? { year: Number(last.key.split('-').pop()), count: Number(last.n), at: last.at } : null,
    };
  });
  const saved = loadTexts(db);
  const texts = Object.fromEntries(REMINDER_IDS.map((id) => [id, {
    subject: saved[id].subject || REMINDER_DEFAULTS[id].subject,
    body: saved[id].body || REMINDER_DEFAULTS[id].body,
    defaultSubject: REMINDER_DEFAULTS[id].subject,
    defaultBody: REMINDER_DEFAULTS[id].body,
    custom: Boolean(saved[id].subject || saved[id].body),
  }]));
  return { hour: settings.hour, items, texts };
}

export async function runReminders({ db, service, mailer, siteUrl, now = new Date(), tz = 'Europe/Berlin', log = console.log }) {
  const settings = loadSettings(db);
  const texts = loadTexts(db);
  const { y, m, d, hour } = berlinParts(now, tz);
  if (hour < settings.hour) return { sent: 0 };
  const today = dayNumber(y, m, d);
  let sent = 0;

  /** Ist der Termin dieses Jahr erreicht (und höchstens 14 Tage her)? */
  const due = (id) => {
    const r = settings[id];
    if (!r.enabled) return false;
    const target = dayNumber(y, r.month, r.month === 2 && r.day === 29 ? 28 : r.day);
    return today >= target && today <= target + CATCH_UP_DAYS;
  };

  const seen = db.prepare('SELECT 1 FROM mail_log WHERE key = ? AND user_id = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO mail_log (key, user_id, sent_at) VALUES (?, ?, ?)');
  const deliver = async (key, user, buildMail) => {
    if (seen.get(key, user.id)) return;
    try {
      await mailer.send({ to: user.email, secret: true, ...buildMail() });
      mark.run(key, user.id, now.toISOString());
      sent++;
    } catch (e) {
      log(`Erinnerung ${key} an ${user.email} fehlgeschlagen: ${e.message}`);
    }
  };

  // --- Wunschzettel ---
  if (due('wishes')) {
    const startOfYear = `${y}-01-01T00:00:00.000Z`;
    const people = db.prepare('SELECT * FROM users WHERE active = 1').all()
      .filter((u) => !u.wishes_updated_at || u.wishes_updated_at < startOfYear || !u.wishes);
    for (const u of people) {
      await deliver(`wishes-${y}`, u, () => T.reminderMail({
        siteUrl, id: 'wishes', texts: texts.wishes, url: service.internals.createLoginUrl(u),
        vars: { name: u.name, wichtel: '', budget: service.internals.budget, jahr: y },
      }));
    }
  }

  // --- „Du beschenkst …“ ---
  for (const id of ['assign1', 'assign2']) {
    if (!due(id)) continue;
    const r = settings[id];
    const dueFrom = new Date(Date.UTC(y, r.month - 1, r.day)).toISOString();
    const round = service.latestRound();
    // Nur Auslosungen, die vor dem Termin stattfanden (eine frische Auslosung hat ja gerade erst Mails geschickt).
    if (!round || round.drawn_at >= dueFrom) continue;
    for (const a of db.prepare('SELECT * FROM assignments WHERE round_id = ?').all(round.id)) {
      const giver = db.prepare('SELECT * FROM users WHERE id = ?').get(a.giver_id);
      const receiver = db.prepare('SELECT * FROM users WHERE id = ?').get(a.receiver_id);
      if (!giver || !receiver || !giver.active) continue;
      await deliver(`${id}-${y}`, giver, () => T.reminderMail({
        siteUrl, id, texts: texts[id], url: service.internals.wichtelUrl(a.token),
        vars: { name: giver.name, wichtel: receiver.name, budget: service.internals.budget, jahr: round.year },
      }));
    }
  }
  return { sent };
}

export function startReminderLoop(opts, everyMs = 30 * 60 * 1000) {
  const tick = () => runReminders({ ...opts, now: new Date() }).catch((e) => console.error('Erinnerungen:', e));
  setTimeout(tick, 10_000);
  return setInterval(tick, everyMs);
}
