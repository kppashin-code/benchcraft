import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
globalThis.window = { claude: undefined };

const B = await import("../lib/backend.js");
const api = B.api;

test("the old routes work end to end against local storage", async () => {
  const p = await api("/projects", "POST", { name: "Bench", description: "" });
  const projects = await api("/projects");
  assert.equal(projects.length, 1);

  const folders = await api(`/projects/${p.id}/folders`, "POST", { name: "viability" });
  const e = await api(`/projects/${p.id}/experiments`, "POST", { title: "Plate 3", question: "Why low?", context: { plate: "96-well", passage: "P12" }, folder_id: folders[0].id, mode: "notebook", template: "wet-assay" });
  assert.equal(e.title, "Plate 3");
  assert.ok((await api(`/projects/${p.id}/glossary`)).some((g) => g.term === "technical replicate"));

  let x = await api(`/experiments/${e.id}/notes`, "POST", { body: "outer ring looked drier" });
  assert.equal(x.notes.length, 1);
  x = await api(`/notes/${x.notes[0].id}/annotations`, "POST", { body: "did 5 min not 10" });
  assert.equal(x.notes[0].annotations.length, 1);
  x = await api(`/experiments/${e.id}/highlights`, "POST", { body: "drier" });
  assert.equal(x.highlights.length, 1);
  x = await api(`/experiments/${e.id}/ink`, "POST", { strokes: [{ colour: "#000", size: 2, points: [[1, 1, 0.5]] }], width: 100, height: 50 });
  assert.equal(x.ink.length, 1);

  const list = await api(`/projects/${p.id}/experiments`);
  assert.equal(list[0].stage, "entry");
  const sugg = await api(`/projects/${p.id}/suggestions`);
  assert.deepEqual(sugg.context_values.passage, ["P12"]);

  x = await api(`/experiments/${e.id}/mode`, "PUT", { mode: "cycle" });
  const out = await api(`/experiments/${e.id}/commitments`, "POST", { observed: "18% low", interpretation: "evaporation", confidence: 70 });
  assert.equal(out.experiment.commitments.length, 1);
  await assert.rejects(api(`/experiments/${e.id}/mode`, "PUT", { mode: "notebook" }), /locked commitment/);
  await assert.rejects(api(`/commitments/${out.commitment_id}/challenge`, "POST"), /needs Claude/);
  x = await api(`/commitments/${out.commitment_id}/resolution`, "POST", { verdict: "held", notes: "" });
  assert.equal(x.commitments[0].resolution.verdict, "held");
  const cal = await api(`/projects/${p.id}/calibration`);
  assert.equal(cal.brier_score, 0.09);
  const g = await api(`/projects/${p.id}/graph`);
  assert.equal(g.nodes.length, 1);
  assert.equal(await B.chainCheck(), null);

  const r = await api(`/projects/${p.id}/reagents`, "POST", { name: "FBS", unit: "mL", amount_total: 50, low_at: 10 });
  assert.equal(r.amount_left, 50);
  let rb = await api(`/reagents/${r.id}/use`, "POST", { experiment_id: e.id, amount: 45, note: "" });
  assert.equal(rb.amount_left, 5);
  assert.equal(rb.status, "low");
  assert.equal((await api(`/projects/${p.id}/restock`)).length, 1);
  assert.equal((await api(`/experiments/${e.id}`)).reagents[0].name, "FBS");
  rb = await api(`/uses/${rb.uses[0].id}`, "DELETE");
  assert.equal(rb.amount_left, 50);
  const media = await api(`/projects/${p.id}/reagents`, "POST", { name: "Medium" });
  rb = await api(`/reagents/${media.id}/components`, "POST", { name: "FBS", final_conc: "10%", source_reagent_id: r.id });
  assert.equal(rb.components[0].source_name, "FBS");
  assert.equal((await api(`/reagents/${r.id}`)).used_in[0].name, "Medium");

  const c = await api("/calc", "POST", { kind: "dilution", args: { c1: 1, c1_unit: "M", c2: 100, c2_unit: "mM", v2: 50, v2_unit: "mL" } });
  assert.equal(c.answer, "5 mL of stock, made up to 50 mL");
  await assert.rejects(api("/calc", "POST", { kind: "dilution", args: { c1: 1, c1_unit: "mM", c2: 1, c2_unit: "M", v2: 1, v2_unit: "mL" } }), /more concentrated/);

  const q = await api(`/experiments/${e.id}/literature/suggest`);
  assert.ok(q.query.length > 0);

  const prev = await api(`/experiments/${e.id}/deletion_preview`);
  assert.equal(prev.commitments, 1);
  await api(`/experiments/${e.id}`, "DELETE");
  assert.equal((await api(`/projects/${p.id}/experiments`)).length, 0);
  assert.equal(await B.chainCheck(), null, "deleting an entry must not break the chain");
  assert.equal((await api(`/projects/${p.id}/calibration`)).resolved_n, 0);
});

