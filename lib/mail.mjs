// Mailversand über Resend (https://resend.com). Ohne API-Schlüssel werden Mails nur ins Log geschrieben,
// damit man die App ohne Mail-Konto ausprobieren kann.
//
// Resend erlaubt nur wenige Anfragen pro Sekunde (kostenlos: 2). Deshalb gehen Mails nacheinander mit etwas Abstand raus,
// und bei „zu viele Anfragen“ (429) oder einem Serverfehler wird es nach einer Pause noch einmal versucht.

export class MailError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MailError';
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMailer({
  apiKey, from, log = console.log, fetchFn = fetch,
  minIntervalMs = 600, retries = 3, sleep = defaultSleep, now = () => Date.now(),
} = {}) {
  const outbox = [];
  let queue = Promise.resolve(); // alle Mails laufen nacheinander durch diese Schlange
  let lastRequestAt = 0;

  async function deliver({ to, subject, html, text }) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      let res;
      try {
        lastRequestAt = now();
        res = await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html, text }),
        });
      } catch (e) {
        if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
        throw new MailError(`Resend ist nicht erreichbar (${e.message})`, 0);
      }
      if (res.ok) return;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new MailError(`Resend meldet Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    }
  }

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
      const job = queue.then(() => deliver({ to, subject, html, text }));
      queue = job.catch(() => {}); // ein Fehler soll die nächsten Mails nicht blockieren
      return job;
    },
  };
}
