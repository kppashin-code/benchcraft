import json
import re
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import connectors, db, llm, transcribe

app = FastAPI(title="Benchcraft")
STATIC = Path(__file__).resolve().parent / "static"
AUDIO_TYPES = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mp4", ".mov"}


@app.on_event("startup")
def _startup() -> None:
    db.init()


class ProjectIn(BaseModel):
    name: str
    description: str = ""


class ExperimentIn(BaseModel):
    title: str
    question: str = ""
    context: dict[str, str] = Field(default_factory=dict)
    parent_experiment_id: int | None = None


class NoteIn(BaseModel):
    body: str
    source: str = "typed"
    recording_id: int | None = None


class CommitmentIn(BaseModel):
    expected: str
    observed: str
    interpretation: str
    confidence: int = Field(ge=0, le=100)
    disconfirming: str
    proposed_next: str = ""


class ResponseIn(BaseModel):
    stance: str
    reasoning: str
    confidence_after: int = Field(ge=0, le=100)
    chosen_next: str = ""


class ResolutionIn(BaseModel):
    verdict: str
    notes: str = ""


class TranscriptIn(BaseModel):
    transcript: str


class GlossaryIn(BaseModel):
    term: str
    plain: str


class ConnectorIn(BaseModel):
    name: str
    endpoint: str = ""
    key_env: str = ""
    note: str = ""
    enabled: bool = False


class ConnectorCallIn(BaseModel):
    experiment_id: int
    question: str


@app.get("/api/projects")
def list_projects():
    return db.rows("SELECT * FROM projects ORDER BY created_at DESC")


@app.post("/api/projects")
def create_project(body: ProjectIn):
    pid = db.insert(
        "INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)",
        (body.name, body.description, db.now()),
    )
    return db.row("SELECT * FROM projects WHERE id = ?", (pid,))


@app.get("/api/projects/{project_id}/experiments")
def list_experiments(project_id: int):
    return db.rows(
        """SELECT e.*,
                  (SELECT COUNT(*) FROM commitments c WHERE c.experiment_id = e.id)
                      AS commitment_count,
                  (SELECT COUNT(*) FROM recordings r WHERE r.experiment_id = e.id)
                      AS recording_count
           FROM experiments e WHERE e.project_id = ? ORDER BY e.created_at DESC""",
        (project_id,),
    )


