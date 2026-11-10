# Wichtelbot auf CasaOS einrichten

Alles in einfachen Schritten. Du brauchst: dein NAS mit CasaOS, den Cloudflare Tunnel (hast du schon) und ein kostenloses Konto bei Resend.

## 1. Mail-Dienst Resend einrichten (einmalig, ca. 10 Minuten)
Damit die Mails nicht im Spam landen, schickt der Wichtelbot sie über Resend und mit deiner Domain als Absender.
1. Konto anlegen auf <https://resend.com> (der kostenlose Tarif reicht für eine Familie locker).
2. **Domains → Add Domain** → `ehrlichverwirrt.de`. Resend zeigt dir ein paar DNS-Einträge (SPF, DKIM).
3. Diese Einträge in Cloudflare unter **DNS** eintragen und bei Resend auf **Verify** klicken. Bei Cloudflare die Einträge auf **DNS only** (graue Wolke) stellen.
4. **API Keys → Create API Key** → Schlüssel kopieren (er wird nur einmal angezeigt).

## 2. App in CasaOS installieren
1. Die Datei `docker-compose.yml` aus diesem Repo öffnen und den Inhalt kopieren.
2. CasaOS → **App-Store → Benutzerdefinierte App installieren** (oben rechts) → **Docker Compose importieren** → einfügen.
3. Diese drei Werte ersetzen:
   - `ADMIN_EMAIL`: deine E-Mail-Adresse. Damit bist du der Organisator.
   - `RESEND_API_KEY`: der Schlüssel aus Schritt 1.
   - `SITE_URL` und `MAIL_FROM` nur ändern, falls du eine andere Adresse willst.
4. Installieren. Das Image kommt von `ghcr.io/derehrlich/wichtelbot`. Ist das Repo privat, muss das Paket auf GitHub unter **Packages → Package settings** auf *Public* gestellt werden (oder du meldest CasaOS bei ghcr.io an).

## 3. Cloudflare Tunnel
Im Cloudflare-Dashboard beim bestehenden Tunnel einen **Public Hostname** hinzufügen:
- Subdomain `wichtel`, Domain `ehrlichverwirrt.de`
- Dienst `HTTP`, URL `localhost:3100` (oder die IP deines NAS und Port 3100)

**Kein** Cloudflare Access davorschalten: Die Familie meldet sich mit dem Link aus der Mail an, und der Zugang würde sie aussperren.

## 4. Loslegen
1. `https://wichtel.ehrlichverwirrt.de` öffnen, deine Mail-Adresse eingeben, Link in der Mail anklicken.
2. Unter **Organisator** alle Teilnehmer mit Name und E-Mail eintragen. Jeder bekommt eine Einladung.
3. Ausnahmen setzen (z. B. Paare), dann **Jetzt auslosen**. Alle bekommen eine Mail mit ihrem Wichtel.

## Nach einem Test alles zurücksetzen
Im Organisator-Bereich ganz unten gibt es **Alles zurücksetzen**. Das löscht alle Teilnehmer (außer dir), alle Auslosungen und alle Ausnahmen. Du wirst zweimal gefragt. Dein eigener Name und deine Wünsche bleiben.

## Budget
Das Budget ist für alle gleich und steht in den Mails und auf der Wichtel-Seite: **100 €**. Ändern lässt es sich über die Einstellung `BUDGET` in CasaOS (z. B. `50 €`).

## Wer hat kein Smartphone?
Es reicht eine E-Mail-Adresse, die er irgendwo öffnen kann (PC, Tablet, Handy von jemand anderem). Die Mail mit dem Wichtel kommt direkt an. Seine Wünsche kannst du über **Bearbeiten** für ihn eintragen.

## Erinnerungen (laufen automatisch)
| Wann | Was |
|---|---|
| Sofort nach der Auslosung | „Du hast X gezogen" |
| 1. August | „Wunschzettel eintragen oder aktualisieren", nur an wen dieses Jahr noch nichts eingetragen hat |
| 1. Oktober | „Du beschenkst X" |
| 1. November | „Du beschenkst X", zweite Erinnerung |

Das sind die Standardtermine. Im Organisator-Bereich unter **Erinnerungen** siehst du, wann die nächste Mail rausgeht und an wie viele die letzte ging. Dort kannst du Tag und Monat jeder Erinnerung und die Uhrzeit ändern oder eine Erinnerung ausschalten. War der Server am Termin aus, wird bis zu 14 Tage nachgeholt. Jede Mail geht pro Person nur einmal pro Jahr raus.

## Wichtel nochmal mailen
Hat jemand seine Mail verloren, klickst du in der Teilnehmerliste bei der Person auf **Wichtel nochmal mailen**. Die Mail geht nur an diese Person, du siehst den Namen nicht. Die Person selbst kann auf der Startseite auch „Mail nochmal schicken" wählen.

## Du siehst die Auslosung nicht
Die Zuordnung zeigt dir die Oberfläche nirgends. Der Name steht nur in der Mail an die jeweilige Person, auch in den Server-Logs taucht er nicht auf. Eine Ausnahme: Bei Resend zeigt das Dashboard unter *Emails* den Inhalt jeder verschickten Mail. Wenn du dort nicht in die Mails mit „Du hast … gezogen" klickst, bleibt es geheim.

## Datensicherung
Alles liegt in `/DATA/AppData/wichtelbot/data` (eine Datei `wichtel.db`). Bitte in dein NAS-Backup aufnehmen. Geht sie verloren, sind die Zuordnungen weg, und niemand weiß mehr, wen er gezogen hat. In den Mails steht es aber noch.

## Updates
Neuer Stand auf `main` → GitHub baut automatisch ein neues Image → in CasaOS beim Wichtelbot **Neu erstellen** (Image neu ziehen). Die Daten bleiben.
