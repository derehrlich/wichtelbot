const app = document.getElementById('app');
const token = location.pathname.split('/').pop();

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === 'class' ? (e.className = v) : (e[k] = v);
  for (const k of kids) e.append(k);
  return e;
}

try {
  const res = await fetch(`/api/wichtel/${encodeURIComponent(token)}`);
  const w = await res.json();
  if (!res.ok) throw new Error(w.error);
  const box = (text, empty) => el('div', { class: 'wishbox' }, text || empty);
  app.replaceChildren(
    el('div', { class: 'card' },
      el('h2', {}, `Wichteln ${w.year}`),
      el('p', {}, 'Du beschenkst:'),
      el('div', { class: 'gift' }, `🎁 ${w.receiverName}`),
      el('h3', {}, 'Wünsche'),
      box(w.wishes, `${w.receiverName} hat noch nichts eingetragen. Ein Anruf oder eine Nachricht hilft bestimmt weiter.`),
      el('h3', {}, 'Lieber nicht'),
      box(w.noGos, '–'),
      el('h3', {}, 'Budget'),
      box(w.budget, '–'),
      el('p', { class: 'hint' }, w.wishesUpdatedAt ? `Zuletzt geändert am ${new Date(w.wishesUpdatedAt).toLocaleDateString('de-DE')}.` : ''),
    ),
  );
} catch (e) {
  app.replaceChildren(el('div', { class: 'card' }, el('h2', {}, 'Nicht gefunden'), el('p', {}, e.message || 'Diesen Link gibt es nicht.')));
}
