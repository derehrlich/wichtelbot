import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.mjs';
import { createMailer } from '../lib/mail.mjs';
import { createService, UserError } from '../lib/service.mjs';
import { createApp } from '../lib/app.mjs';
import { draw } from '../lib/draw.mjs';
import { runReminders, berlinParts } from '../lib/reminders.mjs';

const SITE = 'https://wichtel.example.de';

function setup(startDate = '2026-12-01T12:00:00Z') {
  const clock = { t: new Date(startDate) };
  const db = openDb(':memory:');
  const mailer = createMailer({ log: () => {} });
  const service = createService({ db, mailer, siteUrl: SITE, adminEmails: ['chef@example.de'], now: () => clock.t });
  service.ensureAdmins();
  return { db, mailer, service, clock };
}

async function addFamily(service, n = 5) {
  const names = ['Anna', 'Bernd', 'Clara', 'Dieter', 'Emma', 'Fritz'].slice(0, n);
  for (const name of names) await service.addUser({ name, email: `${name.toLowerCase()}@example.de` });
}

test('draw: jeder zieht genau einen anderen, Verbote werden eingehalten', () => {
  const ids = [1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 200; i++) {
    const forbidden = new Set(['1>2', '2>1', '3>4', '4>3']);
    const r = draw(ids, forbidden);
    assert.equal(r.size, 6);
    assert.equal(new Set(r.values()).size, 6);
    for (const [g, e] of r) { assert.notEqual(g, e); assert.ok(!forbidden.has(`${g}>${e}`)); }
  }
});

test('draw: zu wenige Personen oder unlösbar -> null', () => {
  assert.equal(draw([1, 2]), null);
  assert.equal(draw([1, 2, 3], new Set(['1>2', '1>3'])), null);
});

test('Anmeldelink: nur einmal benutzbar, läuft ab, Antwort verrät nichts', async () => {
  const { service, mailer, clock } = setup();
  await service.requestLogin('unbekannt@example.de');
  assert.equal(mailer.outbox.length, 0);

  await service.requestLogin('chef@example.de');
  assert.equal(mailer.outbox.length, 1);
  const token = mailer.outbox[0].text.match(/token=([\w-]+)/)[1];
  const s = service.consumeLoginToken(token);
  assert.ok(s);
  assert.equal(service.userFromSession(s.session).email, 'chef@example.de');
  assert.equal(service.consumeLoginToken(token), null, 'zweites Mal geht nicht');

  clock.t = new Date(clock.t.getTime() + 61_000);
  await service.requestLogin('chef@example.de');
  const t2 = mailer.outbox[1].text.match(/token=([\w-]+)/)[1];
  clock.t = new Date(clock.t.getTime() + 31 * 60_000);
  assert.equal(service.consumeLoginToken(t2), null, 'abgelaufen');
});

test('Auslosung: Mails gehen an alle, Namen stimmen, Wichtel-Seite zeigt nur den Gezogenen', async () => {
  const { service, mailer } = setup();
  await addFamily(service, 5);
  const before = mailer.outbox.length;
  const res = await service.runDraw();
  assert.equal(res.count, 6); // 5 + Organisator
  const mails = mailer.outbox.slice(before);
  assert.equal(mails.length, 6);
  const seen = new Set();
  for (const m of mails) {
    const name = m.text.match(/\n {2}(.+)\n/)[1];
    assert.ok(!seen.has(name), 'jeder wird genau einmal gezogen');
    seen.add(name);
    const url = m.text.match(/(https:\/\/\S+\/wichtel\/[\w-]+)/)[1];
    const w = service.wichtelByToken(url.split('/').pop());
    assert.equal(w.receiverName, name);
  }
  assert.equal(seen.size, 6);
  await assert.rejects(() => service.runDraw(), (e) => e instanceof UserError && e.status === 409);
  const again = await service.runDraw({ redo: true });
  assert.equal(again.count, 6);
});

test('Auslosung: Ausnahmen und letztes Jahr werden berücksichtigt', async () => {
  const { service, db, clock } = setup('2025-12-01T12:00:00Z');
  await addFamily(service, 5);
  const users = service.adminState().users;
  const [a, b] = users.filter((u) => ['Anna', 'Bernd'].includes(u.name));
  service.addExclusion(a.id, b.id);
  await service.runDraw();
  const pairs = (year) => db.prepare('SELECT giver_id g, receiver_id r FROM assignments a JOIN rounds ro ON ro.id=a.round_id WHERE ro.year=?').all(year);
  const y1 = pairs(2025);
  assert.ok(!y1.some((p) => (p.g === a.id && p.r === b.id) || (p.g === b.id && p.r === a.id)));

  clock.t = new Date('2026-12-01T12:00:00Z');
  await service.runDraw();
  const y2 = pairs(2026);
  for (const p of y2) assert.ok(!y1.some((o) => o.g === p.g && o.r === p.r), 'niemand zieht dieselbe Person wie im Vorjahr');
});

