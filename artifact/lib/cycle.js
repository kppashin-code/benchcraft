// Derived views over stored records, in the shapes app.py and db.py returned.
const SCORE = { held: 1.0, partly: 0.5, overturned: 0.0 };

export const byKind = (recs, kind) => recs.filter((r) => r._t === kind);
const byTime = (f) => (a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : a.id - b.id);
const strip = ({ _t, seq, prev, hash, ...rest }) => ({ ...rest, ...(hash ? { seq, hash } : {}) });

export function bundle(recs, expId) {
  const exp = recs.find((r) => r._t === "experiment" && r.id === expId);
  if (!exp) return null;
  const of = (kind, field, id) => byKind(recs, kind).filter((r) => r[field] === id);
  const reagents = new Map(byKind(recs, "reagent").map((r) => [r.id, r]));
  const connectors = new Map(byKind(recs, "connector").map((c) => [c.id, c]));
  const commitments = of("commitment", "experiment_id", expId).sort(byTime("locked_at")).map((c) => ({
    ...strip(c),
    challenges: of("challenge", "commitment_id", c.id).sort(byTime("created_at")).map((ch) => ({
      ...strip(ch),
      responses: of("response", "challenge_id", ch.id).sort(byTime("created_at")).map(strip),
    })),
    resolution: (() => { const rs = of("resolution", "commitment_id", c.id).sort(byTime("created_at")); return rs.length ? strip(rs[rs.length - 1]) : null; })(),
  }));
  return {
    ...strip(exp),
    context: exp.context || {},
    notes: of("note", "experiment_id", expId).sort(byTime("created_at")).map((n) => ({
      ...strip(n), annotations: of("step_note", "note_id", n.id).sort(byTime("created_at")).map(strip),
    })),
    recordings: of("recording", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    datasets: of("dataset", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    reagents: of("reagent_use", "experiment_id", expId).sort(byTime("created_at")).map((u) => {
      const r = reagents.get(u.reagent_id) || {};
      return { ...strip(u), name: r.name, lot: r.lot, supplier: r.supplier, catalogue: r.catalogue, concentration: r.concentration, unit: r.unit, amount_left: r.amount_left, low_at: r.low_at, location: r.location };
    }).filter((u) => u.name !== undefined),
    ink: of("ink_note", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    highlights: of("highlight", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    papers: of("experiment_paper", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    connector_calls: of("connector_call", "experiment_id", expId).sort(byTime("created_at"))
      .map((cc) => ({ ...strip(cc), connector_name: (connectors.get(cc.connector_id) || {}).name })).filter((cc) => cc.connector_name),
    commitments,
    figures: of("figure", "experiment_id", expId).sort(byTime("created_at")).map(strip),
    cell_events: of("line_event", "experiment_id", expId).sort(byTime("created_at")).map((ev) => ({
      ...strip(ev), line_name: (recs.find((r) => r._t === "cell_line" && r.id === ev.cell_line_id) || {}).name || "",
    })),
    early_challenges: of("challenge", "experiment_id", expId).filter((ch) => !ch.commitment_id).sort(byTime("created_at")).map(strip),
  };
}

export function stage(b) {
  if (b.mode !== "cycle") return "entry";
  const c = b.commitments[b.commitments.length - 1];
  if (!c) return "notice";
  const ch = c.challenges[c.challenges.length - 1];
  if (!ch) return "commit";
  return ch.responses.length ? "decide" : "challenge";
}

export function experimentText(exp) {
  const parts = [exp.title, exp.question];
  for (const [k, v] of Object.entries(exp.context || {})) parts.push(`${k} ${v}`);
  for (const n of exp.notes || []) parts.push(n.body);
  for (const r of exp.recordings || []) parts.push(r.transcript);
  for (const c of exp.commitments || []) parts.push(c.expected, c.observed, c.interpretation, c.disconfirming);
  return parts.filter(Boolean).join("\n");
}

export function folderHistory(recs, expId) {
  const exp = recs.find((r) => r._t === "experiment" && r.id === expId);
  if (!exp || !exp.folder_id) return [];
  return byKind(recs, "experiment")
    .filter((e) => e.folder_id === exp.folder_id && e.id !== expId && e.created_at <= exp.created_at)
    .sort(byTime("created_at"))
    .map((e) => {
      const b = bundle(recs, e.id);
      const last = b.commitments[b.commitments.length - 1];
      return {
        title: b.title, created_at: b.created_at, context: b.context,
        notes: b.notes.map((n) => n.body),
        observed: last ? last.observed : "",
        interpretation: last ? last.interpretation : "",
        confidence: last ? last.confidence : null,
        verdict: last && last.resolution ? last.resolution.verdict : "",
      };
    });
}

export function calibration(recs, projectId) {
  const exps = new Set(byKind(recs, "experiment").filter((e) => e.project_id === projectId).map((e) => e.id));
  const commits = byKind(recs, "commitment").filter((c) => exps.has(c.experiment_id));
  const latest = (cid) => byKind(recs, "resolution").filter((r) => r.commitment_id === cid).sort(byTime("created_at")).pop();
  const buckets = {};
  const points = [];
  for (const c of commits.filter((x) => x.confidence != null)) {
    const r = latest(c.id);
    if (!r || !(r.verdict in SCORE)) continue;
    const lo = Math.floor(c.confidence / 20) * 20;
    const b = (buckets[`${lo}-${lo + 19}`] ||= { n: 0, stated: 0, actual: 0 });
    b.n += 1; b.stated += c.confidence; b.actual += SCORE[r.verdict];
    points.push({ confidence: c.confidence, outcome: SCORE[r.verdict] });
  }
  for (const b of Object.values(buckets)) {
    b.mean_stated = Math.round((b.stated / b.n) * 10) / 10;
    b.mean_actual = Math.round((1000 * b.actual) / b.n) / 10;
    b.gap = Math.round((b.mean_stated - b.mean_actual) * 10) / 10;
    delete b.stated; delete b.actual;
  }
  const brier = points.length
    ? Math.round((points.reduce((s, p) => s + (p.confidence / 100 - p.outcome) ** 2, 0) / points.length) * 1e4) / 1e4
    : null;
  const ids = new Set(commits.map((c) => c.id));
  const chIds = new Set(byKind(recs, "challenge").filter((x) => ids.has(x.commitment_id)).map((x) => x.id));
  const stance_counts = {};
  for (const r of byKind(recs, "response")) if (chIds.has(r.challenge_id)) stance_counts[r.stance] = (stance_counts[r.stance] || 0) + 1;
  return { tracked_confidence_n: commits.filter((x) => x.confidence != null).length, resolved_n: points.length, brier_score: brier, buckets, stance_counts };
}

export function graph(recs, projectId) {
  const nodes = byKind(recs, "experiment").filter((e) => e.project_id === projectId).sort(byTime("created_at")).map((e) => {
    const b = bundle(recs, e.id);
    const last = b.commitments[b.commitments.length - 1];
    let stance = null, after = null;
    if (last && last.challenges.length) {
      const resps = last.challenges[last.challenges.length - 1].responses;
      if (resps.length) { stance = resps[resps.length - 1].stance; after = resps[resps.length - 1].confidence_after; }
    }
    return {
      id: e.id, commitment_id: last ? last.id : null, title: e.title, parent: e.parent_experiment_id || null,
      confidence: last ? last.confidence : null, confidence_after: after, stance,
      challenged: !!(last && last.challenges.length), resolution: last ? last.resolution : null,
    };
  });
  return {
    nodes,
    edges: nodes.filter((n) => n.parent).map((n) => ({ from: n.parent, to: n.id })),
    awaiting_verdict: nodes.filter((n) => n.commitment_id && (!n.resolution || n.resolution.verdict === "unresolved"))
      .map((n) => ({ commitment_id: n.commitment_id, title: n.title, confidence: n.confidence })),
  };
}
