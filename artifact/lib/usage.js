// Finds "10 mL of DMEM" style amounts in a note and matches them to reagents on the shelf.
const FACTOR = {
  l: ["volume", 1], ml: ["volume", 1e-3], ul: ["volume", 1e-6], "µl": ["volume", 1e-6], nl: ["volume", 1e-9],
  kg: ["mass", 1e3], g: ["mass", 1], mg: ["mass", 1e-3], ug: ["mass", 1e-6], "µg": ["mass", 1e-6], ng: ["mass", 1e-9],
};
const UNIT = "(µL|uL|mL|nL|L|µl|ul|ml|nl|l|kg|mg|µg|ug|ng|g)";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function convert(amount, from, to) {
  const a = FACTOR[from.toLowerCase()], b = FACTOR[(to || "").toLowerCase()];
  if (!a || !b || a[0] !== b[0]) return null;
  return Math.round(((amount * a[1]) / b[1]) * 1e6) / 1e6;
}

export function findUses(text, reagents) {
  const out = [];
  const names = [...reagents].sort((x, y) => y.name.length - x.name.length);
  const taken = [];
  for (const r of names) {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}\\s+(?:of\\s+)?(?:the\\s+)?${esc(r.name)}(?![A-Za-z0-9])`, "gi");
    let m;
    while ((m = re.exec(text))) {
      if (taken.some(([s, e]) => m.index < e && m.index + m[0].length > s)) continue;
      taken.push([m.index, m.index + m[0].length]);
      const amount = Number(m[1]), unit = m[2];
      const inStock = r.unit ? convert(amount, unit, r.unit) : null;
      out.push({ reagent_id: r.id, name: r.name, amount, unit, amount_in_stock_unit: inStock, matched: m[0] });
    }
  }
  return out;
}
