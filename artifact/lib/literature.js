// Ported from suggest_query in benchcraft/literature.py.
const STOP = new Set(["does", "did", "what", "when", "which", "with", "from", "that", "this", "than",
  "only", "change", "changes", "survive", "residual", "fresh", "give", "gives",
  "affect", "affects", "using", "used", "there", "their", "about", "into", "have",
  "been", "will", "would", "could", "still", "more", "less", "same", "other",
  "first", "second", "again", "panel", "repeat", "baseline", "run", "lot"]);
const GENERIC = new Set(["passage", "readout", "wells", "well", "batch", "arm", "arms", "day", "days"]);

const isIdentifier = (v) => /\d/.test(v) && /[-_]|^p\d/.test(v);

export function suggestQuery(exp, terms = []) {
  const picked = [];
  for (const t of [...terms].sort((a, b) => b.split(" ").length - a.split(" ").length)) {
    if (t.length >= 4 && !GENERIC.has(t.toLowerCase()) && !isIdentifier(t)) picked.push(t);
  }
  for (const w of (exp.question || exp.title || "").match(/[A-Za-z][A-Za-z-]{5,}/g) || []) {
    if (!STOP.has(w.toLowerCase()) && !GENERIC.has(w.toLowerCase())) picked.push(w.toLowerCase());
  }
  const seen = new Set(), out = [];
  for (const x of picked) {
    const k = x.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(x.includes(" ") ? `"${x}"` : x); }
  }
  return out.slice(0, 3).join(" AND ") || exp.title || "";
}
