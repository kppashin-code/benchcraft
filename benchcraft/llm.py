import json
import os

import anthropic
from pydantic import BaseModel, Field

MODEL = os.environ.get("BENCHCRAFT_MODEL", "claude-opus-5")

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


class Explanation(BaseModel):
    label: str = Field(description="Three to six words naming this explanation.")
    statement: str = Field(description="The explanation itself, one or two sentences.")
    kind: str = Field(
        description="'biological', 'technical', or 'statistical'. What type of account this is."
    )
    supports: list[str] = Field(
        description="Specific evidence in the researcher's record that supports this. If the "
        "record contains none, return the single item 'Nothing in the record speaks to this.'"
    )
    contradicts: list[str] = Field(
        description="Specific evidence in the record that argues against this, under the same rule."
    )
    would_rule_out: str = Field(
        description="The concrete observation that would eliminate this explanation."
    )


class Confounder(BaseModel):
    name: str
    why: str = Field(
        description="Why the recorded experimental context specifically makes this possible. "
        "Refer to the actual variables given."
    )


class DiscriminatingExperiment(BaseModel):
    description: str = Field(description="The single cheapest decisive next step.")
    cost: str = Field(description="'hours', 'days', or 'weeks' of bench time.")
    reads_out: str = Field(
        description="What result would favour which explanation. Be explicit: 'if X, that argues "
        "for explanation 2 and against 1'."
    )


class BlindChallenge(BaseModel):
    explanations: list[Explanation] = Field(
        description="Exactly three genuinely competing explanations."
    )
    confounders: list[Confounder]
    missing_controls: list[str] = Field(
        description="Controls whose absence is visible in this record."
    )
    discriminating_experiment: DiscriminatingExperiment
    record_is_silent_on: list[str] = Field(
        description="What you needed to know and were not told. This is feedback on the "
        "researcher's record-keeping, not on their science."
    )


class Divergence(BaseModel):
    matches: str = Field(
        description="Which of your three explanations the researcher's interpretation corresponds "
        "to, or 'none of them' if it is genuinely outside your set."
    )
    they_saw_that_you_missed: list[str] = Field(
        description="What their interpretation contains that yours did not. Take this seriously, "
        "they have hands-on knowledge of this system that you do not. Empty list only if there is "
        "truly nothing."
    )
    you_raised_that_they_did_not_address: list[str]
    strongest_unexamined_alternative: str = Field(
        description="The single most serious alternative they left untouched."
    )
    how_to_dismiss_it: str = Field(
        description="The specific observation that would let them set that alternative aside."
    )
    confidence_note: str = Field(
        description="Whether the confidence they stated is supportable given the evidence in their "
        "own record. Say so if it looks too LOW as well as too high. Do not tell them what to "
        "conclude."
    )


class PaperDigest(BaseModel):
    main_claim: str = Field(
        description="The single thing this paper claims to have shown, in one or two sentences, "
        "phrased as the authors would phrase it. Keep their hedging: if they say 'suggests', do "
        "not write 'demonstrates'."
    )
    experiments: list[str] = Field(
        description="The main experiments the authors actually ran, one per item, each naming the "
        "system and the comparison. 'Encapsulated H9-derived organoids in fast vs slow-relaxing "
        "alginate and compared TH+ fraction at day 40', not 'studied the effect of stiffness'."
    )
    methods: list[str] = Field(
        description="Key methods with the specifics a person would need to repeat them: cell "
        "lines, concentrations, timepoints, n, imaging or sequencing modality. Include exact "
        "numbers when the text gives them. Omit anything the text does not state."
    )
    limitations: list[str] = Field(
        description="Limitations the AUTHORS themselves state, in their words. Do not add "
        "criticisms of your own. Empty list if they state none."
    )


class GlossaryEntry(BaseModel):
    term: str = Field(description="The term exactly as it appears in the record.")
    plain: str = Field(
        description="What the term denotes, in at most 20 words of plain English. A definition "
        "only. Never say whether something is good, bad, mature, healthy, expected, significant, "
        "or what a result involving it would mean."
    )


class GlossaryOut(BaseModel):
    entries: list[GlossaryEntry]


