import { BLIND_SYSTEM, DIVERGENCE_SYSTEM, GLOSSARY_SYSTEM, DIGEST_SYSTEM, BRIEF_SYSTEM } from "./system_prompts.js";

// Field descriptions ported from the pydantic schemas in benchcraft/llm.py.
const BLIND_SHAPE = {
  explanations: [{
    label: "Three to six words naming this explanation.",
    statement: "The explanation itself, one or two sentences.",
    kind: "'biological', 'technical', or 'statistical'. What type of account this is.",
    supports: ["Specific evidence in the researcher's record that supports this. If the record contains none, return the single item 'Nothing in the record speaks to this.'"],
    contradicts: ["Specific evidence in the record that argues against this, under the same rule."],
    would_rule_out: "The concrete observation that would eliminate this explanation.",
  }],
  confounders: [{
    name: "string",
    why: "Why the recorded experimental context specifically makes this possible. Refer to the actual variables given.",
  }],
  missing_controls: ["Controls whose absence is visible in this record."],
  discriminating_experiment: {
    description: "The single cheapest decisive next step.",
    cost: "'hours', 'days', or 'weeks' of bench time.",
    reads_out: "What result would favour which explanation. Be explicit: 'if X, that argues for explanation 2 and against 1'.",
  },
  record_is_silent_on: ["What you needed to know and were not told. This is feedback on the researcher's record-keeping, not on their science."],
  recurs_in_this_protocol: ["Only if you were given PRIOR RUNS OF THIS PROTOCOL. Each item names a specific earlier run by title and says what it shares with this one: the same direction of effect, the same batch, the same thing going wrong at the same step. Say plainly if a pattern has now appeared more than twice. Empty list if you were given no prior runs, or if there is genuinely no recurrence. Never invent a resemblance to fill this in."],
};

const DIVERGENCE_SHAPE = {
  matches: "Which of your three explanations the researcher's interpretation corresponds to, or 'none of them' if it is genuinely outside your set.",
  they_saw_that_you_missed: ["What their interpretation contains that yours did not. Take this seriously, they have hands-on knowledge of this system that you do not. Empty list only if there is truly nothing."],
  you_raised_that_they_did_not_address: ["string"],
  strongest_unexamined_alternative: "The single most serious alternative they left untouched.",
  how_to_dismiss_it: "The specific observation that would let them set that alternative aside.",
  confidence_note: "If and only if they stated a confidence, say whether it is supportable given the evidence in their own record, too low as well as too high. If they did not state one, return an empty string. Never ask them to quantify their belief.",
};

function shapeBlock(shape) {
  return "Reply with JSON only, no prose before or after, in exactly this shape. Each string "
    + "below describes what goes in that field; arrays may hold any number of items unless "
    + "the description says otherwise.\n\n" + JSON.stringify(shape, null, 2);
}

function historyText(history, folder) {
  if (!history || !history.length) return "";
  const blocks = history.map((h) => {
    const ctx = Object.entries(h.context || {}).map(([k, v]) => `${k} ${v}`).join(", ");
    const b = [`  RUN: ${h.title} (${(h.created_at || "").slice(0, 10)})`];
    if (ctx) b.push(`    conditions: ${ctx}`);
    if (h.observed) b.push(`    observed: ${h.observed}`);
    if (h.interpretation) {
      const conf = h.confidence != null ? ` (they were ${h.confidence}/100 confident)` : "";
      b.push(`    they concluded: ${h.interpretation}${conf}`);
    }
    if (h.verdict) b.push(`    how it turned out: ${h.verdict}`);
    for (const n of (h.notes || []).slice(0, 4)) b.push(`    bench note: ${n}`);
    return b.join("\n");
  });
  return `PRIOR RUNS OF THIS PROTOCOL (${folder}), oldest first. These are earlier `
    + "experiments by the same researcher in the same protocol folder:\n\n" + blocks.join("\n\n");
}

