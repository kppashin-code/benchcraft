// Cycle records form an append-only hash chain so any later edit is visible.
export const CHAINED = ["commitment", "challenge", "response", "resolution"];
export const GENESIS = "0".repeat(64);

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function body(rec) {
  const { hash, ...rest } = rec;
  return rest;
}

export async function seal(rec, ledger) {
  const last = ledger[ledger.length - 1];
  // The JSON round trip drops undefined fields, as the store will.
  const sealed = JSON.parse(JSON.stringify({ ...rec, seq: last ? last.seq + 1 : 1, prev: last ? last.hash : GENESIS }));
  sealed.hash = await sha256(canonical(sealed));
  return sealed;
}

export function ledgerOf(records) {
  return records.filter((r) => CHAINED.includes(r.kind)).sort((a, b) => a.seq - b.seq);
}

// Returns the first broken record, or null when the whole chain checks out.
export async function verify(records) {
  const ledger = ledgerOf(records);
  let prev = GENESIS;
  for (let i = 0; i < ledger.length; i++) {
    const r = ledger[i];
    if (r.seq !== i + 1) return { at: r, why: "a record is missing before this one" };
    if (r.prev !== prev) return { at: r, why: "this record does not follow the one before it" };
    if ((await sha256(canonical(body(r)))) !== r.hash) return { at: r, why: "this record was changed after it was locked" };
    prev = r.hash;
  }
  return null;
}

export const short = (hash) => (hash ? hash.slice(0, 4) + "…" + hash.slice(-4) : "");