test("the old notebook export comes across with folders and a sound chain", async () => {
  const fs = await import("node:fs");
  const path = new URL("../../data/benchcraft-export.json", import.meta.url);
  if (!fs.existsSync(path)) return;
  const dump = JSON.parse(fs.readFileSync(path, "utf8"));
  const out = await B.importOldNotebook(dump);
  assert.equal(out.experiments, dump.experiments.length);
  const p = (await B.api("/projects")).find((x) => x.imported);
  assert.equal((await B.api(`/projects/${p.id}/folders`)).length, dump.folders.length);
  const exps = await B.api(`/projects/${p.id}/experiments`);
  assert.equal(exps.length, dump.experiments.length);
  assert.equal(exps.reduce((s, e) => s + e.notes.length, 0), dump.notes.length);
  assert.equal(exps.reduce((s, e) => s + e.commitment_count, 0), dump.commitments.length);
  assert.equal(await B.chainCheck(), null);
  await assert.rejects(B.importOldNotebook(dump), /already/);
});

test("to-do tasks move, trash and restore", async () => {
  let t = await B.api("/todos", "POST", { title: "Order FBS", status: "general" });
  const id = t[t.length - 1].id;
  t = await B.api(`/todos/${id}`, "PUT", { status: "progress", favorite: true, icon: "🧪" });
  assert.equal(t.find((x) => x.id === id).status, "progress");
  t = await B.api(`/todos/${id}`, "PUT", { trashed: true });
  assert.ok(t.find((x) => x.id === id).trashed_at);
  t = await B.api(`/todos/${id}`, "PUT", { trashed: false });
  assert.equal(t.find((x) => x.id === id).trashed_at, null);
  const n = await B.api("/todo_notes", "PUT", { body: "email the core" });
  assert.equal(n.body, "email the core");
});

test("ai help is off until switched on, and an early challenge needs claude, not a locked view", async () => {
  assert.equal((await B.api("/settings")).ai, false);
  assert.equal((await B.api("/settings", "PUT", { ai: true })).ai, true);
  const p = await B.api("/projects", "POST", { name: "early", description: "" });
  const e = await B.api(`/projects/${p.id}/experiments`, "POST", { title: "Rosettes", mode: "notebook" });
  await assert.rejects(B.api(`/experiments/${e.id}/challenge`, "POST"), /note or two/);
  await B.api(`/experiments/${e.id}/notes`, "POST", { body: "rosettes looked smaller" });
  await assert.rejects(B.api(`/experiments/${e.id}/challenge`, "POST"), /needs Claude/);
  assert.deepEqual((await B.api(`/experiments/${e.id}`)).early_challenges, []);
});

test("a reagent or dataset with its own kind field stays what it is", async () => {
  const p = await B.api("/projects", "POST", { name: "kinds", description: "" });
  const r = await B.api(`/projects/${p.id}/reagents`, "POST", { name: "PBS 10x", kind: "buffer" });
  assert.equal(r.kind, "buffer");
  assert.ok((await B.api(`/projects/${p.id}/reagents`)).some((x) => x.name === "PBS 10x"));
});

test("amounts written in a note come off the shelf, and come back if the note goes", async () => {
  const p = await B.api("/projects", "POST", { name: "usage", description: "" });
  const dmem = await B.api(`/projects/${p.id}/reagents`, "POST", { name: "DMEM/F-12", unit: "mL", amount_total: 500, low_at: 100 });
  await B.api(`/projects/${p.id}/reagents`, "POST", { name: "FBS", unit: "mL", amount_total: 50 });
  const e = await B.api(`/projects/${p.id}/experiments`, "POST", { title: "Feed", mode: "notebook" });
  let x = await B.api(`/experiments/${e.id}/notes`, "POST", { body: "Fed both plates, used 10 mL of DMEM/F-12 and 500 uL FBS." });
  assert.equal((await B.api(`/reagents/${dmem.id}`)).amount_left, 490);
  const fbs = (await B.api(`/projects/${p.id}/reagents`)).find((r) => r.name === "FBS");
  assert.equal(fbs.amount_left, 49.5);
  assert.equal(x.notes[0].used.length, 2);
  assert.equal(x.reagents.length, 2);
  x = await B.api(`/notes/${x.notes[0].id}`, "DELETE");
  assert.equal((await B.api(`/reagents/${dmem.id}`)).amount_left, 500);
  assert.equal(x.reagents.length, 0);
});