test('Wünsche: Zeitstempel nur bei Änderung, Profil lässt sich ändern', async () => {
  const { service, clock } = setup();
  const [chef] = service.adminState().users;
  assert.equal(chef.wishesUpdatedAt, null);
  const p = service.updateProfile(chef.id, { wishes: 'Kaffee', budget: 'bis 30 €' });
  assert.equal(p.wishesUpdatedAt, clock.t.toISOString());
  clock.t = new Date(clock.t.getTime() + 86400000);
  const p2 = service.updateProfile(chef.id, { wishes: 'Kaffee' });
  assert.equal(p2.wishesUpdatedAt, p.wishesUpdatedAt, 'unverändert = kein neuer Zeitstempel');
});

test('Erinnerungen: Oktober und November einmalig, August nur ohne aktuellen Wunschzettel', async () => {
  const { db, mailer, service, clock } = setup('2025-12-01T12:00:00Z');
  await addFamily(service, 3);
  await service.runDraw();
  const run = (iso) => { clock.t = new Date(iso); return runReminders({ db, service, mailer, siteUrl: SITE, now: clock.t, log: () => {} }); };
  const mails = () => mailer.outbox.length;

  let n = mails();
  assert.equal((await run('2026-08-01T10:00:00Z')).sent, 4, 'alle ohne Wünsche');
  assert.equal((await run('2026-08-01T11:00:00Z')).sent, 0, 'nicht doppelt');
  assert.equal(mails() - n, 4);

  // Wer im Jahr schon etwas eingetragen hat, wird im nächsten August wieder gefragt, im selben Jahr nicht.
  const anna = service.adminState().users.find((u) => u.name === 'Anna');
  service.updateProfile(anna.id, { wishes: 'Bücher' });
  assert.equal((await run('2026-08-02T10:00:00Z')).sent, 0);

  assert.equal((await run('2026-09-15T10:00:00Z')).sent, 0, 'im September nichts');
  assert.equal((await run('2026-10-01T06:00:00Z')).sent, 0, 'vor 9 Uhr nichts (08:00 deutsche Zeit)');
  assert.equal((await run('2026-10-01T08:00:00Z')).sent, 4, 'Oktober');
  assert.equal((await run('2026-10-05T08:00:00Z')).sent, 0);
  assert.equal((await run('2026-11-03T08:00:00Z')).sent, 4, 'November, nachgeliefert');
  const last = mailer.outbox.at(-1);
  assert.match(last.subject, /Erinnerung: Du beschenkst/);
});

test('Erinnerung: frische Auslosung im November löst keine Oktober-/November-Mail aus', async () => {
  const { db, mailer, service, clock } = setup('2026-11-10T12:00:00Z');
  await addFamily(service, 3);
  await service.runDraw();
  const n = mailer.outbox.length;
  const r = await runReminders({ db, service, mailer, siteUrl: SITE, now: clock.t, log: () => {} });
  assert.equal(r.sent, 0);
  assert.equal(mailer.outbox.length, n);
});

test('Budget ist immer 100 € und steht in Mail und Wichtel-Seite', async () => {
  const { service, mailer } = setup();
  await addFamily(service, 3);
  const n = mailer.outbox.length;
  await service.runDraw();
  const mails = mailer.outbox.slice(n);
  for (const m of mails) assert.match(m.text, /Budget: 100 €/);
  const token = mails[0].text.match(/wichtel\/([\w-]+)/)[1];
  assert.equal(service.wichtelByToken(token).budget, '100 €');
  assert.equal(service.meState(service.internals.q.userById.get(1)).budget, '100 €');
});

test('Reset: löscht alle Teilnehmer außer dem Organisator, alle Auslosungen und Ausnahmen', async () => {
  const { service, db } = setup();
  await addFamily(service, 4);
  const [a, b] = service.adminState().users.filter((u) => u.name !== 'Chef');
  service.addExclusion(a.id, b.id);
  await service.runDraw();
  const chef = service.adminState().users.find((u) => u.isAdmin);
  service.updateProfile(chef.id, { wishes: 'Tee' });

  const r = service.resetAll();
  assert.equal(r.removedUsers, 4);
  const st = service.adminState();
  assert.equal(st.users.length, 1);
  assert.equal(st.users[0].email, 'chef@example.de');
  assert.equal(st.users[0].wishes, 'Tee', 'Organisator behält seine Wünsche');
  assert.equal(st.round, null);
  assert.equal(st.exclusions.length, 0);
  for (const t of ['rounds', 'assignments', 'mail_log']) assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0);
});

