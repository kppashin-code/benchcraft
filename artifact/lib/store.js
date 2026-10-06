import { CHAINED } from "./chain.js";

// Every table from the old SQLite schema becomes one collection of the same name.
export const KINDS = [
  "project", "folder", "experiment", "note", "step_note", "recording", "uploaded_paper",
  "reagent", "reagent_component", "reagent_use", "dataset", "ink_note", "highlight",
  "commitment", "challenge", "response", "resolution", "glossary", "connector",
  "connector_call", "paper_digest", "paper_note", "experiment_paper", "todo", "todo_notes",
];

const docId = (rec) => String(rec.id);

export async function openStore(onChange) {
  const claude = window.claude;
  const [db, user] = claude ? await Promise.all([claude.use("db"), claude.use("user")]) : [null, null];
  const uid = user ? await user.id() : null;
  if (db && uid) return cloudStore(db, uid, onChange);
  return localStore(onChange);
}

function guard(op, rec) {
  if (op !== "put" && CHAINED.includes(rec.kind)) throw new Error("Locked records cannot be changed or deleted.");
}

function cloudStore(db, uid, onChange) {
  const root = db.doc("data/users/" + uid + "/benchcraft");
  const data = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
  const ready = new Set();
  let flat = [];
  const emit = (meta) => {
    flat = KINDS.flatMap((k) => [...data[k].values()]);
    onChange(flat, { mode: "cloud", ready: ready.size === KINDS.length, ...meta });
  };
  const stops = KINDS.map((k) => root.collection(k).limit(1000).onSnapshot(
    (snap) => {
      data[k] = new Map(snap.docs.map((d) => [d.id, d.data()]));
      if (!snap.metadata.fromCache) ready.add(k);
      emit({ full: snap.size >= 1000 ? k : null });
    },
    (e) => emit({ error: e.message || e.code }),
  ));
  const col = (rec) => root.collection(rec.kind).doc(docId(rec));
  return {
    mode: "cloud",
    all: () => flat,
    async put(rec) {
      if (CHAINED.includes(rec.kind) && data[rec.kind].has(docId(rec))) throw new Error("Locked records cannot be changed.");
      data[rec.kind].set(docId(rec), rec); emit({});
      await col(rec).set(rec);
    },
    async patch(rec) { guard("patch", rec); data[rec.kind].set(docId(rec), rec); emit({}); await col(rec).set(rec); },
    async remove(rec) { guard("remove", rec); data[rec.kind].delete(docId(rec)); emit({}); await col(rec).delete(); },
    stop: () => stops.forEach((s) => s()),
  };
}

// Used outside Claude, for local testing; data stays in this browser only.
function localStore(onChange) {
  const KEY = "benchcraft-local-v2";
  let recs = [];
  try { recs = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { recs = []; }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(recs)); } catch { /* storage blocked */ }
    onChange(recs, { mode: "local", ready: true });
  };
  setTimeout(() => onChange(recs, { mode: "local", ready: true }), 0);
  const same = (a, b) => a.kind === b.kind && docId(a) === docId(b);
  return {
    mode: "local",
    all: () => recs,
    async put(rec) {
      if (CHAINED.includes(rec.kind) && recs.some((r) => same(r, rec))) throw new Error("Locked records cannot be changed.");
      recs = [...recs.filter((r) => !same(r, rec)), rec]; save();
    },
    async patch(rec) { guard("patch", rec); recs = recs.map((r) => (same(r, rec) ? rec : r)); save(); },
    async remove(rec) { guard("remove", rec); recs = recs.filter((r) => !same(r, rec)); save(); },
    stop() {},
  };
}
