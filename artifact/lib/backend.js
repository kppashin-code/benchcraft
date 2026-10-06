// The routes from benchcraft/app.py, answered inside the page against the researcher's own storage.
import { openStore } from "./store.js";
import { seal, verify, ledgerOf } from "./chain.js";
import { bundle, stage, experimentText, folderHistory, calibration, graph, byKind } from "./cycle.js";
import * as P from "./prompts.js";
import * as calc from "./calc.js";
import { TEMPLATES, byId as templateById } from "./templates.js";
import * as datafiles from "./datafiles.js";
import { suggestQuery } from "./literature.js";

let store = null;
let recs = [];
let meta = {};
let lastId = 0;
const listeners = new Set();

const now = () => new Date().toISOString().slice(0, 19) + "+00:00";
// Numeric ids keep the original interface's +id conversions working.
const nextId = () => { lastId = Math.max(lastId + 1, Date.now() * 1000); return lastId; };

class HttpError extends Error {}
const fail = (msg) => { throw new HttpError(msg); };

const all = (kind) => byKind(recs, kind);
const get = (kind, id) => recs.find((r) => r.kind === kind && r.id === Number(id)) || null;
const need = (kind, id, what) => get(kind, id) || fail(`No such ${what || kind}`);

async function ins(kind, fields) {
  const rec = { kind, id: nextId(), created_at: now(), ...fields };
  await store.put(rec);
  return rec;
}
async function insChained(kind, fields) {
  const rec = await seal({ kind, id: nextId(), ...fields }, ledgerOf(recs));
  await store.put(rec);
  return rec;
}
const upd = (rec, fields) => store.patch({ ...rec, ...fields });
const del = (rec) => store.remove(rec);
const exp = (id) => bundle(recs, Number(id));

export function onChange(fn) { listeners.add(fn); }
export const status = () => meta;
export const chainCheck = () => verify(recs);

let initP = null;
export function init() {
  return (initP ||= (async () => {
    let ready;
    const isReady = new Promise((r) => { ready = r; });
    store = await openStore((r, m) => {
      recs = r; meta = m;
      if (m.ready) ready();
      for (const fn of listeners) fn(m);
    });
    await Promise.race([isReady, new Promise((r) => setTimeout(r, 8000))]);
  })());
}

// ---------- model calls, on the viewer's own Claude account ----------

const SAMPLE_ERRORS = {
  not_granted: "Benchcraft was not allowed to use Claude in this view. Allow it from the artifact's permissions menu.",
  sampling_disabled: "Claude is not available for this account.",
  rate_limited: "Claude is busy or your usage limit was reached. Wait a moment and try again.",
  refused: "The model declined to answer this request. Nothing was saved. Rephrase and try again.",
  invalid_json: "The answer could not be read as structured output. Nothing was saved. Try again.",
  session_expired: "Sign in to Claude again, then retry.",
  prompt_too_large: "This is too much to send at once. Nothing was saved.",
};

async function ask(input, { json = true, check = null } = {}) {
  const sample = window.claude ? await window.claude.use("sample") : null;
  if (!sample) fail("This needs Claude. Open Benchcraft inside Claude to use it; everything else works without it.");
  try {
    if (!json) return (await sample(input, { modelTier: "complex" })).text;
    const out = await sample.json(input, { modelTier: "complex" });
    const bad = check ? check(out) : "";
    if (bad) fail(`The answer came back incomplete (${bad}). Nothing was saved. Try again.`);
    return out;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(SAMPLE_ERRORS[e.code] || `The model call failed (${e.code || e.message}). Nothing was saved.`);
  }
}

// ---------- files, kept in the artifact's own asset store ----------

async function assetsApi() {
  const a = window.claude ? await window.claude.use("assets") : null;
  if (!a) fail("Files can only be stored when Benchcraft is open inside Claude.");
  return a;
}
async function putFile(file) {
  const a = await assetsApi();
  try { return await a.upload(file); } catch (e) { fail(`Could not store that file (${e.code || e.message}).`); }
}
async function dropFile(id) {
  if (!id) return;
  try { const a = await window.claude?.use("assets"); if (a) await a.delete(id); } catch { /* already gone */ }
}
export const fileUrl = (rec) => (rec && rec.asset_id ? "/_blob/" + rec.asset_id : "");

export async function download(rec) {
  const d = window.claude ? await window.claude.use("downloads") : null;
  if (!d) fail("Downloads are not available in this view.");
  const blob = await (await fetch(fileUrl(rec))).blob();
  await d.save({ filename: rec.filename, data: blob });
}

// ---------- pdf text, through pdf.js loaded by the page ----------

async function pdfText(blob, maxPages = 200) {
  const lib = window.pdfjsLib;
  if (!lib) fail("The PDF reader did not load.");
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => it.str).join(" "));
  }
  const info = (await doc.getMetadata().catch(() => ({}))).info || {};
  return { pages, info };
}

const cleanText = (t) => t.replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/[ \t]{2,}/g, " ");

// ---------- shared helpers ported from app.py ----------

function reagentStatus(r) {
  if (r.amount_left != null && r.amount_left <= 0) return "out";
  if (r.amount_left != null && r.low_at != null && r.amount_left <= r.low_at) return "low";
  return "ok";
}

