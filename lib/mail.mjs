// Mailversand über Resend (https://resend.com). Ohne API-Schlüssel werden Mails nur ins Log geschrieben,
// damit man die App ohne Mail-Konto ausprobieren kann.

export function createMailer({ apiKey, from, log = console.log, fetchFn = fetch } = {}) {
  const outbox = [];
  return {
    outbox,
    configured: Boolean(apiKey),
    async send({ to, subject, html, text, secret = false }) {
      outbox.push({ to, subject, html, text });
      if (!apiKey) {
        // Mails mit dem gezogenen Namen (secret) landen nie im Log, auch nicht zum Ausprobieren.
        log(secret ? `[Mail, nicht versendet – kein RESEND_API_KEY] An: ${to} | (Inhalt geheim)` : `[Mail, nicht versendet – kein RESEND_API_KEY] An: ${to} | ${subject}\n${text}`);
        return;
      }
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
      });
      if (!res.ok) throw new Error(`Mailversand fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 300)}`);
    },
  };
}