// The observation-side record; it never reads the interpretation fields.
function observationText(exp, c) {
  const ctx = Object.entries(exp.context || {}).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const parts = [
    `EXPERIMENT: ${exp.title}`,
    `QUESTION BEING ASKED: ${exp.question || "(not stated)"}`,
    `EXPERIMENTAL CONTEXT:\n${ctx || "  (none recorded)"}`,
  ];
  if (c.aim) parts.push(`THE AIM, IN THEIR WORDS:\n${c.aim}`);
  if (c.expected) parts.push(`WHAT THE RESEARCHER EXPECTED:\n${c.expected}`);
  parts.push(`WHAT WAS OBSERVED:\n${c.observed}`);
  const notes = exp.notes || [];
  const steps = notes.filter((n) => n.source === "protocol").map((n) => n.body);
  if (steps.length) {
    parts.push("THE PROTOCOL BEING FOLLOWED, as the researcher recorded it:\n"
      + steps.map((t) => `  ${t}`).join("\n"));
  }
  const written = notes.filter((n) => n.source !== "protocol").map((n) => n.body);
  const spoken = (exp.recordings || []).map((r) => r.transcript).filter(Boolean);
  if (written.length || spoken.length) {
    parts.push("BENCH NOTES (informal observations recorded at the time, some dictated "
      + "and transcribed verbatim; these are impressions, not measurements):\n"
      + [...written, ...spoken].map((t) => `  - ${t}`).join("\n"));
  }
  return parts;
}

function interpretationText(c) {
  const parts = [`THE RESEARCHER'S COMMITTED INTERPRETATION:\n${c.interpretation}`];
  if (c.confidence != null) parts.push(`THEIR STATED CONFIDENCE: ${c.confidence}/100`);
  if (c.disconfirming) parts.push(`WHAT THEY SAID WOULD CHANGE THEIR MIND:\n${c.disconfirming}`);
  if (c.proposed_next) parts.push(`THE NEXT EXPERIMENT THEY PROPOSED:\n${c.proposed_next}`);
  return parts;
}

// The commitment fields the blind pass may see; everything else is dropped here.
export const BLIND_FIELDS = ["aim", "expected", "observed"];

export function blindInput(exp, commitment, history = [], folder = "") {
  const c = Object.fromEntries(BLIND_FIELDS.map((k) => [k, commitment[k] || ""]));
  const parts = observationText(exp, c);
  const hist = historyText(history, folder);
  if (hist) parts.push(hist);
  return [BLIND_SYSTEM, parts.join("\n\n"), shapeBlock(BLIND_SHAPE)].join("\n\n---\n\n");
}

export function divergenceInput(exp, commitment, blind) {
  const record = [...observationText(exp, commitment), ...interpretationText(commitment)].join("\n\n");
  const theirs = "THE THREE EXPLANATIONS YOU GENERATED BLIND:\n"
    + JSON.stringify(blind.explanations, null, 2);
  return [DIVERGENCE_SYSTEM, record + "\n\n" + theirs, shapeBlock(DIVERGENCE_SHAPE)].join("\n\n---\n\n");
}

const isStr = (v) => typeof v === "string";
const isStrList = (v) => Array.isArray(v) && v.every(isStr);

export function checkBlind(b) {
  if (!b || !Array.isArray(b.explanations) || b.explanations.length !== 3) return "expected exactly three explanations";
  for (const e of b.explanations) {
    if (!isStr(e.label) || !isStr(e.statement) || !isStrList(e.supports) || !isStrList(e.contradicts)) return "an explanation is malformed";
  }
  if (!Array.isArray(b.confounders) || !isStrList(b.missing_controls) || !b.discriminating_experiment) return "missing sections";
  b.record_is_silent_on = isStrList(b.record_is_silent_on) ? b.record_is_silent_on : [];
  b.recurs_in_this_protocol = isStrList(b.recurs_in_this_protocol) ? b.recurs_in_this_protocol : [];
  return "";
}