BLIND_SYSTEM = """\
You are an adversarial collaborator inside a research notebook used by a \
doctoral scientist at the bench. A researcher has recorded an observation. You \
have NOT been shown their interpretation of it, and you must not speculate \
about what they think.

Your job is to widen the hypothesis space, not to close it.

Rules, in order of importance:

1. Never invent evidence. Do not state a result, a number, a marker, a \
citation, or a published finding that is not either in the record you were \
given or general textbook knowledge you can state as such. Where the record is \
silent, say the record is silent. A fabricated supporting detail is worse than \
an empty list.

2. Produce exactly three explanations that genuinely compete. They must be \
separable by evidence, not three restatements of one idea. At least one must be \
a mundane technical or artefactual account (batch variation, handling, \
sampling, dissociation, imaging depth, measurement drift) rather than a \
biological one, because in practice that is where the answer often is.

3. Do not rank them. Do not name one most likely. Do not write a concluding \
paragraph that collapses the three into a preferred story. Preserving genuine \
uncertainty is the task; resolving it is the researcher's.

4. Name confounders that this specific experimental context makes possible. \
Refer to the actual cell line, passage, batch, timepoint or condition you were \
given, not to generic risks.

5. Propose one cheap discriminating experiment, and say which result points \
which way.

Write for a working bench scientist. Concrete, specific to the stated system, \
no encouragement, no hedging boilerplate, no restating the question back."""

DIVERGENCE_SYSTEM = """\
You are the same adversarial collaborator. You have now been shown the \
interpretation the researcher committed to, which was written and locked \
BEFORE you generated anything, so it is independent of you.

Compare the two. Do not grade the researcher, do not praise, and do not defer. \
Where their reading is better than yours because they were physically present \
at the bench, say so plainly and say what they knew that you did not.

Your one job the researcher cannot do for themselves: identify the strongest \
alternative they did not examine, and tell them what observation would let them \
put it down.

Never invent evidence. Same rule as before."""

GLOSSARY_SYSTEM = """\
You build a plain-language glossary for a research notebook.

You are a dictionary, not a commentator. For each specialised term, say only \
what it denotes. Twenty words maximum.

Forbidden without exception:
- any evaluation (good, bad, poor, healthy, unhealthy, mature, immature, \
normal, abnormal, high, low, expected, surprising)
- any claim about significance, implication, or what a result involving the \
term would mean
- any statement about what the researcher's data show
- any hedging or advice

'TH' is 'tyrosine hydroxylase, the enzyme catalysing the rate-limiting step in \
dopamine synthesis'. It is NOT 'a marker of mature dopaminergic identity, so \
lower TH suggests impaired maturation'. The second sentence is the researcher's \
to write, not yours.

Skip anything a general reader already understands. Skip terms you cannot \
define confidently rather than guessing. UK spelling."""

DIGEST_SYSTEM = """\
You summarise a scientific paper for a researcher who has saved it to their own \
reference library.

You describe what this paper did and what its authors claim. You do NOT say what \
it means for the reader's own work, whether it supports or undermines any \
hypothesis they hold, or what they should do next. The reader has their own \
experiment in progress and their reading of this paper against it is theirs to \
make, not yours.

Rules:

1. Never state a finding, number, cell line, concentration or timepoint that is \
not in the text you were given. If the text is an abstract only, you will have \
far less detail; say less rather than inventing the rest.

2. Keep the authors' own hedging. If they write that something 'may contribute \
to' an effect, do not upgrade it to 'causes'.

3. No evaluation. Do not call a study elegant, robust, underpowered, seminal or \
flawed. Report limitations only where the authors state them themselves.

4. Concrete over abstract. 'Compared 2% and 4% w/v alginate at day 40, n=3 \
wells' beats 'investigated the role of matrix concentration'.

This digest exists so a researcher can find a paper again and recall its shape. \
It is not a substitute for reading it."""

BRIEF_SYSTEM = """\
You assemble a supervisor-meeting brief strictly from a researcher's own \
recorded reasoning.

You are a compiler, not an author. Every claim in the brief must be traceable \
to something in the record below. You may compress, order, and connect. You may \
NOT add findings, add literature, add interpretation, resolve an uncertainty \
the researcher left open, or raise the confidence of a hedged statement. If the \
record is thin in a section, the section is short. Do not pad it.

Where the researcher and the AI challenge disagreed and the researcher held \
their position, present the researcher's position as the position, and note the \
alternative as an open question, not as a correction.

Write in the researcher's own voice, first person, plain prose. UK spelling. \
Use these headings exactly:

**What I did**
**What I found**
**How I read it** (include the stated confidence, in words)
**Alternatives I considered**
**What I'm doing next, and why**
**Where I'd like your input**

No preamble, no sign-off. Start at the first heading."""


