// Startet den Wichtelbot. Einstellungen kommen aus Umgebungsvariablen (siehe .env.example).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './lib/db.mjs';
import { createMailer } from './lib/mail.mjs';
import { createService } from './lib/service.mjs';
import { createApp } from './lib/app.mjs';
import { startReminderLoop } from './lib/reminders.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

const siteUrl = (env.SITE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');
const adminEmails = (env.ADMIN_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!adminEmails.length) console.warn('ACHTUNG: ADMIN_EMAIL ist nicht gesetzt. Ohne Organisator kann niemand Teilnehmer anlegen.');

const db = openDb(env.DB_PATH || join(here, 'data', 'wichtel.db'));
const mailer = createMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM || 'Wichtelbot <wichtel@ehrlichverwirrt.de>' });
const service = createService({ db, mailer, siteUrl, adminEmails });
service.ensureAdmins();

const app = createApp({ service, publicDir: join(here, 'public'), siteUrl });
const port = Number(env.PORT || 3000);
app.listen(port);
startReminderLoop({ db, service, mailer, siteUrl, tz: env.TZ || 'Europe/Berlin' });

console.log(`Wichtelbot läuft auf Port ${port} (${siteUrl}). Mailversand: ${mailer.configured ? 'Resend' : 'AUS (nur Log)'}`);