function reagentBundle(id) {
  const r = get("reagent", id);
  if (!r) return null;
  const reagents = new Map(all("reagent").map((x) => [x.id, x]));
  const exps = new Map(all("experiment").map((x) => [x.id, x]));
  return {
    ...r, status: reagentStatus(r),
    components: all("reagent_component").filter((c) => c.reagent_id === r.id).sort((a, b) => a.position - b.position || a.id - b.id)
      .map((c) => ({ ...c, source_name: reagents.get(c.source_reagent_id)?.name ?? null, source_lot: reagents.get(c.source_reagent_id)?.lot ?? null })),
    uses: all("reagent_use").filter((u) => u.reagent_id === r.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((u) => ({ ...u, experiment_title: exps.get(u.experiment_id)?.title ?? null })),
    used_in: [...new Map(all("reagent_component").filter((c) => c.source_reagent_id === r.id)
      .map((c) => [c.reagent_id, { reagent_id: c.reagent_id, name: reagents.get(c.reagent_id)?.name }])).values()].filter((x) => x.name),
  };
}

function listReagents(pid, includeArchived = false) {
  return all("reagent").filter((r) => r.project_id === Number(pid) && (includeArchived || !r.archived))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((r) => ({
      ...r, status: reagentStatus(r),
      component_count: all("reagent_component").filter((c) => c.reagent_id === r.id).length,
      use_count: all("reagent_use").filter((u) => u.reagent_id === r.id).length,
    }));
}

const listFolders = (pid) => all("folder").filter((f) => f.project_id === Number(pid)).sort((a, b) => a.name.localeCompare(b.name))
  .map((f) => ({ ...f, n: all("experiment").filter((e) => e.folder_id === f.id).length }));

const glossary = (pid) => all("glossary").filter((g) => g.project_id === Number(pid)).sort((a, b) => a.term.localeCompare(b.term));

async function upsertGlossary(pid, term, plain, source, overwrite) {
  const existing = all("glossary").find((g) => g.project_id === Number(pid) && g.term === term);
  if (existing) { if (overwrite) await upd(existing, { plain, ...(source === "curated" ? { source } : {}) }); return; }
  await ins("glossary", { project_id: Number(pid), term, plain, source });
}

function glossaryMatches(pid, eid) {
  const e = exp(eid) || fail("No such experiment");
  const text = experimentText(e).toLowerCase();
  return glossary(pid).filter((g) => {
    const esc = g.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`).test(text);
  });
}

function splitAuthors(raw) {
  raw = (raw || "").trim();
  if (!raw) return [];
  for (const sep of [";", " and ", "&"]) if (raw.includes(sep)) return raw.split(sep).map((a) => a.trim()).filter(Boolean).slice(0, 3);
  const parts = raw.split(",").map((a) => a.trim()).filter(Boolean);
  if (parts.some((a) => a.replace(/\./g, "").length <= 2)) return [raw];
  return parts.slice(0, 3);
}

function uploadedItem(key) {
  if (!String(key).startsWith("upload:")) return null;
  const r = get("uploaded_paper", key.split(":")[1]);
  if (!r) return null;
  return {
    key, type: "uploaded", title: r.title, abstract: "", date: r.year, doi: r.doi, url: fileUrl(r),
    journal: r.journal, authors: splitAuthors(r.authors), more_authors: 0, tags: [], notes: [], annotations: [],
    engaged: true, has_pdf: !!r.asset_id, filename: r.filename, source: "upload",
  };
}

const digestKeys = () => new Set(all("paper_digest").map((d) => d.zotero_key));
const notedKeys = () => new Set(all("paper_note").filter((n) => n.body).map((n) => n.zotero_key));

function listUploaded(pid) {
  const dg = digestKeys(), nt = notedKeys();
  return all("uploaded_paper").filter((r) => r.project_id === Number(pid)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((r) => { const it = uploadedItem(`upload:${r.id}`); return { ...it, has_digest: dg.has(it.key), has_my_note: nt.has(it.key) }; });
}

async function getPaper(key) {
  let it = uploadedItem(key);
  if (!it) { it = await zot("zotero_item", { key }); if (!it || !it.key) fail("Not found in your library or uploads"); }
  const d = all("paper_digest").find((x) => x.zotero_key === key) || null;
  const note = all("paper_note").find((x) => x.zotero_key === key);
  return { item: it, digest: d, my_note: note ? note.body : "" };
}

// ---------- routes ----------

const R = [];
const route = (method, pattern, fn) => R.push([method, new RegExp("^" + pattern.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)") + "$"), fn]);

route("GET", "/projects", () => all("project").sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
route("POST", "/projects", (_, b) => ins("project", { name: b.name, description: b.description || "" }));

route("GET", "/projects/{pid}/experiments", ({ pid }) =>
  all("experiment").filter((e) => e.project_id === Number(pid)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((e) => {
    const b = exp(e.id);
    return {
      ...b, commitment_count: b.commitments.length, recording_count: b.recordings.length,
      challenge_count: b.commitments.reduce((s, c) => s + c.challenges.length, 0),
      response_count: b.commitments.reduce((s, c) => s + c.challenges.reduce((t, ch) => t + ch.responses.length, 0), 0),
      stage: stage(b),
    };
  }));

route("POST", "/projects/{pid}/experiments", async ({ pid }, b) => {
  need("project", pid);
  const e = await ins("experiment", {
    project_id: Number(pid), parent_experiment_id: b.parent_experiment_id || null, folder_id: b.folder_id || null,
    title: b.title, mode: ["notebook", "cycle"].includes(b.mode) ? b.mode : "notebook",
    question: b.question || "", context: b.context || {},
  });
  const tpl = b.template ? templateById(b.template) : null;
  if (tpl) {
    for (const step of tpl.protocol) await ins("note", { experiment_id: e.id, body: step, source: "protocol", recording_id: null });
    for (const [term, plain] of tpl.glossary) await upsertGlossary(pid, term, plain, "curated", false);
  }
  return exp(e.id);
});

route("GET", "/experiments/{id}", ({ id }) => exp(id) || fail("No such experiment"));

route("PUT", "/experiments/{id}/mode", async ({ id }, b) => {
  if (!["notebook", "cycle"].includes(b.mode)) fail("mode must be notebook or cycle");
  const e = exp(id) || fail("No such experiment");
  if (b.mode === "notebook" && e.commitments.length) {
    fail("This entry already has a locked commitment. Leaving the cycle would orphan it, and a commitment cannot be recreated. Delete the entry if you really want it gone.");
  }
  await upd(get("experiment", id), { mode: b.mode });
  return exp(id);
});

route("GET", "/projects/{pid}/reagents", ({ pid }, _, q) => listReagents(pid, q.get("include_archived") === "true"));
const reagentFields = (b) => ({
  name: (b.name || "").trim(), kind: b.kind || "reagent", supplier: b.supplier || "", catalogue: b.catalogue || "",
  lot: b.lot || "", concentration: b.concentration || "", unit: b.unit || "", amount_total: b.amount_total ?? null,
  amount_left: b.amount_left ?? null, low_at: b.low_at ?? null, location: b.location || "",
  opened_at: b.opened_at || "", expires_at: b.expires_at || "", notes: b.notes || "",
});
route("POST", "/projects/{pid}/reagents", async ({ pid }, b) => {
  if (!(b.name || "").trim()) fail("A name, at least.");
  const f = reagentFields(b);
  if (f.amount_left == null) f.amount_left = f.amount_total;
  const r = await ins("reagent", { project_id: Number(pid), archived: 0, ...f });
  return reagentBundle(r.id);
});
route("GET", "/reagents/{id}", ({ id }) => reagentBundle(id) || fail("No such reagent"));
route("PUT", "/reagents/{id}", async ({ id }, b) => { await upd(need("reagent", id), reagentFields(b)); return reagentBundle(id); });
route("DELETE", "/reagents/{id}", async ({ id }) => { const r = need("reagent", id); await upd(r, { archived: 1 }); return listReagents(r.project_id); });
route("POST", "/reagents/{id}/components", async ({ id }, b) => {
  need("reagent", id);
  const n = all("reagent_component").filter((c) => c.reagent_id === Number(id)).length;
  await ins("reagent_component", { reagent_id: Number(id), name: (b.name || "").trim(), final_conc: b.final_conc || "", source_reagent_id: b.source_reagent_id || null, position: n });
  return reagentBundle(id);
});
route("DELETE", "/components/{id}", async ({ id }) => { const c = need("reagent_component", id, "component"); await del(c); return reagentBundle(c.reagent_id); });
route("POST", "/reagents/{id}/use", async ({ id }, b) => {
  const r = need("reagent", id);
  await ins("reagent_use", { reagent_id: r.id, experiment_id: b.experiment_id || null, amount: b.amount ?? null, note: b.note || "" });
  if (b.amount && r.amount_left != null) await upd(get("reagent", id), { amount_left: Math.max(0, r.amount_left - b.amount) });
  return reagentBundle(id);
});
route("DELETE", "/uses/{id}", async ({ id }) => {
  const u = need("reagent_use", id, "entry");
  const r = get("reagent", u.reagent_id);
  if (u.amount && r && r.amount_left != null) await upd(r, { amount_left: r.amount_left + u.amount });
  await del(u);
  return reagentBundle(u.reagent_id);
});
route("GET", "/projects/{pid}/restock", ({ pid }) => listReagents(pid).filter((r) => ["low", "out"].includes(r.status)).map((r) => ({
  id: r.id, name: r.name, status: r.status, supplier: r.supplier, catalogue: r.catalogue, lot: r.lot,
  amount_left: r.amount_left, unit: r.unit, location: r.location,
  percent_left: r.amount_total ? Math.round((100 * (r.amount_left || 0)) / r.amount_total) : null,
})));

route("GET", "/experiments/{id}/deletion_preview", ({ id }) => {
  const e = exp(id) || fail("No such experiment");
  return {
    title: e.title, notes: e.notes.length, recordings: e.recordings.length, ink: e.ink.length,
    highlights: e.highlights.length, papers: e.papers.length, commitments: e.commitments.length,
    challenges: e.commitments.reduce((s, c) => s + c.challenges.length, 0),
    resolutions: e.commitments.filter((c) => c.resolution).length,
    children: all("experiment").filter((c) => c.parent_experiment_id === Number(id)).map((c) => c.title),
  };
});
route("DELETE", "/experiments/{id}", async ({ id }) => {
  const e = need("experiment", id, "experiment");
  const eid = e.id;
  for (const c of all("experiment").filter((x) => x.parent_experiment_id === eid)) await upd(c, { parent_experiment_id: null });
  const noteIds = new Set(all("note").filter((n) => n.experiment_id === eid).map((n) => n.id));
  for (const r of all("recording").filter((x) => x.experiment_id === eid)) { await dropFile(r.asset_id); await del(r); }
  for (const kind of ["note", "ink_note", "highlight", "experiment_paper", "connector_call"]) {
    for (const r of all(kind).filter((x) => x.experiment_id === eid)) await del(r);
  }
  for (const s of all("step_note").filter((x) => noteIds.has(x.note_id))) await del(s);
  for (const d of all("dataset").filter((x) => x.experiment_id === eid)) await upd(d, { experiment_id: null });
  for (const u of all("reagent_use").filter((x) => x.experiment_id === eid)) await upd(u, { experiment_id: null });
  // Locked records stay in the chain; without their experiment they drop out of every view.
  await del(e);
  return { deleted: eid, project_id: e.project_id };
});

route("DELETE", "/notes/{id}", async ({ id }) => {
  const n = need("note", id, "note");
  for (const s of all("step_note").filter((x) => x.note_id === n.id)) await del(s);
  await del(n);
  return exp(n.experiment_id);
});
route("POST", "/experiments/{id}/notes", async ({ id }, b) => {
  need("experiment", id, "experiment");
  await ins("note", { experiment_id: Number(id), body: b.body, source: b.source || "typed", recording_id: b.recording_id || null });
  return exp(id);
});
route("POST", "/experiments/{id}/ink", async ({ id }, b) => {
  need("experiment", id, "experiment");
  if (!b.strokes || !b.strokes.length) fail("Nothing written.");
  const strokes = JSON.stringify(b.strokes);
  if (strokes.length > 240000) fail("That page is too dense to save in one go. Save it in two.");
  await ins("ink_note", { experiment_id: Number(id), strokes, width: b.width, height: b.height });
  return exp(id);
});
route("DELETE", "/ink/{id}", async ({ id }) => { const r = need("ink_note", id, "ink note"); await del(r); return exp(r.experiment_id); });
route("POST", "/experiments/{id}/highlights", async ({ id }, b) => {
  const text = (b.body || "").trim();
  if (!text) fail("Nothing selected.");
  need("experiment", id, "experiment");
  if (!all("highlight").some((h) => h.experiment_id === Number(id) && h.body === text)) await ins("highlight", { experiment_id: Number(id), body: text });
  return exp(id);
});
route("DELETE", "/highlights/{id}", async ({ id }) => { const h = need("highlight", id); await del(h); return exp(h.experiment_id); });
route("POST", "/notes/{id}/annotations", async ({ id }, b) => {
  const n = need("note", id, "line");
  if (!(b.body || "").trim()) fail("Nothing written.");
  await ins("step_note", { note_id: n.id, body: b.body.trim() });
  return exp(n.experiment_id);
});
route("DELETE", "/annotations/{id}", async ({ id }) => {
  const a = need("step_note", id, "annotation");
  const n = get("note", a.note_id);
  await del(a);
  return exp(n.experiment_id);
});

route("GET", "/datasets/{id}", async ({ id }) => {
  const d = need("dataset", id, "dataset");
  let prev = { header: [], rows: [] };
  if (d.asset_id && datafiles.ALLOWED[datafiles.suffixOf(d.filename)] === "table") {
    try { prev = datafiles.preview(d.filename, await (await fetch(fileUrl(d))).text()); } catch { /* preview is optional */ }
  }
  return { ...d, exists: !!d.asset_id, preview: prev };
});
route("PUT", "/datasets/{id}", async ({ id }, b) => {
  await upd(need("dataset", id, "dataset"), { kind: b.kind, label: b.label, notes: b.notes });
  return R_get(`/datasets/${id}`);
});
route("DELETE", "/datasets/{id}", async ({ id }) => {
  const d = need("dataset", id, "dataset");
  await dropFile(d.asset_id);
  await del(d);
  return d.experiment_id ? exp(d.experiment_id) : { deleted: d.id };
});
route("GET", "/projects/{pid}/datasets", ({ pid }) => all("dataset").filter((d) => d.project_id === Number(pid))
  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((d) => {
    const e = get("experiment", d.experiment_id);
    const f = e && get("folder", e.folder_id);
    return { ...d, experiment_title: e ? e.title : null, folder_name: f ? f.name : null };
  }));

route("GET", "/templates", () => TEMPLATES);
route("POST", "/calc", (_, b) => { try { return calc.run(b.kind, b.args || {}); } catch (e) { fail(e.message); } });

route("GET", "/transcription/status", () => ({
  ready: false, engine: "",
  missing: ["Dictate straight into any box with Handy, which transcribes on your Mac.", "Uploaded memos are kept with the entry; type or paste their transcript yourself."],
}));
route("DELETE", "/recordings/{id}", async ({ id }) => { const r = need("recording", id, "recording"); await dropFile(r.asset_id); await del(r); return exp(r.experiment_id); });
route("POST", "/recordings/{id}/transcribe", () => fail("Automatic transcription now happens on your Mac with Handy. Play the memo with Handy listening, or type the transcript."));
route("PUT", "/recordings/{id}/transcript", async ({ id }, b) => {
  const r = need("recording", id, "recording");
  await upd(r, { transcript: b.transcript, transcript_engine: "edited by hand", transcript_state: "done" });
  return exp(r.experiment_id);
});

route("POST", "/commitments/{id}/challenge", async ({ id }) => {
  const c = need("commitment", id, "commitment");
  const e = exp(c.experiment_id);
  const f = get("folder", e.folder_id);
  const blind = await ask(P.blindInput(e, c, folderHistory(recs, e.id), f ? f.name : ""), { check: P.checkBlind });
  const div = await ask(P.divergenceInput(e, c, blind), { check: P.checkDivergence });
  await insChained("challenge", { commitment_id: c.id, model: "claude.ai, complex tier", blind, divergence: div, created_at: now() });
  return exp(c.experiment_id);
});
route("POST", "/experiments/{id}/commitments", async ({ id }, b) => {
  need("experiment", id, "experiment");
  if (!(b.observed || "").trim() || !(b.interpretation || "").trim()) fail("You need what you saw and what you make of it. Everything else is optional.");
  const c = await insChained("commitment", {
    experiment_id: Number(id), aim: b.aim || "", expected: b.expected || "", observed: b.observed, interpretation: b.interpretation,
    confidence: b.confidence ?? null, disconfirming: b.disconfirming || "", proposed_next: b.proposed_next || "", locked_at: now(),
  });
  return { commitment_id: c.id, experiment: exp(id) };
});
route("POST", "/challenges/{id}/response", async ({ id }, b) => {
  const ch = need("challenge", id, "challenge");
  if (!["held", "revised", "overturned"].includes(b.stance)) fail("stance must be held, revised or overturned");
  await insChained("response", { challenge_id: ch.id, stance: b.stance, reasoning: b.reasoning || "", confidence_after: b.confidence_after ?? null, chosen_next: b.chosen_next || "", created_at: now() });
  return exp(get("commitment", ch.commitment_id).experiment_id);
});
route("POST", "/commitments/{id}/resolution", async ({ id }, b) => {
  const c = need("commitment", id, "commitment");
  if (!["held", "partly", "overturned", "unresolved"].includes(b.verdict)) fail("bad verdict");
  await insChained("resolution", { commitment_id: c.id, verdict: b.verdict, notes: b.notes || "", created_at: now() });
  return exp(c.experiment_id);
});

route("GET", "/projects/{pid}/glossary", ({ pid }) => glossary(pid));
route("POST", "/projects/{pid}/glossary", async ({ pid }, b) => { await upsertGlossary(pid, b.term.trim(), b.plain.trim(), "curated", true); return glossary(pid); });
route("DELETE", "/glossary/{id}", async ({ id }) => { const g = need("glossary", id, "entry"); await del(g); return glossary(g.project_id); });
route("POST", "/projects/{pid}/glossary/detect", async ({ pid }) => {
  const text = all("experiment").filter((e) => e.project_id === Number(pid)).map((e) => experimentText(exp(e.id))).join("\n");
  if (!text.trim()) return glossary(pid);
  const out = await ask(P.glossaryInput(text, glossary(pid).map((g) => g.term)), { check: P.checkGlossary });
  for (const e of out.entries) await upsertGlossary(pid, e.term.trim(), e.plain.trim(), "ai", false);
  return glossary(pid);
});
route("GET", "/projects/{pid}/glossary/matches/{eid}", ({ pid, eid }) => glossaryMatches(pid, eid));
route("POST", "/projects/{pid}/glossary/define", async ({ pid }, b) => {
  const term = (b.term || "").trim();
  if (!term || term.length > 80) fail("Select a word or short phrase.");
  const found = () => all("glossary").find((g) => g.project_id === Number(pid) && g.term.toLowerCase() === term.toLowerCase());
  if (found()) return found();
  const e = b.experiment_id ? exp(b.experiment_id) : null;
  const out = await ask(P.defineInput(term, e ? experimentText(e) : ""), { check: P.checkGlossary });
  const entry = out.entries.find((x) => x.term.trim().toLowerCase() === term.toLowerCase()) || out.entries[0] || { term, plain: "No confident definition." };
  const name = entry.term.trim() || term;
  await upsertGlossary(pid, name, entry.plain.trim(), "ai", true);
  return all("glossary").find((g) => g.project_id === Number(pid) && g.term.toLowerCase() === name.toLowerCase());
});

route("GET", "/connectors/suggested", () => [
  { name: "OrganoidAgent (Zitnik Lab)", endpoint: "", key_env: "", note: "Outside services reach Benchcraft through the connectors on your Claude account. Add the lab's connector there, and it will show up here." },
]);
route("GET", "/projects/{pid}/connectors", ({ pid }) => all("connector").filter((c) => c.project_id === Number(pid)).sort((a, b) => a.name.localeCompare(b.name)));
route("POST", "/projects/{pid}/connectors", async ({ pid }, b) => {
  await ins("connector", { project_id: Number(pid), name: b.name, endpoint: b.endpoint || "", key_env: b.key_env || "", note: b.note || "", enabled: b.enabled ? 1 : 0 });
  return all("connector").filter((c) => c.project_id === Number(pid));
});
route("DELETE", "/connectors/{id}", async ({ id }) => { const c = need("connector", id); await del(c); return all("connector").filter((x) => x.project_id === c.project_id); });
route("POST", "/connectors/{id}/call", () => fail("A web page inside Claude cannot call an outside address directly. This tool needs to be added as a connector on your Claude account."));

route("GET", "/projects/{pid}/folders", ({ pid }) => listFolders(pid));
route("POST", "/projects/{pid}/folders", async ({ pid }, b) => {
  if (!(b.name || "").trim()) fail("A name, at least.");
  await ins("folder", { project_id: Number(pid), name: b.name.trim() });
  return listFolders(pid);
});
route("DELETE", "/folders/{id}", async ({ id }) => {
  const f = need("folder", id);
  for (const e of all("experiment").filter((x) => x.folder_id === f.id)) await upd(e, { folder_id: null });
  await del(f);
  return listFolders(f.project_id);
});
route("PUT", "/experiments/{id}/folder", async ({ id }, b) => { await upd(need("experiment", id, "experiment"), { folder_id: b.folder_id || null }); return exp(id); });

route("GET", "/projects/{pid}/suggestions", ({ pid }) => {
  const keys = {};
  for (const e of all("experiment").filter((x) => x.project_id === Number(pid))) {
    for (let [k, v] of Object.entries(e.context || {})) {
      k = k.trim(); v = String(v).trim();
      if (!k || !v) continue;
      (keys[k] ||= {})[v] = (keys[k][v] || 0) + 1;
    }
  }
  const total = (k) => Object.values(keys[k]).reduce((a, b) => a + b, 0);
  const context_values = Object.fromEntries(Object.entries(keys).map(([k, vs]) => [k, Object.entries(vs).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)]));
  return { context_keys: Object.keys(keys).sort((a, b) => total(b) - total(a) || a.localeCompare(b)), context_values, terms: glossary(pid).map((g) => g.term) };
});

route("GET", "/experiments/{id}/literature/suggest", ({ id }) => {
  const e = exp(id) || fail("No such experiment");
  return { query: suggestQuery(e, glossaryMatches(e.project_id, e.id).map((g) => g.term)) };
});
route("POST", "/literature/search", () => fail("Searching Europe PMC from inside Claude needs a literature connector on your Claude account. Until then, use Suggest from record and paste the query into europepmc.org."));

// Zotero is read off disk by benchcraft/zotero_mcp.py, reached through the Claude desktop app.
const ZOTERO = "host:benchcraft-zotero";
async function zot(tool, args = {}) {
  const m = window.claude ? await window.claude.use("mcp") : null;
  if (!m) fail("Zotero is reached through the Claude desktop app. Open Benchcraft there.");
  try {
    const r = await m.callTool(ZOTERO, tool, args);
    return r.payload ?? JSON.parse(r.content?.[0]?.text || "null");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e.code === "server_not_connected") fail("The Zotero helper is not running. Open Benchcraft in the Claude desktop app, where the helper is set up.");
    if (e.code === "not_granted" || e.code === "approval_required") fail("Benchcraft was not allowed to read Zotero in this view. Allow it from the artifact's permissions menu.");
    fail(`Zotero could not be read (${e.code || e.message}).`);
  }
}
const withFlags = (items) => { const dg = digestKeys(), nt = notedKeys(); return items.map((it) => ({ ...it, has_digest: dg.has(it.key), has_my_note: nt.has(it.key) })); };
route("GET", "/zotero/status", async () => {
  try { return await zot("zotero_status"); } catch (e) { return { ready: false, detail: e.message }; }
});
route("GET", "/zotero/collections", async () => (await zot("zotero_collections")).collections || []);
route("GET", "/zotero/items", async (_, __, q) => withFlags((await zot("zotero_items", { collection: q.get("collection") || "", engaged_only: q.get("engaged_only") === "true" })).items || []));

route("POST", "/projects/{pid}/papers/upload", () => fail("Use the upload box."));
route("GET", "/projects/{pid}/papers/uploaded", ({ pid }) => listUploaded(pid));
route("DELETE", "/uploaded_papers/{id}", async ({ id }) => {
  const r = need("uploaded_paper", id, "paper");
  await dropFile(r.asset_id);
  await del(r);
  return listUploaded(r.project_id);
});
route("GET", "/papers/{key}", ({ key }) => getPaper(decodeURIComponent(key)));
route("POST", "/papers/{key}/digest", async ({ key }) => {
  key = decodeURIComponent(key);
  let it = uploadedItem(key), text, source;
  if (it) {
    const r = get("uploaded_paper", key.split(":")[1]);
    if (!r.asset_id) fail("This paper came across without its PDF. Drop the PDF in again to digest it.");
    try {
      const { pages } = await pdfText(await (await fetch(fileUrl(r))).blob());
      text = cleanText(pages.join("\n")).trim().slice(0, 60000);
    } catch (e) { if (e instanceof HttpError) throw e; fail(`Could not read that PDF: ${e.message}`); }
    if (text.length < 400) fail("That PDF has no extractable text. It may be a scan.");
    source = `full text, ${r.filename}`;
  } else {
    it = await zot("zotero_item", { key });
    if (!it || !it.key) fail("Not in your Zotero library");
    ({ text, source } = await zot("zotero_text", { key }));
  }
  const d = await ask(P.digestInput(it.title, text, source), { check: P.checkDigest });
  const old = all("paper_digest").find((x) => x.zotero_key === key);
  const fields = { zotero_key: key, main_claim: d.main_claim, experiments: d.experiments || [], methods: d.methods || [], limitations: d.limitations || [], source, model: "claude.ai, complex tier", created_at: now() };
  if (old) await upd(old, fields); else await ins("paper_digest", fields);
  return getPaper(key);
});
route("PUT", "/papers/{key}/note", async ({ key }, b) => {
  key = decodeURIComponent(key);
  const old = all("paper_note").find((x) => x.zotero_key === key);
  if (old) await upd(old, { body: b.body, updated_at: now() }); else await ins("paper_note", { zotero_key: key, body: b.body, updated_at: now() });
  return getPaper(key);
});
route("POST", "/experiments/{id}/papers", async ({ id }, b) => {
  need("experiment", id, "experiment");
  if (!all("experiment_paper").some((p) => p.experiment_id === Number(id) && p.zotero_key === b.zotero_key)) {
    await ins("experiment_paper", { experiment_id: Number(id), zotero_key: b.zotero_key });
  }
  return exp(id);
});
route("DELETE", "/experiments/{id}/papers/{key}", async ({ id, key }) => {
  key = decodeURIComponent(key);
  for (const p of all("experiment_paper").filter((x) => x.experiment_id === Number(id) && x.zotero_key === key)) await del(p);
  return exp(id);
});

route("GET", "/projects/{pid}/brief", async ({ pid }) => {
  const project = need("project", pid, "project");
  const exps = all("experiment").filter((e) => e.project_id === project.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((e) => exp(e.id));
  const input = P.briefInput(project, exps);
  if (!input) return { markdown: "_No locked commitments yet, nothing to brief on._" };
  return { markdown: await ask(input, { json: false }) };
});
route("GET", "/projects/{pid}/graph", ({ pid }) => graph(recs, Number(pid)));
route("GET", "/projects/{pid}/calibration", ({ pid }) => calibration(recs, Number(pid)));

const TODO_STATUS = ["general", "progress", "done"];
const listTodos = () => all("todo").sort((a, b) => a.position - b.position || a.id - b.id);
const todoFields = (b) => {
  const f = {};
  for (const k of ["title", "body", "due", "kind_of", "icon"]) if (k in b) f[k] = String(b[k] ?? "");
  if ("status" in b) f.status = TODO_STATUS.includes(b.status) ? b.status : "general";
  if ("position" in b) f.position = Number(b.position) || 0;
  if ("experiment_id" in b) f.experiment_id = b.experiment_id ? Number(b.experiment_id) : null;
  if ("favorite" in b) f.favorite = !!b.favorite;
  if ("trashed" in b) f.trashed_at = b.trashed ? now() : null;
  return f;
};
route("GET", "/todos", () => listTodos());
route("POST", "/todos", async (_, b) => {
  const status = TODO_STATUS.includes(b.status) ? b.status : "general";
  const col = listTodos().filter((t) => t.status === status);
  const position = "position" in b ? Number(b.position) : (col.length ? col[col.length - 1].position : 0) + 1;
  await ins("todo", { title: "", body: "", due: "", icon: "", kind_of: "task", experiment_id: null, favorite: false, trashed_at: null, ...todoFields(b), status, position, updated_at: now() });
  return listTodos();
});
route("PUT", "/todos/{id}", async ({ id }, b) => { await upd(need("todo", id, "task"), { ...todoFields(b), updated_at: now() }); return listTodos(); });
route("DELETE", "/todos/{id}", async ({ id }) => { await del(need("todo", id, "task")); return listTodos(); });
route("GET", "/todo_notes", () => all("todo_notes")[0] || { body: "", updated_at: null });
route("PUT", "/todo_notes", async (_, b) => {
  const old = all("todo_notes")[0];
  if (old) await upd(old, { body: String(b.body ?? ""), updated_at: now() });
  else await ins("todo_notes", { body: String(b.body ?? ""), updated_at: now() });
  return all("todo_notes")[0];
});

async function R_get(path) { return api(path); }

export async function api(path, method = "GET", body) {
  await init();
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs || "");
  for (const [m, re, fn] of R) {
    if (m !== method) continue;
    const hit = re.exec(p);
    if (hit) {
      const out = await fn(hit.groups || {}, body || {}, q);
      return JSON.parse(JSON.stringify(out ?? null));
    }
  }
  throw new Error(`Not found: ${method} ${p}`);
}

// ---------- uploads, replacing the multipart routes ----------

export async function uploadDataset(eid, file, kind) {
  const e = need("experiment", eid, "experiment");
  datafiles.check(file.name, file.size);
  const isTable = datafiles.ALLOWED[datafiles.suffixOf(file.name)] === "table";
  const prof = isTable ? datafiles.profile(file.name, await file.text()) : { n_rows: null, n_cols: null, columns: [] };
  const asset = await putFile(file);
  const d = await ins("dataset", {
    project_id: e.project_id, experiment_id: e.id, kind: kind || "other", label: file.name.replace(/\.[^.]+$/, ""),
    filename: file.name, asset_id: asset.id, size_bytes: file.size, n_rows: prof.n_rows, n_cols: prof.n_cols,
    columns: prof.columns, notes: "",
  });
  return { dataset_id: d.id, experiment: exp(e.id) };
}

export async function uploadRecording(eid, file) {
  need("experiment", eid, "experiment");
  if (!/^(audio|video)\//.test(file.type)) fail(`Unsupported file type '${datafiles.suffixOf(file.name)}'`);
  const asset = await putFile(file);
  const r = await ins("recording", {
    experiment_id: Number(eid), filename: file.name, asset_id: asset.id, duration_s: null,
    transcript: "", transcript_engine: "", transcript_state: "pending", transcript_error: "",
  });
  return { recording_id: r.id, experiment: exp(eid) };
}

export async function uploadPaper(pid, file) {
  need("project", pid, "project");
  if (datafiles.suffixOf(file.name) !== ".pdf") fail("PDF only for now.");
  let title = file.name.replace(/\.pdf$/i, "").replace(/_/g, " ").trim();
  let authors = "", year = "", doi = "";
  try {
    const { pages, info } = await pdfText(file, 1);
    title = (info.Title || "").trim() || title;
    authors = (info.Author || "").trim();
    const first = (pages[0] || "").slice(0, 3000);
    const m = /\b(10\.\d{4,9}\/[^\s"<>]+)/.exec(first);
    if (m) doi = m[1].replace(/[.,;]+$/, "");
    const y = /\b(19|20)\d{2}\b/.exec(first);
    if (y) year = y[0];
  } catch { /* metadata is optional */ }
  const asset = await putFile(file);
  const r = await ins("uploaded_paper", { project_id: Number(pid), title: title || file.name, filename: file.name, asset_id: asset.id, authors, year, doi, journal: "" });
  return getPaper(`upload:${r.id}`);
}

export const recordingUrl = (r) => fileUrl(get("recording", r.id) || r);
export const datasetRecord = (id) => get("dataset", id);

// ---------- bringing in the old notebook, exported by export_notebook.py ----------

export async function importOldNotebook(dump) {
  await init();
  if (!dump || dump.benchcraft_export !== 1) fail("That is not a Benchcraft export file.");
  if (all("project").some((p) => p.imported)) fail("Your old notebook has already been brought in.");
  const map = {};
  const to = (table, old) => (old == null ? null : (map[table] || {})[old] ?? null);
  const set = (table, old, id) => { (map[table] ||= {})[old] = id; };
  const rows = (t) => dump[t] || [];
  const strip = (r, ...drop) => { const o = { ...r }; for (const k of ["id", ...drop]) delete o[k]; return o; };
  const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

  const empty = all("project").find((p) => ![...all("experiment"), ...all("folder"), ...all("reagent")].some((e) => e.project_id === p.id));
  for (const p of rows("projects")) {
    if (empty) { await upd(empty, { name: p.name, description: p.description, imported: true }); set("projects", p.id, empty.id); }
    else { const n = await ins("project", { ...strip(p), imported: true }); set("projects", p.id, n.id); }
  }
  for (const f of rows("folders")) set("folders", f.id, (await ins("folder", { ...strip(f), project_id: to("projects", f.project_id) })).id);
  for (const e of rows("experiments")) {
    const n = await ins("experiment", { ...strip(e, "context_json", "parent_experiment_id"), project_id: to("projects", e.project_id), folder_id: to("folders", e.folder_id), context: parse(e.context_json, {}), parent_experiment_id: null });
    set("experiments", e.id, n.id);
  }
  for (const e of rows("experiments")) {
    if (e.parent_experiment_id) await upd(get("experiment", to("experiments", e.id)), { parent_experiment_id: to("experiments", e.parent_experiment_id) });
  }
  for (const n of rows("notes")) set("notes", n.id, (await ins("note", { ...strip(n), experiment_id: to("experiments", n.experiment_id), recording_id: null })).id);
  for (const a of rows("step_notes")) await ins("step_note", { ...strip(a), note_id: to("notes", a.note_id) });
  for (const h of rows("highlights")) await ins("highlight", { ...strip(h), experiment_id: to("experiments", h.experiment_id) });
  for (const k of rows("ink_notes")) await ins("ink_note", { ...strip(k), experiment_id: to("experiments", k.experiment_id) });
  for (const r of rows("reagents")) set("reagents", r.id, (await ins("reagent", { ...strip(r), project_id: to("projects", r.project_id) })).id);
  for (const c of rows("reagent_components")) await ins("reagent_component", { ...strip(c), reagent_id: to("reagents", c.reagent_id), source_reagent_id: to("reagents", c.source_reagent_id) });
  for (const u of rows("reagent_uses")) await ins("reagent_use", { ...strip(u), reagent_id: to("reagents", u.reagent_id), experiment_id: to("experiments", u.experiment_id) });
  for (const d of rows("datasets")) await ins("dataset", { ...strip(d, "stored_path", "columns_json"), project_id: to("projects", d.project_id), experiment_id: to("experiments", d.experiment_id), columns: parse(d.columns_json, []), asset_id: null });
  for (const g of rows("glossary")) await upsertGlossary(to("projects", g.project_id), g.term, g.plain, g.source, false);
  for (const c of rows("connectors")) set("connectors", c.id, (await ins("connector", { ...strip(c), project_id: to("projects", c.project_id) })).id);
  for (const cc of rows("connector_calls")) await ins("connector_call", { ...strip(cc), connector_id: to("connectors", cc.connector_id), experiment_id: to("experiments", cc.experiment_id) });
  for (const p of rows("uploaded_papers")) set("papers", `upload:${p.id}`, `upload:${(await ins("uploaded_paper", { ...strip(p, "stored_path"), project_id: to("projects", p.project_id), asset_id: null })).id}`);
  const key = (k) => (String(k).startsWith("upload:") ? to("papers", k) : k);
  for (const d of rows("paper_digests")) await ins("paper_digest", { ...strip(d), zotero_key: key(d.zotero_key), experiments: parse(d.experiments, []), methods: parse(d.methods, []), limitations: parse(d.limitations, []) });
  for (const n of rows("paper_notes")) await ins("paper_note", { ...strip(n), zotero_key: key(n.zotero_key) });
  for (const x of rows("experiment_papers")) await ins("experiment_paper", { ...strip(x), experiment_id: to("experiments", x.experiment_id), zotero_key: key(x.zotero_key) });

  // Locked records join the chain in the order they were originally made.
  const chained = [
    ...rows("commitments").map((r) => ["commitment", r.locked_at, r]),
    ...rows("challenges").map((r) => ["challenge", r.created_at, r]),
    ...rows("responses").map((r) => ["response", r.created_at, r]),
    ...rows("resolutions").map((r) => ["resolution", r.created_at, r]),
  ].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  for (const [kind, , r] of chained) {
    let f;
    if (kind === "commitment") f = { ...strip(r), experiment_id: to("experiments", r.experiment_id) };
    if (kind === "challenge") f = { ...strip(r, "blind_json", "divergence_json"), commitment_id: to("commitments", r.commitment_id), blind: parse(r.blind_json, {}), divergence: parse(r.divergence_json, null) };
    if (kind === "response") f = { ...strip(r), challenge_id: to("challenges", r.challenge_id) };
    if (kind === "resolution") f = { ...strip(r), commitment_id: to("commitments", r.commitment_id) };
    const n = await insChained(kind, { ...f, imported: true });
    set(kind + "s", r.id, n.id);
  }
  return { experiments: rows("experiments").length, folders: rows("folders").length, papers_without_files: rows("uploaded_papers").length + rows("datasets").length };
}
