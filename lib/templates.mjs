// Mail-Texte (Deutsch). Jede Funktion liefert { subject, html, text }.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout({ siteUrl, title, paragraphsHtml, button, footer }) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#1f6f86;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7e8cc;border:4px solid #3a2112;border-radius:12px;">
<tr><td align="center" style="padding:22px 24px 6px;"><img src="${esc(siteUrl)}/img/logo.png" width="110" height="110" alt="Wichtelbot" style="border-radius:55px;"></td></tr>
<tr><td style="padding:6px 28px 4px;text-align:center;font-size:24px;font-weight:bold;color:#a8261b;">${esc(title)}</td></tr>
<tr><td style="padding:10px 28px;font-size:16px;line-height:1.5;color:#3a2112;">${paragraphsHtml}</td></tr>
${
  button
    ? `<tr><td align="center" style="padding:8px 28px 22px;"><a href="${esc(button.url)}" style="display:inline-block;background:#c0392b;color:#fff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:8px;border-bottom:4px solid #7d1f15;">${esc(button.label)}</a></td></tr>`
    : ''
}
<tr><td style="padding:12px 28px 22px;font-size:12px;color:#7a5a40;text-align:center;border-top:2px dashed #d6a85a;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const FOOTER = 'Diese Mail kommt vom Wichtelbot der Familie. Wenn du sie nicht mehr bekommen möchtest, sag dem Organisator kurz Bescheid.';

const p = (s) => `<p style="margin:0 0 12px;">${s}</p>`;
const hi = (name) => `Hallo ${esc(name)},`;

export function loginMail({ siteUrl, name, url }) {
  return {
    subject: 'Dein Anmelde-Link für den Wichtelbot',
    text: `Hallo ${name},\n\nmit diesem Link kommst du in den Wichtelbot (gültig 30 Minuten, nur einmal benutzbar):\n${url}\n\nDu hast das nicht angefordert? Dann kannst du diese Mail ignorieren.\n`,
    html: layout({
      siteUrl,
      title: 'Dein Anmelde-Link',
      paragraphsHtml: p(hi(name)) + p('mit dem Knopf kommst du in den Wichtelbot. Der Link gilt 30 Minuten und lässt sich nur einmal benutzen.') + p('Du hast das nicht angefordert? Dann ignoriere diese Mail einfach.'),
      button: { url, label: 'Jetzt anmelden' },
      footer: FOOTER,
    }),
  };
}

export function inviteMail({ siteUrl, name, url }) {
  return {
    subject: 'Du bist beim Familien-Wichteln dabei!',
    text: `Hallo ${name},\n\ndu bist beim Familien-Wichteln eingetragen. Über diesen Link (gültig 30 Minuten) kommst du in den Wichtelbot und kannst deine Wünsche eintragen:\n${url}\n\nWenn der Link abgelaufen ist, gib auf ${siteUrl} einfach deine E-Mail-Adresse ein, dann bekommst du einen neuen.\n`,
    html: layout({
      siteUrl,
      title: 'Willkommen beim Wichteln!',
      paragraphsHtml:
        p(hi(name)) +
        p('du bist beim Familien-Wichteln eingetragen. Trag am besten gleich ein, was du dir wünschst, damit dein Wichtel später Ideen hat.') +
        p(`Ist der Link abgelaufen, gib auf <a href="${esc(siteUrl)}">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a> einfach deine E-Mail-Adresse ein, dann bekommst du einen neuen.`),
      button: { url, label: 'Wünsche eintragen' },
      footer: FOOTER,
    }),
  };
}

function receiverBlock(name) {
  return `<div style="margin:6px 0 14px;padding:14px;background:#fff7e3;border:3px solid #d6a85a;border-radius:8px;text-align:center;font-size:26px;font-weight:bold;color:#a8261b;">🎁 ${esc(name)}</div>`;
}

export function drawMail({ siteUrl, name, receiverName, year, wichtelUrl, redo = false, budget = '' }) {
  const intro = redo
    ? `Die Auslosung ${year} wurde neu gemacht. Bitte vergiss die frühere Mail, das hier gilt:`
    : `die Auslosung ${year} ist durch. Du beschenkst:`;
  return {
    subject: redo ? `Wichteln ${year}: neu ausgelost, bitte neu lesen` : `Wichteln ${year}: Du hast ${receiverName} gezogen`,
    text: `Hallo ${name},\n\n${intro}\n\n  ${receiverName}\n${budget ? `\nBudget: ${budget}\n` : ''}\nWünsche und Ideen findest du hier (der Link ist nur für dich, nicht weitergeben):\n${wichtelUrl}\n\nPsst! Nicht verraten. Im Oktober und November kommt eine Erinnerung.\n`,
    html: layout({
      siteUrl,
      title: redo ? 'Neu ausgelost!' : 'Dein Wichtel steht fest',
      paragraphsHtml: p(hi(name)) + p(esc(intro)) + receiverBlock(receiverName) + (budget ? p(`Das Budget liegt bei <b>${esc(budget)}</b>.`) : '') + p('Was sich die Person wünscht, steht auf der Wichtel-Seite. Der Link ist nur für dich, bitte nicht weitergeben.') + p('<b>Psst!</b> Nicht verraten. Im Oktober und November kommt noch eine Erinnerung.'),
      button: { url: wichtelUrl, label: 'Wünsche ansehen' },
      footer: FOOTER,
    }),
  };
}

export function assignmentReminderMail({ siteUrl, name, receiverName, year, wichtelUrl, month, budget = '' }) {
  const when = month === 10 ? 'Es ist Oktober, noch genug Zeit zum Stöbern.' : 'Es ist November, jetzt wird es Zeit, etwas zu besorgen.';
  return {
    subject: `Erinnerung: Du beschenkst ${receiverName}`,
    text: `Hallo ${name},\n\n${when}\nDu hast beim Wichteln gezogen:\n\n  ${receiverName}\n${budget ? `\nBudget: ${budget}\n` : ''}\nWünsche und Ideen:\n${wichtelUrl}\n`,
    html: layout({
      siteUrl,
      title: 'Wichtel-Erinnerung',
      paragraphsHtml: p(hi(name)) + p(esc(when)) + p('Du beschenkst:') + receiverBlock(receiverName) + (budget ? p(`Das Budget liegt bei <b>${esc(budget)}</b>.`) : '') + p(`(Gezogen bei der Auslosung ${esc(year)}.)`),
      button: { url: wichtelUrl, label: 'Wünsche ansehen' },
      footer: FOOTER,
    }),
  };
}

export function wishesReminderMail({ siteUrl, name, url, hasWishes }) {
  const body = hasWishes
    ? 'ist dein Wunschzettel noch aktuell? Schau kurz drüber und passe ihn an, bevor dein Wichtel im Herbst danach sucht.'
    : 'du hast noch nichts in deinen Wunschzettel eingetragen. Trag bitte ein paar Vorlieben ein, damit dein Wichtel später Ideen hat.';
  return {
    subject: 'Dein Wunschzettel fürs Wichteln',
    text: `Hallo ${name},\n\n${body}\n\nHier geht es zu deinem Wunschzettel (Link gilt 30 Minuten):\n${url}\n`,
    html: layout({
      siteUrl,
      title: 'Dein Wunschzettel',
      paragraphsHtml: p(hi(name)) + p(esc(body)),
      button: { url, label: 'Wunschzettel öffnen' },
      footer: FOOTER,
    }),
  };
}
