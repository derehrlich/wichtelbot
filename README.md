# Wichtelbot

Familien-Wichteln: Alle tragen sich mit ihrer E-Mail-Adresse ein, die Auslosung geht per Mail raus, und der Bot erinnert im Oktober und November des Folgejahres daran, wen man gezogen hat. Dazu gibt es Wunschzettel, die nur die Person sieht, die einen gezogen hat.

- Anmeldung ohne Passwort, per Link in der Mail (funktioniert an jedem Gerät)
- Auslosung mit Ausnahmen (Paare) und ohne dieselbe Person wie im Vorjahr
- Erinnerungen: 1. August (Wünsche eintragen), 1. Oktober und 1. November (wen beschenke ich)
- Läuft als einzelner Container auf CasaOS, Daten in einer SQLite-Datei

Einrichtung Schritt für Schritt: [docs/casaos.md](docs/casaos.md)

## Entwickeln
Node ≥ 22.13, keine zusätzlichen Pakete.
```bash
npm test
node --env-file=.env server.mjs   # Vorlage: .env.example
```
Ohne `RESEND_API_KEY` werden Mails nur ins Log geschrieben (inkl. Anmelde-Links).