export function checkDivergence(d) {
  if (!d || !isStr(d.matches) || !isStr(d.strongest_unexamined_alternative)) return "missing sections";
  d.they_saw_that_you_missed = isStrList(d.they_saw_that_you_missed) ? d.they_saw_that_you_missed : [];
  d.you_raised_that_they_did_not_address = isStrList(d.you_raised_that_they_did_not_address) ? d.you_raised_that_they_did_not_address : [];
  d.how_to_dismiss_it = isStr(d.how_to_dismiss_it) ? d.how_to_dismiss_it : "";
  d.confidence_note = isStr(d.confidence_note) ? d.confidence_note : "";
  return "";
}

const GLOSSARY_SHAPE = {
  entries: [{
    term: "The term exactly as it appears in the record.",
    plain: "What the term denotes, in at most 20 words of plain English. A definition only. Never say whether something is good, bad, mature, healthy, expected, significant, or what a result involving it would mean.",
  }],
};

const DIGEST_SHAPE = {
  main_claim: "The single thing this paper claims to have shown, in one or two sentences, phrased as the authors would phrase it. Keep their hedging: if they say 'suggests', do not write 'demonstrates'.",
  experiments: ["The main experiments the authors actually ran, one per item, each naming the system and the comparison. 'Compared viability in HEK293 across an 8-point doxorubicin series at 48 h by CellTiter-Glo', not 'studied the effect of the compound'."],
  methods: ["Key methods with the specifics a person would need to repeat them: cell lines, concentrations, timepoints, n, imaging or sequencing modality. Include exact numbers when the text gives them. Omit anything the text does not state."],
  limitations: ["Limitations the AUTHORS themselves state, in their words. Do not add criticisms of your own. Empty list if they state none."],
};

const join = (system, user, shape) => [system, user, shape ? shapeBlock(shape) : ""].filter(Boolean).join("\n\n---\n\n");

export function defineInput(term, context) {
  return join(GLOSSARY_SYSTEM, `TERM TO DEFINE: ${term}\n\n`
    + "THE RECORD IT APPEARS IN, so you pick the right sense of the word. Do not describe "
    + "this experiment, do not comment on it, and do not mention it in your definition:\n"
    + (context.slice(0, 6000) || "(no surrounding record)"), GLOSSARY_SHAPE);
}

export function glossaryInput(text, known) {
  return join(GLOSSARY_SYSTEM, "Already defined, do not repeat these:\n"
    + (known.length ? known.join(", ") : "(none)") + "\n\nRECORD:\n" + text.slice(0, 20000), GLOSSARY_SHAPE);
}

export function digestInput(title, text, source) {
  return join(DIGEST_SYSTEM, `PAPER: ${title}\nWHAT YOU WERE GIVEN: ${source}\n\nTEXT:\n${text}`, DIGEST_SHAPE);
}

// Column summaries for the data attached to an entry, so a brief or slides can cite real numbers.
export function dataText(exp) {
  const ds = exp.datasets || [];
  if (!ds.length) return "";
  return "DATA ATTACHED TO THIS ENTRY (summaries computed in the browser, not by a model):\n" + ds.map((d) => {
    const cols = (d.columns || []).map((c) => c.numeric
      ? `${c.name}: n=${c.n}, mean ${c.mean}${c.sd != null ? `, sd ${c.sd}` : ""}, range ${c.min} to ${c.max}`
      : `${c.name}: ${(c.examples || []).slice(0, 5).join(", ")}`).join("; ");
    return `  - ${d.label || d.filename} (${d.kind}${d.n_rows != null ? `, ${d.n_rows} rows` : ""})${cols ? `: ${cols}` : ""}`;
  }).join("\n");
}

