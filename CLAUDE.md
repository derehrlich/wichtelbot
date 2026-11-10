# Wichtelbot – Projektwissen

## Wer und was
- **Auftraggeber:** Marcel Ehrlich (EhrlichVerwirrt). **Kein Programmierer.** Alles auf **Deutsch**, einfache Worte, Fachbegriffe erklären. Kleine Dinge selbst entscheiden und sagen, was entschieden wurde.
- **Projekt:** Familien-Wichteln (Auslosung per Mail, Wunschzettel, Erinnerungen). Läuft auf Marcels NAS mit CasaOS, Adresse `https://wichtel.ehrlichverwirrt.de` über Cloudflare Tunnel (ohne Cloudflare Access).
- **Nichts in `derehrlich/twitch-checkin` schreiben** (ausdrücklicher Wunsch). Nur lesen, z. B. für Optik und Deployment-Vorbild.

## Technik
- Node 22, **keine Abhängigkeiten** (`node:sqlite`, `node:http`, `fetch`). Mail über Resend (`lib/mail.mjs`).
- `server.mjs` verdrahtet alles; `lib/service.mjs` = Logik, `lib/app.mjs` = HTTP, `lib/reminders.mjs` = Erinnerungen, `lib/draw.mjs` = Auslosung, `lib/templates.mjs` = Mailtexte, `public/` = Oberfläche (Pixel-Look, Logo und Winterwald von Marcel).
- Tests: `npm test` (`test/run.test.mjs`). Vor jedem Push ausführen, neue Funktionen bekommen einen Test.

## Wichtige Regeln
- Der gezogene Name steht **nur in Mails** und auf der Wichtel-Seite `/wichtel/<geheimer Token>`, nie im Konto oder im Organisator-Bereich.
- Der Login-Link in der Mail öffnet nur `/anmelden`; erst der Klick (POST) verbraucht ihn (Schutz vor Link-Vorschau im Mailprogramm).
- Erinnerungen sind über `mail_log` abgesichert (einmal pro Person und Jahr) und holen bis zum 14. des Monats nach.
- Texte in der Oberfläche nie als HTML einsetzen (immer `textContent`/`append`).
- Docker: läuft als root mit `cap_drop: ALL`, weil der NAS-Ordner root gehört.

- Das Budget ist für alle fest (Standard `100 €`, Einstellung `BUDGET`), kein Eingabefeld. Die Spalte `users.budget` ist ungenutzt.
- „Alles zurücksetzen" (`POST /api/admin/reset`, Bestätigung `ZURUECKSETZEN`) löscht alle Teilnehmer außer den Organisatoren, alle Runden, Ausnahmen und `mail_log`.

## Geplant (Stufe 2)
KI-Geschenkideen aus den Wünschen (Claude API) auf der Wichtel-Seite und in den Erinnerungsmails. Nur Interessen und Budget senden, keine Namen.