test('HTTP: Reset nur für Organisator und nur mit Bestätigung', async () => {
  const { service, mailer } = setup();
  const app = createApp({ service, publicDir: new URL('../public/', import.meta.url).pathname, siteUrl: SITE });
  await addFamily(service, 2);
  const login = async (email) => {
    await service.requestLogin(email);
    const v = await http(app.handler, 'POST', '/api/auth/verify', { body: { token: mailer.outbox.at(-1).text.match(/token=([\w-]+)/)[1] } });
    return v.cookie.split(';')[0];
  };
  const anna = await login('anna@example.de');
  assert.equal((await http(app.handler, 'POST', '/api/admin/reset', { cookie: anna, body: { confirm: 'ZURUECKSETZEN' } })).status, 403);
  const chef = await login('chef@example.de');
  assert.equal((await http(app.handler, 'POST', '/api/admin/reset', { cookie: chef, body: {} })).status, 400);
  const ok = await http(app.handler, 'POST', '/api/admin/reset', { cookie: chef, body: { confirm: 'ZURUECKSETZEN' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.removedUsers, 2);
  assert.equal((await http(app.handler, 'GET', '/api/me', { cookie: chef })).status, 200, 'Organisator bleibt angemeldet');
});

test('berlinParts: Sommer- und Winterzeit', () => {
  assert.deepEqual(berlinParts(new Date('2026-08-01T07:30:00Z')), { y: 2026, m: 8, d: 1, hour: 9 });
  assert.deepEqual(berlinParts(new Date('2026-12-31T23:30:00Z')), { y: 2027, m: 1, d: 1, hour: 0 });
});

// ---------- HTTP ----------
async function http(handler, method, path, { body, cookie } = {}) {
  const { createServer } = await import('node:http');
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json, text, cookie: res.headers.get('set-cookie'), headers: res.headers };
  } finally { server.close(); }
}

test('HTTP: Anmelden, Profil, Admin-Schutz', async () => {
  const { service, mailer } = setup();
  const app = createApp({ service, publicDir: new URL('../public/', import.meta.url).pathname, siteUrl: SITE });
  await addFamily(service, 3);

  assert.equal((await http(app.handler, 'GET', '/api/me')).status, 401);
  assert.equal((await http(app.handler, 'POST', '/api/login', { body: { email: 'anna@example.de' } })).status, 200);
  const token = mailer.outbox.at(-1).text.match(/token=([\w-]+)/)[1];
  const v = await http(app.handler, 'POST', '/api/auth/verify', { body: { token } });
  assert.equal(v.status, 200);
  assert.match(v.cookie, /HttpOnly/);
  assert.match(v.cookie, /Secure/);
  const cookie = v.cookie.split(';')[0];

  const me = await http(app.handler, 'GET', '/api/me', { cookie });
  assert.equal(me.json.user.name, 'Anna');
  assert.equal(me.json.isAdmin, false);
  const put = await http(app.handler, 'PUT', '/api/me', { cookie, body: { wishes: 'Tee' } });
  assert.equal(put.json.wishes, 'Tee');

  assert.equal((await http(app.handler, 'GET', '/api/admin/state', { cookie })).status, 403);
  assert.equal((await http(app.handler, 'PUT', '/api/me', { cookie })).status, 415, 'nur JSON');
});

test('HTTP: Wichtel-Link ohne Anmeldung, falsche Links 404, kein Zugriff außerhalb von public', async () => {
  const { service, mailer } = setup();
  const app = createApp({ service, publicDir: new URL('../public/', import.meta.url).pathname, siteUrl: SITE });
  await addFamily(service, 3);
  await service.runDraw();
  const url = mailer.outbox.at(-1).text.match(/wichtel\/([\w-]+)/)[1];
  const ok = await http(app.handler, 'GET', `/api/wichtel/${url}`);
  assert.equal(ok.status, 200);
  assert.ok(ok.json.receiverName);
  assert.equal((await http(app.handler, 'GET', `/api/wichtel/${'x'.repeat(43)}`)).status, 404);
  assert.equal((await http(app.handler, 'GET', '/..%2fpackage.json')).status, 404);
  assert.equal((await http(app.handler, 'GET', '/healthz')).status, 200);
});

test('HTTP: Organisator legt Person an und löst aus', async () => {
  const { service, mailer } = setup();
  const app = createApp({ service, publicDir: new URL('../public/', import.meta.url).pathname, siteUrl: SITE });
  await service.requestLogin('chef@example.de');
  const v = await http(app.handler, 'POST', '/api/auth/verify', { body: { token: mailer.outbox.at(-1).text.match(/token=([\w-]+)/)[1] } });
  const cookie = v.cookie.split(';')[0];
  for (const n of ['Anna', 'Bernd']) {
    const r = await http(app.handler, 'POST', '/api/admin/users', { cookie, body: { name: n, email: `${n}@example.de` } });
    assert.equal(r.status, 201);
  }
  assert.equal((await http(app.handler, 'POST', '/api/admin/users', { cookie, body: { name: 'X', email: 'kaputt' } })).status, 400);
  const d = await http(app.handler, 'POST', '/api/admin/draw', { cookie, body: {} });
  assert.equal(d.status, 200);
  assert.equal(d.json.count, 3);
});
