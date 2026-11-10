// Automatische Erinnerungen:
//   1. August: „Wunschzettel eintragen/aktualisieren“ (nur wer dieses Jahr noch nichts eingetragen hat)
//   1. Oktober und 1. November: „Du beschenkst …“ an alle aus der letzten Auslosung
// Die Prüfung läuft regelmäßig. Jede Mail wird pro Person nur einmal pro Jahr verschickt (Tabelle mail_log),
// und wer am 1. gerade nicht erreichbar war (Server aus), bekommt sie bis zum 14. nachgeliefert.
import * as T from './templates.mjs';

const CATCH_UP_DAYS = 14;

/** Datum in deutscher Zeit als { y, m, d, hour }. */
export function berlinParts(date, tz = 'Europe/Berlin') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hour: Number(parts.hour) };
}

export async function runReminders({ db, service, mailer, siteUrl, now = new Date(), tz = 'Europe/Berlin', startHour = 9, log = console.log }) {
  const { y, m, d, hour } = berlinParts(now, tz);
  if (hour < startHour) return { sent: 0 };
  let sent = 0;

  const seen = db.prepare('SELECT 1 FROM mail_log WHERE key = ? AND user_id = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO mail_log (key, user_id, sent_at) VALUES (?, ?, ?)');
  const deliver = async (key, user, buildMail) => {
    if (seen.get(key, user.id)) return;
    try {
      await mailer.send({ to: user.email, ...buildMail() });
      mark.run(key, user.id, now.toISOString());
      sent++;
    } catch (e) {
      log(`Erinnerung ${key} an ${user.email} fehlgeschlagen: ${e.message}`);
    }
  };

  // --- August: Wunschzettel ---
  if (m === 8 && d <= CATCH_UP_DAYS) {
    const startOfYear = `${y}-01-01T00:00:00.000Z`;
    const people = db.prepare('SELECT * FROM users WHERE active = 1').all()
      .filter((u) => !u.wishes_updated_at || u.wishes_updated_at < startOfYear || !u.wishes);
    for (const u of people) {
      await deliver(`wishes-${y}`, u, () => T.wishesReminderMail({
        siteUrl, name: u.name, url: service.internals.createLoginUrl(u), hasWishes: Boolean(u.wishes),
      }));
    }
  }

  // --- Oktober und November: wen beschenke ich? ---
  for (const month of [10, 11]) {
    if (m !== month || d > CATCH_UP_DAYS) continue;
    const dueFrom = new Date(Date.UTC(y, month - 1, 1)).toISOString();
    const round = service.latestRound();
    // Nur Auslosungen, die vor dem 1. des Monats stattfanden (eine frische Auslosung im November hat ja gerade erst Mails geschickt).
    if (!round || round.drawn_at >= dueFrom) continue;
    for (const a of db.prepare('SELECT * FROM assignments WHERE round_id = ?').all(round.id)) {
      const giver = db.prepare('SELECT * FROM users WHERE id = ?').get(a.giver_id);
      const receiver = db.prepare('SELECT * FROM users WHERE id = ?').get(a.receiver_id);
      if (!giver || !receiver || !giver.active) continue;
      await deliver(`assign-${month}-${y}`, giver, () => T.assignmentReminderMail({
        siteUrl, name: giver.name, receiverName: receiver.name, year: round.year,
        wichtelUrl: service.internals.wichtelUrl(a.token), month,
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