@app.post("/api/projects/{project_id}/experiments")
def create_experiment(project_id: int, body: ExperimentIn):
    if not db.row("SELECT id FROM projects WHERE id = ?", (project_id,)):
        raise HTTPException(404, "No such project")
    eid = db.insert(
        """INSERT INTO experiments
           (project_id, parent_experiment_id, title, question, context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (project_id, body.parent_experiment_id, body.title, body.question,
         json.dumps(body.context), db.now()),
    )
    return db.experiment_bundle(eid)


@app.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: int):
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    return exp


@app.post("/api/experiments/{experiment_id}/notes")
def add_note(experiment_id: int, body: NoteIn):
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    db.insert(
        """INSERT INTO notes (experiment_id, body, source, recording_id, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (experiment_id, body.body, body.source, body.recording_id, db.now()),
    )
    return db.experiment_bundle(experiment_id)


@app.get("/api/transcription/status")
def transcription_status():
    return transcribe.status()


@app.post("/api/experiments/{experiment_id}/recordings")
async def upload_recording(experiment_id: int, file: UploadFile = File(...)):
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in AUDIO_TYPES:
        raise HTTPException(422, f"Unsupported file type '{suffix}'")

    db.AUDIO_DIR.mkdir(exist_ok=True)
    stored = db.AUDIO_DIR / f"{uuid.uuid4().hex}{suffix}"
    with stored.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    rid = db.insert(
        """INSERT INTO recordings
           (experiment_id, filename, stored_path, duration_s, transcript_state, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)""",
        (experiment_id, file.filename, str(stored),
         transcribe.duration_seconds(stored), db.now()),
    )
    return {"recording_id": rid, "experiment": db.experiment_bundle(experiment_id)}


@app.post("/api/recordings/{recording_id}/transcribe")
def run_transcription(recording_id: int):
    rec = db.row("SELECT * FROM recordings WHERE id = ?", (recording_id,))
    if not rec:
        raise HTTPException(404, "No such recording")
    try:
        text, engine = transcribe.transcribe(Path(rec["stored_path"]))
    except transcribe.Unavailable as e:
        db.execute("UPDATE recordings SET transcript_state = 'failed' WHERE id = ?", (recording_id,))
        raise HTTPException(503, str(e))
    db.execute(
        """UPDATE recordings SET transcript = ?, transcript_engine = ?,
           transcript_state = 'done' WHERE id = ?""",
        (text, engine, recording_id),
    )
    return db.experiment_bundle(rec["experiment_id"])


@app.put("/api/recordings/{recording_id}/transcript")
def edit_transcript(recording_id: int, body: TranscriptIn):
    rec = db.row("SELECT * FROM recordings WHERE id = ?", (recording_id,))
    if not rec:
        raise HTTPException(404, "No such recording")
    db.execute(
        """UPDATE recordings SET transcript = ?, transcript_engine = 'edited by hand',
           transcript_state = 'done' WHERE id = ?""",
        (body.transcript, recording_id),
    )
    return db.experiment_bundle(rec["experiment_id"])


@app.get("/api/recordings/{recording_id}/audio")
def get_audio(recording_id: int):
    rec = db.row("SELECT * FROM recordings WHERE id = ?", (recording_id,))
    if not rec or not Path(rec["stored_path"]).exists():
        raise HTTPException(404, "No such recording")
    return FileResponse(rec["stored_path"], filename=rec["filename"])


@app.post("/api/experiments/{experiment_id}/commitments")
def lock_commitment(experiment_id: int, body: CommitmentIn):
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    for field in ("expected", "observed", "interpretation", "disconfirming"):
        if not getattr(body, field).strip():
            raise HTTPException(422, f"'{field}' cannot be empty. This is the point of the step")
    cid = db.insert(
        """INSERT INTO commitments
           (experiment_id, expected, observed, interpretation, confidence,
            disconfirming, proposed_next, locked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (experiment_id, body.expected, body.observed, body.interpretation,
         body.confidence, body.disconfirming, body.proposed_next, db.now()),
    )
    return {"commitment_id": cid, "experiment": db.experiment_bundle(experiment_id)}


@app.post("/api/commitments/{commitment_id}/challenge")
def run_challenge(commitment_id: int):
    commitment = db.row("SELECT * FROM commitments WHERE id = ?", (commitment_id,))
    if not commitment:
        raise HTTPException(404, "No such commitment")
    exp = db.experiment_bundle(commitment["experiment_id"])
    try:
        blind = llm.blind_challenge(exp, commitment)
        div = llm.divergence(exp, commitment, blind)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    db.insert(
        """INSERT INTO challenges (commitment_id, model, blind_json, divergence_json, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (commitment_id, llm.MODEL, json.dumps(blind), json.dumps(div), db.now()),
    )
    return db.experiment_bundle(commitment["experiment_id"])


@app.post("/api/challenges/{challenge_id}/response")
def record_response(challenge_id: int, body: ResponseIn):
    ch = db.row("SELECT * FROM challenges WHERE id = ?", (challenge_id,))
    if not ch:
        raise HTTPException(404, "No such challenge")
    if body.stance not in {"held", "revised", "overturned"}:
        raise HTTPException(422, "stance must be held, revised or overturned")
    db.insert(
        """INSERT INTO responses
           (challenge_id, stance, reasoning, confidence_after, chosen_next, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (challenge_id, body.stance, body.reasoning, body.confidence_after,
         body.chosen_next, db.now()),
    )
    commitment = db.row("SELECT * FROM commitments WHERE id = ?", (ch["commitment_id"],))
    return db.experiment_bundle(commitment["experiment_id"])


@app.post("/api/commitments/{commitment_id}/resolution")
def record_resolution(commitment_id: int, body: ResolutionIn):
    commitment = db.row("SELECT * FROM commitments WHERE id = ?", (commitment_id,))
    if not commitment:
        raise HTTPException(404, "No such commitment")
    if body.verdict not in {"held", "partly", "overturned", "unresolved"}:
        raise HTTPException(422, "bad verdict")
    db.insert(
        "INSERT INTO resolutions (commitment_id, verdict, notes, created_at) VALUES (?, ?, ?, ?)",
        (commitment_id, body.verdict, body.notes, db.now()),
    )
    return db.experiment_bundle(commitment["experiment_id"])


@app.get("/api/projects/{project_id}/glossary")
def get_glossary(project_id: int):
    return db.rows("SELECT * FROM glossary WHERE project_id = ? ORDER BY term", (project_id,))


@app.post("/api/projects/{project_id}/glossary")
def add_glossary(project_id: int, body: GlossaryIn):
    db.execute(
        """INSERT INTO glossary (project_id, term, plain, source, created_at)
           VALUES (?, ?, ?, 'curated', ?)
           ON CONFLICT (project_id, term)
           DO UPDATE SET plain = excluded.plain, source = 'curated'""",
        (project_id, body.term.strip(), body.plain.strip(), db.now()),
    )
    return get_glossary(project_id)


@app.delete("/api/glossary/{entry_id}")
def delete_glossary(entry_id: int):
    entry = db.row("SELECT * FROM glossary WHERE id = ?", (entry_id,))
    if not entry:
        raise HTTPException(404, "No such entry")
    db.execute("DELETE FROM glossary WHERE id = ?", (entry_id,))
    return get_glossary(entry["project_id"])


@app.post("/api/projects/{project_id}/glossary/detect")
def detect_glossary(project_id: int):
    exps = [
        db.experiment_bundle(e["id"])
        for e in db.rows("SELECT id FROM experiments WHERE project_id = ?", (project_id,))
    ]
    text = "\n".join(db.experiment_text(e) for e in exps)
    known = [g["term"] for g in get_glossary(project_id)]
    try:
        found = llm.glossary_terms(text, known)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    for entry in found:
        db.execute(
            """INSERT INTO glossary (project_id, term, plain, source, created_at)
               VALUES (?, ?, ?, 'ai', ?) ON CONFLICT (project_id, term) DO NOTHING""",
            (project_id, entry["term"].strip(), entry["plain"].strip(), db.now()),
        )
    return get_glossary(project_id)


@app.get("/api/projects/{project_id}/glossary/matches/{experiment_id}")
def glossary_matches(project_id: int, experiment_id: int):
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    text = db.experiment_text(exp).lower()
    hits = []
    for g in get_glossary(project_id):
        pattern = r"(?<![A-Za-z0-9])" + re.escape(g["term"].lower()) + r"(?![A-Za-z0-9])"
        if re.search(pattern, text):
            hits.append(g)
    return hits


@app.get("/api/connectors/suggested")
def suggested_connectors():
    return connectors.SUGGESTED


@app.get("/api/projects/{project_id}/connectors")
def list_connectors(project_id: int):
    return db.rows("SELECT * FROM connectors WHERE project_id = ? ORDER BY name", (project_id,))


@app.post("/api/projects/{project_id}/connectors")
def add_connector(project_id: int, body: ConnectorIn):
    if not db.row("SELECT id FROM projects WHERE id = ?", (project_id,)):
        raise HTTPException(404, "No such project")
    db.insert(
        """INSERT INTO connectors (project_id, name, endpoint, key_env, note, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (project_id, body.name, body.endpoint, body.key_env, body.note,
         1 if body.enabled else 0, db.now()),
    )
    return list_connectors(project_id)


@app.delete("/api/connectors/{connector_id}")
def delete_connector(connector_id: int):
    c = db.row("SELECT * FROM connectors WHERE id = ?", (connector_id,))
    if not c:
        raise HTTPException(404, "No such connector")
    db.execute("DELETE FROM connectors WHERE id = ?", (connector_id,))
    return list_connectors(c["project_id"])


@app.post("/api/connectors/{connector_id}/call")
def call_connector(connector_id: int, body: ConnectorCallIn):
    c = db.row("SELECT * FROM connectors WHERE id = ?", (connector_id,))
    if not c:
        raise HTTPException(404, "No such connector")
    if not c["enabled"]:
        raise HTTPException(409, "This connector is switched off.")
    exp = db.experiment_bundle(body.experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")

    payload = {
        "question": body.question,
        "experiment": {
            "title": exp["title"],
            "question": exp["question"],
            "context": exp["context"],
            "notes": [n["body"] for n in exp["notes"]],
        },
    }
    try:
        text = connectors.call(c, payload)
        ok = 1
    except connectors.ConnectorError as e:
        text, ok = str(e), 0

    db.insert(
        """INSERT INTO connector_calls
           (connector_id, experiment_id, request, response, ok, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (connector_id, body.experiment_id, body.question, text, ok, db.now()),
    )
    if not ok:
        raise HTTPException(502, text)
    return db.experiment_bundle(body.experiment_id)


@app.get("/api/projects/{project_id}/brief")
def supervisor_brief(project_id: int):
    project = db.row("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(404, "No such project")
    exps = [
        db.experiment_bundle(e["id"])
        for e in db.rows(
            "SELECT id FROM experiments WHERE project_id = ? ORDER BY created_at", (project_id,)
        )
    ]
    try:
        return {"markdown": llm.supervisor_brief(project, exps)}
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@app.get("/api/projects/{project_id}/graph")
def decision_graph(project_id: int):
    nodes = []
    for e in db.rows(
        "SELECT * FROM experiments WHERE project_id = ? ORDER BY created_at", (project_id,)
    ):
        bundle = db.experiment_bundle(e["id"])
        last = bundle["commitments"][-1] if bundle["commitments"] else None
        stance = after = None
        if last and last["challenges"]:
            resps = last["challenges"][-1]["responses"]
            if resps:
                stance = resps[-1]["stance"]
                after = resps[-1]["confidence_after"]
        nodes.append({
            "id": e["id"],
            "title": e["title"],
            "parent": e["parent_experiment_id"],
            "confidence": last["confidence"] if last else None,
            "confidence_after": after,
            "stance": stance,
            "challenged": bool(last and last["challenges"]),
            "resolution": (last or {}).get("resolution") or None,
        })
    return {"nodes": nodes, "edges": [{"from": n["parent"], "to": n["id"]}
                                     for n in nodes if n["parent"]]}


@app.get("/api/projects/{project_id}/calibration")
def calibration(project_id: int):
    scored = {"held": 1.0, "partly": 0.5, "overturned": 0.0}
    buckets: dict[str, dict] = {}
    points = []
    resolved = db.rows(
        """SELECT c.confidence, r.verdict, e.title
           FROM commitments c
           JOIN experiments e ON e.id = c.experiment_id
           JOIN resolutions r ON r.commitment_id = c.id
           WHERE e.project_id = ? AND r.verdict != 'unresolved'""",
        (project_id,),
    )
    for r in resolved:
        lo = (r["confidence"] // 20) * 20
        b = buckets.setdefault(f"{lo}-{lo + 19}", {"n": 0, "stated": 0, "actual": 0.0})
        b["n"] += 1
        b["stated"] += r["confidence"]
        b["actual"] += scored[r["verdict"]]
        points.append({"confidence": r["confidence"], "outcome": scored[r["verdict"]]})
    for b in buckets.values():
        b["mean_stated"] = round(b["stated"] / b["n"], 1)
        b["mean_actual"] = round(100 * b["actual"] / b["n"], 1)
        b["gap"] = round(b["mean_stated"] - b["mean_actual"], 1)
        del b["stated"], b["actual"]

    brier = None
    if points:
        brier = round(
            sum((p["confidence"] / 100 - p["outcome"]) ** 2 for p in points) / len(points), 4
        )

    stances = db.rows(
        """SELECT r.stance, COUNT(*) AS n
           FROM responses r
           JOIN challenges ch ON ch.id = r.challenge_id
           JOIN commitments c ON c.id = ch.commitment_id
           JOIN experiments e ON e.id = c.experiment_id
           WHERE e.project_id = ? GROUP BY r.stance""",
        (project_id,),
    )
    return {
        "resolved_n": len(points),
        "brier_score": brier,
        "buckets": buckets,
        "stance_counts": {s["stance"]: s["n"] for s in stances},
    }


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
