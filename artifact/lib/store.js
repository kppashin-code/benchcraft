import { CHAINED } from "./chain.js";

// Every table from the old SQLite schema becomes one collection; `_t` names it on each record.
export const KINDS = [
  "project", "folder", "experiment", "note", "step_note", "recording", "uploaded_paper",
  "reagent", "reagent_component", "reagent_use", "dataset", "ink_note", "highlight",
  "commitment", "challenge", "response", "resolution", "glossary", "connector",
  "connector_call", "paper_digest", "paper_note", "experiment_paper", "todo", "todo_notes", "setting",
  "storage", "box", "vial", "cell_line", "line_event",
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
  if (op !== "put" && CHAINED.includes(rec._t)) throw new Error("Locked records cannot be changed or deleted.");
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
      data[k] = new Map(snap.docs.map((d) => [d.id, { ...d.data(), _t: k }]));
      if (!snap.metadata.fromCache) ready.add(k);
      emit({ full: snap.size >= 1000 ? k : null });
    },
    (e) => emit({ error: e.message || e.code }),
  ));
  const col = (rec) => root.collection(rec._t).doc(docId(rec));
  return {
    mode: "cloud",
    all: () => flat,
    async put(rec) {
      if (CHAINED.includes(rec._t) && data[rec._t].has(docId(rec))) throw new Error("Locked records cannot be changed.");
      data[rec._t].set(docId(rec), rec); emit({});
      await col(rec).set(rec);
    },
    async patch(rec) { guard("patch", rec); data[rec._t].set(docId(rec), rec); emit({}); await col(rec).set(rec); },
    async remove(rec) { guard("remove", rec); data[rec._t].delete(docId(rec)); emit({}); await col(rec).delete(); },
    stop: () => stops.forEach((s) => s()),
  };
}

// Used outside Claude, for local testing; data stays in this browser only.
function localStore(onChange) {
  const KEY = "benchcraft-local-v3";
  let recs = [];
  try { recs = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { recs = []; }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(recs)); } catch { /* storage blocked */ }
    onChange(recs, { mode: "local", ready: true });
  };
  setTimeout(() => onChange(recs, { mode: "local", ready: true }), 0);
  const same = (a, b) => a._t === b._t && docId(a) === docId(b);
  return {
    mode: "local",
    all: () => recs,
    async put(rec) {
      if (CHAINED.includes(rec._t) && recs.some((r) => same(r, rec))) throw new Error("Locked records cannot be changed.");
      recs = [...recs.filter((r) => !same(r, rec)), rec]; save();
    },
    async patch(rec) { guard("patch", rec); recs = recs.map((r) => (same(r, rec) ? rec : r)); save(); },
    async remove(rec) { guard("remove", rec); recs = recs.filter((r) => !same(r, rec)); save(); },
    stop() {},
  };
}
