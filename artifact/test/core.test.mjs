import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { seal, verify, ledgerOf } = await import("../lib/chain.js");
const { blindInput, divergenceInput, checkBlind } = await import("../lib/prompts.js");
const { bundle, stage, calibration, folderHistory } = await import("../lib/cycle.js");

const SECRET = "edge evaporation from a dry incubator shelf";
const exp = { kind: "experiment", id: 1, project_id: 9, title: "Edge wells read low", question: "Why are edge wells low?", context: { plate: "96-well" }, folder_id: 5, mode: "cycle", created_at: "2026-10-01T10:00:00" };
const commitment = { kind: "commitment", id: 2, experiment_id: 1, aim: "check uniformity", expected: "flat signal", observed: "outer ring 18% lower", interpretation: SECRET, confidence: 70, disconfirming: "humidified plate shows the same", proposed_next: "repeat with a humidity tray", locked_at: "2026-10-01T11:00:00" };

test("blind input never contains the interpretation or its companions", () => {
  const text = blindInput({ ...exp, notes: [], recordings: [] }, commitment);
  assert.ok(text.includes("outer ring 18% lower"));
  for (const hidden of [SECRET, "humidified plate shows the same", "repeat with a humidity tray", "70/100"]) {
    assert.ok(!text.includes(hidden), `leaked: ${hidden}`);
  }
});

test("divergence input does contain the interpretation", () => {
  const text = divergenceInput({ ...exp, notes: [] }, commitment, { explanations: [] });
  assert.ok(text.includes(SECRET));
  assert.ok(text.includes("70/100"));
});

test("chain verifies, and catches an edit, a deletion and a reorder", async () => {
  const recs = [exp];
  const a = await seal(commitment, ledgerOf(recs)); recs.push(a);
  const b = await seal({ kind: "challenge", id: 3, commitment_id: a.id, blind: { x: 1 }, created_at: "t" }, ledgerOf(recs)); recs.push(b);
  const c = await seal({ kind: "response", id: 4, challenge_id: b.id, stance: "held", reasoning: "r", confidence_after: null, created_at: "t" }, ledgerOf(recs)); recs.push(c);
  assert.equal(await verify(recs), null);
  assert.match((await verify(recs.map((r) => (r.id === a.id ? { ...r, interpretation: "else" } : r)))).why, /changed/);
  assert.ok(await verify(recs.filter((r) => r.id !== b.id)));
  assert.ok(await verify(recs.map((r) => (r.id === a.id ? { ...r, seq: 2 } : r.id === b.id ? { ...r, seq: 1 } : r))));
});

test("a stored round trip with reordered keys still verifies", async () => {
  const a = await seal(commitment, []);
  assert.equal(await verify([Object.fromEntries(Object.entries(a).reverse())]), null);
});

test("stage, nesting and calibration follow the stored records", async () => {
  const recs = [exp];
  const a = await seal(commitment, ledgerOf(recs)); recs.push(a);
  assert.equal(stage(bundle(recs, 1)), "commit");
  const b = await seal({ kind: "challenge", id: 3, commitment_id: a.id, created_at: "t" }, ledgerOf(recs)); recs.push(b);
  assert.equal(stage(bundle(recs, 1)), "challenge");
  const r = await seal({ kind: "response", id: 4, challenge_id: b.id, stance: "held", created_at: "t" }, ledgerOf(recs)); recs.push(r);
  assert.equal(stage(bundle(recs, 1)), "decide");
  assert.equal(bundle(recs, 1).commitments[0].challenges[0].responses[0].stance, "held");
  recs.push(await seal({ kind: "resolution", id: 5, commitment_id: a.id, verdict: "unresolved", created_at: "2026-10-02" }, ledgerOf(recs)));
  recs.push(await seal({ kind: "resolution", id: 6, commitment_id: a.id, verdict: "overturned", created_at: "2026-10-03" }, ledgerOf(recs)));
  assert.equal(bundle(recs, 1).commitments[0].resolution.verdict, "overturned");
  const cal = calibration(recs, 9);
  assert.equal(cal.resolved_n, 1);
  assert.equal(cal.brier_score, 0.49);
  assert.deepEqual(cal.stance_counts, { held: 1 });
});

test("folder history only includes earlier runs in the same folder", () => {
  const recs = [exp,
    { ...exp, id: 10, title: "Earlier", created_at: "2026-09-01T00:00:00" },
    { ...exp, id: 11, title: "Later", created_at: "2026-11-01T00:00:00" },
    { ...exp, id: 12, title: "Other folder", folder_id: 6, created_at: "2026-09-01T00:00:00" }];
  assert.deepEqual(folderHistory(recs, 1).map((h) => h.title), ["Earlier"]);
});

test("blind check wants exactly three explanations", () => {
  const e = { label: "l", statement: "s", kind: "technical", supports: [], contradicts: [], would_rule_out: "x" };
  const ok = { explanations: [e, e, e], confounders: [], missing_controls: [], discriminating_experiment: { description: "d", cost: "hours", reads_out: "r" } };
  assert.equal(checkBlind(ok), "");
  assert.notEqual(checkBlind({ ...ok, explanations: [e, e] }), "");
});