def _record_text(exp: dict, commitment: dict, include_interpretation: bool) -> str:
    ctx = "\n".join(f"  {k}: {v}" for k, v in (exp.get("context") or {}).items())
    parts = [
        f"EXPERIMENT: {exp['title']}",
        f"QUESTION BEING ASKED: {exp['question'] or '(not stated)'}",
        f"EXPERIMENTAL CONTEXT:\n{ctx or '  (none recorded)'}",
        f"WHAT THE RESEARCHER EXPECTED:\n{commitment['expected']}",
        f"WHAT WAS OBSERVED:\n{commitment['observed']}",
    ]
    spoken = [r["transcript"] for r in exp.get("recordings", []) if r.get("transcript")]
    written = [n["body"] for n in exp.get("notes", [])]
    if written or spoken:
        lines = "\n".join(f"  - {t}" for t in written + spoken)
        parts.append(
            "BENCH NOTES (informal observations recorded at the time, some dictated "
            f"and transcribed verbatim; these are impressions, not measurements):\n{lines}"
        )
    if include_interpretation:
        parts += [
            f"THE RESEARCHER'S COMMITTED INTERPRETATION:\n{commitment['interpretation']}",
            f"THEIR STATED CONFIDENCE: {commitment['confidence']}/100",
            f"WHAT THEY SAID WOULD CHANGE THEIR MIND:\n{commitment['disconfirming']}",
        ]
        if commitment.get("proposed_next"):
            parts.append(f"THE NEXT EXPERIMENT THEY PROPOSED:\n{commitment['proposed_next']}")
    return "\n\n".join(parts)


def _parse(system: str, user: str, schema: type[BaseModel]) -> BaseModel:
    resp = client().messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError(
            "The model declined to answer this request. Nothing was saved; your "
            "commitment is untouched. Rephrase the observation and try again."
        )
    return resp.parsed_output


def blind_challenge(exp: dict, commitment: dict) -> dict:
    user = _record_text(exp, commitment, include_interpretation=False)
    return _parse(BLIND_SYSTEM, user, BlindChallenge).model_dump()


def divergence(exp: dict, commitment: dict, blind: dict) -> dict:
    user = "\n\n".join(
        [
            _record_text(exp, commitment, include_interpretation=True),
            "THE THREE EXPLANATIONS YOU GENERATED BLIND:\n"
            + json.dumps(blind["explanations"], indent=2),
        ]
    )
    return _parse(DIVERGENCE_SYSTEM, user, Divergence).model_dump()


def glossary_terms(text: str, known: list[str]) -> list[dict]:
    if not text.strip():
        return []
    user = (
        "Already defined, do not repeat these:\n"
        + (", ".join(known) if known else "(none)")
        + "\n\nRECORD:\n"
        + text[:20000]
    )
    out = _parse(GLOSSARY_SYSTEM, user, GlossaryOut)
    return [e.model_dump() for e in out.entries]


def paper_digest(title: str, text: str, source: str) -> dict:
    user = (
        f"PAPER: {title}\n"
        f"WHAT YOU WERE GIVEN: {source}\n\n"
        f"TEXT:\n{text}"
    )
    return _parse(DIGEST_SYSTEM, user, PaperDigest).model_dump()


def supervisor_brief(project: dict, experiments: list[dict]) -> str:
    blocks = []
    for exp in experiments:
        for c in exp["commitments"]:
            block = _record_text(exp, c, include_interpretation=True)
            for ch in c["challenges"]:
                alts = "; ".join(
                    f"{e['label']}: {e['statement']}" for e in ch["blind"]["explanations"]
                )
                block += f"\n\nALTERNATIVES RAISED BY THE CHALLENGE: {alts}"
                if ch["blind"].get("missing_controls"):
                    block += "\nCONTROLS FLAGGED AS MISSING: " + "; ".join(
                        ch["blind"]["missing_controls"]
                    )
                for r in ch["responses"]:
                    block += (
                        f"\n\nAFTER SEEING THE CHALLENGE, THE RESEARCHER {r['stance'].upper()} "
                        f"THEIR POSITION (confidence {c['confidence']} → "
                        f"{r['confidence_after']}). THEIR REASONING:\n{r['reasoning']}"
                    )
                    if r["chosen_next"]:
                        block += f"\nNEXT STEP THEY CHOSE:\n{r['chosen_next']}"
            blocks.append(block)

    if not blocks:
        return "_No locked commitments yet, nothing to brief on._"

    user = (
        f"PROJECT: {project['name']}\n{project['description']}\n\n"
        "=== THE RECORD ===\n\n" + "\n\n---\n\n".join(blocks)
    )
    resp = client().messages.create(
        model=MODEL,
        max_tokens=8000,
        system=BRIEF_SYSTEM,
        messages=[{"role": "user", "content": user}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("The model declined to assemble this brief.")
    return "".join(b.text for b in resp.content if b.type == "text")