export function briefInput(project, experiments) {
  const blocks = [];
  for (const exp of experiments) {
    for (const c of exp.commitments) {
      let block = [...observationText(exp, c), ...interpretationText(c), dataText(exp)].filter(Boolean).join("\n\n");
      for (const ch of c.challenges) {
        block += "\n\nALTERNATIVES RAISED BY THE CHALLENGE: "
          + ch.blind.explanations.map((e) => `${e.label}: ${e.statement}`).join("; ");
        if ((ch.blind.missing_controls || []).length) block += "\nCONTROLS FLAGGED AS MISSING: " + ch.blind.missing_controls.join("; ");
        for (const r of ch.responses) {
          block += `\n\nAFTER SEEING THE CHALLENGE, THE RESEARCHER ${r.stance.toUpperCase()} THEIR POSITION. THEIR REASONING:\n${r.reasoning}`;
          if (r.chosen_next) block += `\nNEXT STEP THEY CHOSE:\n${r.chosen_next}`;
        }
      }
      blocks.push(block);
    }
  }
  if (!blocks.length) return null;
  return join(BRIEF_SYSTEM, `PROJECT: ${project.name}\n${project.description || ""}\n\n=== THE RECORD ===\n\n` + blocks.join("\n\n---\n\n"));
}

export const checkGlossary = (g) => (g && Array.isArray(g.entries) && g.entries.every((e) => isStr(e.term) && isStr(e.plain)) ? "" : "entries missing");
export const checkDigest = (d) => (d && isStr(d.main_claim) && isStrList(d.experiments || []) ? "" : "main claim missing");

const SLIDES_SYSTEM = `You lay out a short slide deck for a lab meeting, strictly from a researcher's own record.

You are a compiler, not an author. Every claim on a slide must be traceable to the record below. Do not add findings, literature, or interpretation the researcher did not write, and do not raise the confidence of anything they hedged. Where the record is thin, make fewer slides.

Use the researcher's own words where you can. Short bullets, at most five a slide, at most fifteen words a bullet. Never use an em dash.

When an attached dataset has a numeric column worth showing, you may ask for a chart: name the dataset label exactly as given and one to four numeric column names exactly as given. The page draws the chart from the real file; never write numbers into a chart yourself.`;

const SLIDES_SHAPE = {
  title: "Deck title, under ten words.",
  subtitle: "One line: the project or folder and the date range covered.",
  slides: [{
    title: "Slide title, under eight words.",
    bullets: ["Short bullet in the researcher's voice."],
    chart: { dataset: "Exact dataset label, or empty string for no chart.", columns: ["Exact numeric column names, empty list for no chart."], kind: "'bar' for comparing columns' means, 'line' for a series in row order." },
    notes: "Speaker notes: two or three sentences the researcher could say, from the record only.",
  }],
};

export function slidesInput(title, experiments) {
  const blocks = experiments.map((exp) => {
    const parts = [`ENTRY: ${exp.title} (${(exp.created_at || "").slice(0, 10)})`, `QUESTION: ${exp.question || "(not stated)"}`];
    const ctx = Object.entries(exp.context || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
    if (ctx) parts.push(`CONDITIONS: ${ctx}`);
    const notes = (exp.notes || []).filter((n) => n.source !== "protocol").map((n) => `  - ${n.body}`);
    if (notes.length) parts.push("BENCH NOTES:\n" + notes.join("\n"));
    for (const c of exp.commitments || []) {
      parts.push(...interpretationText(c), `WHAT WAS OBSERVED:\n${c.observed}`);
      for (const ch of c.challenges || []) for (const r of ch.responses || []) parts.push(`AFTER THE CHALLENGE THEY ${r.stance.toUpperCase()} THEIR VIEW: ${r.reasoning}`);
      if (c.resolution) parts.push(`HOW IT TURNED OUT: ${c.resolution.verdict}${c.resolution.notes ? `, ${c.resolution.notes}` : ""}`);
    }
    const d = dataText(exp);
    if (d) parts.push(d);
    return parts.join("\n");
  });
  return join(SLIDES_SYSTEM, `DECK FOR: ${title}\n\n=== THE RECORD ===\n\n` + blocks.join("\n\n---\n\n"), SLIDES_SHAPE);
}

export const checkSlides = (d) => (d && isStr(d.title) && Array.isArray(d.slides) && d.slides.length && d.slides.every((x) => isStr(x.title) && isStrList(x.bullets || [])) ? "" : "slides missing");
