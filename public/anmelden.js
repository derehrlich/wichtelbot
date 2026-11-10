// Der Link in der Mail öffnet nur diese Seite. Erst der Klick meldet an, so verbrauchen Mail-Programme
// mit Link-Vorschau den Link nicht aus Versehen.
const token = new URLSearchParams(location.search).get('token');
const btn = document.getElementById('go');
const msg = document.getElementById('msg');

function show(text, kind) {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
}

if (!token) {
  btn.hidden = true;
  show('Dieser Link ist unvollständig. Bitte öffne ihn direkt aus der Mail.', 'err');
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    location.replace('/');
  } catch (e) {
    show(e.message || 'Das hat nicht geklappt.', 'err');
    btn.disabled = false;
    const a = document.createElement('a');
    a.href = '/'; a.className = 'btn'; a.textContent = 'Neuen Link anfordern';
    msg.after(a);
  }
});
