// Auslosung: jeder zieht genau einen anderen, niemand sich selbst.
// Verbotene Paare (Partner, letztes Jahr gezogen) werden berücksichtigt.

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param {number[]} ids        alle Teilnehmer
 * @param {Set<string>} forbidden  Einträge der Form "geber>empfänger"
 * @returns {Map<number, number>|null}  geber -> empfänger, oder null wenn es nicht aufgeht
 */
export function draw(ids, forbidden = new Set(), rng = Math.random) {
  if (ids.length < 3) return null;
  const allowed = (g, r) => g !== r && !forbidden.has(`${g}>${r}`);

  // Die am stärksten eingeschränkten Geber zuerst, dann geht das Suchen schnell.
  const order = shuffle(ids, rng).sort(
    (x, y) => ids.filter((r) => allowed(x, r)).length - ids.filter((r) => allowed(y, r)).length,
  );

  const result = new Map();
  const taken = new Set();
  let steps = 0;

  const place = (i) => {
    if (i === order.length) return true;
    if (++steps > 200000) return false;
    const giver = order[i];
    for (const receiver of shuffle(ids, rng)) {
      if (taken.has(receiver) || !allowed(giver, receiver)) continue;
      result.set(giver, receiver);
      taken.add(receiver);
      if (place(i + 1)) return true;
      result.delete(giver);
      taken.delete(receiver);
    }
    return false;
  };

  return place(0) ? result : null;
}
