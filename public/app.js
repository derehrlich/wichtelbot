// Hauptseite: Anmelden, eigener Wunschzettel, Bereich für den Organisator.
// Alle Texte werden über textContent/append gesetzt (nie als HTML), damit eingetragene Namen nichts anrichten können.
const app = document.getElementById('app');

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e[k] = v;
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { state = null; render(); throw new Error('Bitte melde dich an.'); }
  if (!res.ok) throw new Error(data.error || 'Das hat nicht geklappt.');
  return data;
}

const msg = (text, kind = 'ok') => el('div', { class: `msg ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
function flash(host, text, kind = 'ok') { host.replaceChildren(msg(text, kind)); }

/** Knopf, der während der Arbeit gesperrt ist und Fehler anzeigt. */
function action(label, fn, { cls = '', host } = {}) {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { if (host) flash(host, e.message, 'err'); else alert(e.message); }
    finally { b.disabled = false; }
  });
  return b;
}

let state = null;   // { user, isAdmin, round }
let admin = null;   // Organisator-Daten

async function load() {
  try { state = await api('GET', '/api/me'); } catch { state = null; }
  admin = state?.isAdmin ? await api('GET', '/api/admin/state') : null;
  render();
}

// ---------- Anmelden ----------
function loginView() {
  const out = el('div');
  const email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'deine@mail.de', required: true });
  const form = el('form', { onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', '/api/login', { email: email.value });
      flash(out, 'Wenn die Adresse eingetragen ist, ist dein Anmelde-Link jetzt unterwegs. Schau auch im Spam-Ordner nach.');
    } catch (e) { flash(out, e.message, 'err'); }
  } },
  el('label', { htmlFor: 'em' }, 'Deine E-Mail-Adresse'), (email.id = 'em', email),
  el('button', { type: 'submit', class: 'green' }, 'Link zuschicken'));
  return el('div', { class: 'card' },
    el('h2', {}, 'Willkommen!'),
    el('p', {}, 'Hier trägst du deine Wünsche für das Familien-Wichteln ein. Ein Passwort brauchst du nicht: Du bekommst einen Link per Mail.'),
    form, out,
    el('p', { class: 'hint' }, 'Tipp: Die Mail kannst du an jedem Gerät öffnen, zum Beispiel am Handy von jemand anderem.'));
}

// ---------- Mein Bereich ----------
function wishView() {
  const u = state.user;
  const out = el('div');
  const f = {
    name: el('input', { value: u.name, maxLength: 80, id: 'f-name' }),
    wishes: el('textarea', { value: u.wishes, maxLength: 3000, id: 'f-wishes', placeholder: 'z. B. Kaffee, Wandern, Fantasy-Bücher, Bastelzeug …' }),
    noGos: el('textarea', { value: u.noGos, maxLength: 1000, id: 'f-nogos', placeholder: 'z. B. keine Socken, keine Deko', style: 'min-height:70px' }),
  };
  const save = async (ev) => {
    ev.preventDefault();
    try {
      const p = await api('PUT', '/api/me', { name: f.name.value, wishes: f.wishes.value, noGos: f.noGos.value });
      state.user = p;
      flash(out, 'Gespeichert. Danke!');
    } catch (e) { flash(out, e.message, 'err'); }
  };
  return el('div', { class: 'card' },
    el('h2', {}, 'Mein Wunschzettel'),
    el('p', { class: 'hint' }, `Das sieht nur die Person, die dich beim Wichteln zieht, sonst niemand. Das Budget ist für alle gleich: ${state.budget}.`),
    el('form', { onsubmit: save },
      el('label', { htmlFor: 'f-name' }, 'Mein Name'), f.name,
      el('label', { htmlFor: 'f-wishes' }, 'Was wünsche ich mir?'), f.wishes,
      el('label', { htmlFor: 'f-nogos' }, 'Lieber nicht'), f.noGos,
      el('button', { type: 'submit', class: 'green' }, 'Speichern')),
    out);
}

function statusView() {
  const r = state.round;
  const out = el('div');
  let body;
  if (!r.drawn) body = el('p', {}, 'Die Auslosung steht noch aus. Sobald es soweit ist, bekommst du eine Mail mit der Person, die du beschenkst.');
  else if (r.participating) {
    body = [
      el('p', {}, `Die Auslosung ${r.year} ist gelaufen. Wen du gezogen hast, steht in deiner Mail. Im Oktober und November bekommst du eine Erinnerung.`),
      action('Mail nochmal schicken', async () => { await api('POST', '/api/me/resend'); flash(out, 'Die Mail ist unterwegs. Schau auch im Spam-Ordner nach.'); }, { host: out }),
      out,
    ];
  } else body = el('p', {}, `Bei der Auslosung ${r.year} warst du nicht dabei.`);
  return el('div', { class: 'card wood' }, el('h2', {}, `Hallo ${state.user.name}!`), body);
}

// ---------- Organisator ----------
function adminView() {
  const out = el('div');
  const reload = async (text) => { await load(); if (text) flashTop(text); };
  const nameOf = (id) => admin.users.find((u) => u.id === id)?.name ?? '?';

  // Person hinzufügen
  const nm = el('input', { id: 'a-name', placeholder: 'Name', required: true, maxLength: 80 });
  const em = el('input', { id: 'a-mail', type: 'email', placeholder: 'E-Mail', required: true });
  const addForm = el('form', { onsubmit: async (ev) => {
    ev.preventDefault();
    try { await api('POST', '/api/admin/users', { name: nm.value, email: em.value }); await reload(`${nm.value} ist eingetragen und hat eine Einladung per Mail bekommen.`); }
    catch (e) { flash(out, e.message, 'err'); }
  } }, el('div', { class: 'row' },
    el('div', {}, el('label', { htmlFor: 'a-name' }, 'Name'), nm),
    el('div', {}, el('label', { htmlFor: 'a-mail' }, 'E-Mail'), em),
    el('button', { type: 'submit', class: 'green' }, 'Hinzufügen')));

  // Teilnehmerliste
  const rows = admin.users.map((u) => {
    const status = [];
    if (u.isAdmin) status.push(el('span', { class: 'tag' }, 'Organisator '));
    status.push(u.wishes ? el('span', { class: 'tag green' }, 'Wunschzettel ✓') : el('span', { class: 'tag gray' }, 'noch keine Wünsche'));
    const edit = editBox(u, reload, out);
    return [el('tr', {},
      el('td', {}, el('b', {}, u.name), el('br'), el('small', {}, u.email), el('br'), status),
      el('td', {}, el('label', { style: 'margin:0;font-weight:400' },
        el('input', { type: 'checkbox', checked: u.active, onchange: async (ev) => {
          try { await api('PATCH', `/api/admin/users/${u.id}`, { active: ev.target.checked }); await reload(); }
          catch (e) { ev.target.checked = !ev.target.checked; flash(out, e.message, 'err'); }
        } }), ' nimmt teil')),
      el('td', { class: 'actions' },
        el('button', { class: 'small ghost', type: 'button', onclick: () => { edit.open = !edit.open; } }, 'Bearbeiten'),
        action('Einladung', async () => { await api('POST', `/api/admin/users/${u.id}/invite`); flash(out, `Einladung an ${u.name} geschickt.`); }, { cls: 'small ghost', host: out }),
        u.inRound ? action('Wichtel nochmal mailen', async () => {
          if (!confirm(`${u.name} den gezogenen Wichtel noch einmal per Mail schicken? Du siehst den Namen dabei nicht.`)) return;
          await api('POST', `/api/admin/users/${u.id}/resend-draw`);
          flash(out, `Die Mail mit dem Wichtel ist an ${u.name} unterwegs.`);
        }, { cls: 'small ghost', host: out }) : null,
        u.isAdmin ? null : action('Löschen', async () => {
          if (!confirm(`${u.name} wirklich löschen?`)) return;
          await api('DELETE', `/api/admin/users/${u.id}`); await reload();
        }, { cls: 'small', host: out })),
    ), el('tr', {}, el('td', { colSpan: 3, style: 'border:0;padding:0' }, edit))];
  }).flat();

  // Ausnahmen
  const opts = () => admin.users.map((u) => el('option', { value: u.id }, u.name));
  const exA = el('select', { id: 'x-a' }, opts());
  const exB = el('select', { id: 'x-b' }, opts());
  if (admin.users.length > 1) exB.selectedIndex = 1;
  const exPills = admin.exclusions.map((x) => el('span', { class: 'pill' }, `${nameOf(x.a)} ↔ ${nameOf(x.b)}`,
    action('✕', async () => { await api('DELETE', `/api/admin/exclusions/${x.a}/${x.b}`); await reload(); }, { host: out })));

  // Auslosung
  const redo = admin.round && admin.round.year === new Date().getFullYear();
  const active = admin.users.filter((u) => u.active).length;
  const drawBtn = action(redo ? 'Neu auslosen' : 'Jetzt auslosen', async () => {
    const q = redo
      ? `Für ${admin.round.year} wurde schon ausgelost. Wirklich neu auslosen? Alle bekommen eine neue Mail, die alten Zuordnungen sind danach ungültig.`
      : `${active} Personen auslosen? Jeder bekommt sofort eine Mail mit dem Namen. Das lässt sich nur durch „Neu auslosen“ ändern.`;
    if (!confirm(q)) return;
    const r = await api('POST', '/api/admin/draw', { redo: Boolean(redo) });
    let text = `Fertig! ${r.count} Mails sind raus.`;
    if (r.relaxed) text += ' Hinweis: Ohne die Regel „nicht dieselbe Person wie letztes Jahr“ ging es nicht auf.';
    if (r.mailFailed.length) text += ` Mail fehlgeschlagen bei: ${r.mailFailed.join(', ')}.`;
    await reload(text);
  }, { host: out });

  const resetBtn = action('Alles zurücksetzen', async () => {
    const q = `ACHTUNG: Das löscht ALLE Teilnehmer (außer dir) und ALLE Auslosungen. Das geht nicht rückgängig.\n\nWirklich alles zurücksetzen?`;
    if (!confirm(q)) return;
    if (!confirm('Bist du ganz sicher? Danach ist die Liste leer.')) return;
    const r = await api('POST', '/api/admin/reset', { confirm: 'ZURUECKSETZEN' });
    await reload(`Zurückgesetzt. ${r.removedUsers} Teilnehmer und alle Auslosungen sind gelöscht.`);
  }, { cls: 'small', host: out });

  return el('div', { class: 'card' },
    el('h2', {}, 'Organisator'),
    !admin.mailConfigured ? msg('Mailversand ist noch nicht eingerichtet (RESEND_API_KEY fehlt). Mails werden nur ins Server-Log geschrieben.', 'warn') : null,
    el('h3', {}, 'Teilnehmer'),
    el('p', { class: 'hint' }, 'Jeder neue Teilnehmer bekommt eine Einladung per Mail. Wer kein Smartphone nutzt, braucht nur eine E-Mail-Adresse, die er irgendwo öffnen kann. Über „Bearbeiten“ kannst du auch Wünsche für jemanden eintragen.'),
    el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Person'), el('th', {}, 'Auslosung'), el('th', {}))), el('tbody', {}, rows)),
    addForm,
    el('h3', {}, 'Ausnahmen (ziehen sich nicht)'),
    el('p', { class: 'hint' }, 'Zum Beispiel Paare. Gilt in beide Richtungen.'),
    el('div', {}, exPills),
    el('div', { class: 'row' }, el('div', {}, el('label', { htmlFor: 'x-a' }, 'Person'), exA), el('div', {}, el('label', { htmlFor: 'x-b' }, 'darf nicht ziehen'), exB),
      action('Hinzufügen', async () => { await api('POST', '/api/admin/exclusions', { a: Number(exA.value), b: Number(exB.value) }); await reload(); }, { cls: 'green', host: out })),
    el('h3', {}, 'Auslosung'),
    admin.round ? el('p', {}, `Letzte Auslosung: ${admin.round.year} (${new Date(admin.round.drawnAt).toLocaleDateString('de-DE')}).`) : el('p', {}, 'Es wurde noch nicht ausgelost.'),
    el('p', { class: 'hint' }, 'Wer „nimmt teil“ angehakt hat, wird ausgelost. Wen du gezogen hast, siehst du als Organisator nur in deiner eigenen Mail, so wie alle anderen.'),
    drawBtn,
    el('h3', {}, 'Erinnerungen'),
    remindersView(out, reload),
    el('h3', {}, 'Zurücksetzen'),
    el('p', { class: 'hint' }, 'Nach einem Test: löscht alle Teilnehmer außer dir und alle Auslosungen, damit du neu anfangen kannst. Dein Name und deine Wünsche bleiben.'),
    resetBtn, out);
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const REMINDER_TEXT = {
  wishes: ['Wunschzettel', 'Bitte die Wünsche eintragen oder aktualisieren (nur an alle, die dieses Jahr noch nichts eingetragen haben).'],
  assign1: ['Erste Erinnerung', 'Jeder bekommt noch einmal: „Du beschenkst …“ mit den Wünschen.'],
  assign2: ['Zweite Erinnerung', 'Dasselbe noch einmal, jetzt mit dem Hinweis, dass es Zeit wird, etwas zu besorgen.'],
};
const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

function remindersView(out, reload) {
  const rem = admin.reminders;
  const hour = el('select', { id: 'r-hour' }, Array.from({ length: 24 }, (_, h) => el('option', { value: h, selected: h === rem.hour }, `${String(h).padStart(2, '0')}:00 Uhr`)));
  const rows = rem.items.map((r) => {
    const on = el('input', { type: 'checkbox', checked: r.enabled, id: `r-on-${r.id}` });
    const day = el('input', { type: 'number', min: 1, max: 31, value: r.day, 'aria-label': 'Tag', style: 'width:70px' });
    const month = el('select', { 'aria-label': 'Monat' }, MONTHS.map((n, i) => el('option', { value: i + 1, selected: i + 1 === r.month }, n)));
    const [title, text] = REMINDER_TEXT[r.id];
    return { id: r.id, on, day, month, node: el('div', { class: 'reminder' },
      el('label', { htmlFor: `r-on-${r.id}`, style: 'display:flex;gap:8px;align-items:center' }, on, el('b', {}, title)),
      el('div', { class: 'hint' }, text),
      el('div', { class: 'row', style: 'margin-top:6px' }, el('div', {}, el('label', {}, 'Tag'), day), el('div', {}, el('label', {}, 'Monat'), month)),
      el('div', { class: 'hint' },
        r.enabled ? `Nächster Versand: ${fmtDay(r.nextDate)}.` : 'Ausgeschaltet.',
        r.lastSent ? ` Zuletzt: ${r.lastSent.count} Mails (${r.lastSent.year}).` : ' Bisher nichts verschickt.')) };
  });
  return el('div', {},
    el('p', { class: 'hint' }, 'Hier siehst du, wann die automatischen Erinnerungen rausgehen, und kannst die Termine ändern. Jede Mail geht pro Person nur einmal im Jahr raus. War der Server am Termin aus, wird bis zu 14 Tage nachgeholt.'),
    rows.map((r) => r.node),
    el('div', { class: 'row' }, el('div', {}, el('label', { htmlFor: 'r-hour' }, 'Uhrzeit (deutsche Zeit)'), hour)),
    action('Termine speichern', async () => {
      const body = { hour: Number(hour.value) };
      for (const r of rows) body[r.id] = { enabled: r.on.checked, day: Number(r.day.value), month: Number(r.month.value) };
      await api('PUT', '/api/admin/reminders', body);
      await reload('Die Erinnerungs-Termine sind gespeichert.');
    }, { cls: 'green', host: out }));
}

function editBox(u, reload, out) {
  const f = {
    name: el('input', { value: u.name, maxLength: 80 }), email: el('input', { type: 'email', value: u.email }),
    wishes: el('textarea', { value: u.wishes, maxLength: 3000 }), noGos: el('textarea', { value: u.noGos, maxLength: 1000, style: 'min-height:60px' }),
  };
  return el('details', { class: 'edit' }, el('summary', {}, `${u.name} bearbeiten`),
    el('label', {}, 'Name'), f.name, el('label', {}, 'E-Mail'), f.email,
    el('label', {}, 'Wünsche'), f.wishes, el('label', {}, 'Lieber nicht'), f.noGos,
    action('Speichern', async () => {
      await api('PATCH', `/api/admin/users/${u.id}`, { name: f.name.value, email: f.email.value, wishes: f.wishes.value, noGos: f.noGos.value });
      await reload(`${f.name.value} gespeichert.`);
    }, { cls: 'green small', host: out }));
}

// ---------- Aufbau ----------
let topMsg = null;
function flashTop(text) { topMsg = text; render(); }

function render() {
  if (!state) { app.replaceChildren(loginView()); return; }
  const parts = [];
  if (topMsg) { parts.push(msg(topMsg)); topMsg = null; }
  parts.push(statusView(), wishView());
  if (admin) parts.push(adminView());
  parts.push(el('p', { style: 'text-align:center' }, action('Abmelden', async () => { await api('POST', '/api/logout', {}); state = null; admin = null; render(); }, { cls: 'ghost' })));
  app.replaceChildren(...parts);
}

load();
