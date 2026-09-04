import json
import re
import shutil
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import calc, connectors, datafiles, db, literature, llm, templates, transcribe, zotero

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
    folder_id: int | None = None
    mode: str = "notebook"
    template: str = ""


class NoteIn(BaseModel):
    body: str
    source: str = "typed"
    recording_id: int | None = None


class CommitmentIn(BaseModel):
    aim: str = ""
    expected: str = ""
    observed: str
    interpretation: str
    confidence: int | None = Field(default=None, ge=0, le=100)
    disconfirming: str = ""
    proposed_next: str = ""


class ResponseIn(BaseModel):
    stance: str
    reasoning: str
    confidence_after: int | None = Field(default=None, ge=0, le=100)
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


class ReagentIn(BaseModel):
    name: str
    kind: str = "reagent"
    supplier: str = ""
    catalogue: str = ""
    lot: str = ""
    concentration: str = ""
    unit: str = ""
    amount_total: float | None = None
    amount_left: float | None = None
    low_at: float | None = None
    location: str = ""
    opened_at: str = ""
    expires_at: str = ""
    notes: str = ""


class ComponentIn(BaseModel):
    name: str
    final_conc: str = ""
    source_reagent_id: int | None = None


class UseIn(BaseModel):
    experiment_id: int | None = None
    amount: float | None = None
    note: str = ""


class ModeIn(BaseModel):
    mode: str


class DatasetIn(BaseModel):
    kind: str = "other"
    label: str = ""
    notes: str = ""


class CalcIn(BaseModel):
    kind: str
    args: dict


class StepNoteIn(BaseModel):
    body: str


class SearchIn(BaseModel):
    query: str
    include_preprints: bool = False
    reviews_only: bool = False


class InkIn(BaseModel):
    strokes: list[dict]
    width: int = Field(gt=0, le=4000)
    height: int = Field(gt=0, le=4000)


class HighlightIn(BaseModel):
    body: str


class DefineIn(BaseModel):
    term: str
    experiment_id: int | None = None


class FolderIn(BaseModel):
    name: str


class PaperNoteIn(BaseModel):
    body: str


class PaperLinkIn(BaseModel):
    zotero_key: str


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
    out = db.rows(
        """SELECT e.*,
                  (SELECT COUNT(*) FROM commitments c WHERE c.experiment_id = e.id)
                      AS commitment_count,
                  (SELECT COUNT(*) FROM recordings r WHERE r.experiment_id = e.id)
                      AS recording_count,
                  (SELECT COUNT(*) FROM challenges ch
                     JOIN commitments c2 ON c2.id = ch.commitment_id
                    WHERE c2.experiment_id = e.id) AS challenge_count,
                  (SELECT COUNT(*) FROM responses r2
                     JOIN challenges ch2 ON ch2.id = r2.challenge_id
                     JOIN commitments c3 ON c3.id = ch2.commitment_id
                    WHERE c3.experiment_id = e.id) AS response_count
           FROM experiments e WHERE e.project_id = ? ORDER BY e.created_at DESC""",
        (project_id,),
    )
    for e in out:
        if e["response_count"]:
            e["stage"] = "decide"
        elif e["challenge_count"]:
            e["stage"] = "challenge"
        elif e["commitment_count"]:
            e["stage"] = "commit"
        else:
            e["stage"] = "notice"
        if e["mode"] != "cycle":
            e["stage"] = "entry"
    return out


@app.post("/api/projects/{project_id}/experiments")
def create_experiment(project_id: int, body: ExperimentIn):
    if not db.row("SELECT id FROM projects WHERE id = ?", (project_id,)):
        raise HTTPException(404, "No such project")
    eid = db.insert(
        """INSERT INTO experiments
           (project_id, parent_experiment_id, folder_id, title, mode, question,
            context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (project_id, body.parent_experiment_id, body.folder_id, body.title,
         body.mode if body.mode in ('notebook', 'cycle') else 'notebook',
         body.question, json.dumps(body.context), db.now()),
    )
    tpl = templates.by_id(body.template) if body.template else None
    if tpl:
        for step in tpl["protocol"]:
            db.insert(
                "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
                (eid, step, "protocol", db.now()),
            )
        for term, plain in tpl["glossary"]:
            db.execute(
                """INSERT INTO glossary (project_id, term, plain, source, created_at)
                   VALUES (?, ?, ?, 'curated', ?)
                   ON CONFLICT (project_id, term) DO NOTHING""",
                (project_id, term, plain, db.now()),
            )
    return db.experiment_bundle(eid)


@app.get("/api/experiments/{experiment_id}")
def get_experiment(experiment_id: int):
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    return exp


@app.put("/api/experiments/{experiment_id}/mode")
def set_mode(experiment_id: int, body: ModeIn):
    if body.mode not in {"notebook", "cycle"}:
        raise HTTPException(422, "mode must be notebook or cycle")
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    if body.mode == "notebook" and exp["commitments"]:
        raise HTTPException(
            409,
            "This entry already has a locked commitment. Leaving the cycle would orphan it, "
            "and a commitment cannot be recreated. Delete the entry if you really want it gone.",
        )
    db.execute("UPDATE experiments SET mode = ? WHERE id = ?", (body.mode, experiment_id))
    return db.experiment_bundle(experiment_id)


@app.get("/api/projects/{project_id}/reagents")
def list_reagents(project_id: int, include_archived: bool = False):
    sql = "SELECT * FROM reagents WHERE project_id = ?"
    if not include_archived:
        sql += " AND archived = 0"
    sql += " ORDER BY name COLLATE NOCASE"
    out = db.rows(sql, (project_id,))
    for r in out:
        r["status"] = db.reagent_status(r)
        r["component_count"] = len(
            db.rows("SELECT id FROM reagent_components WHERE reagent_id = ?", (r["id"],))
        )
        r["use_count"] = len(
            db.rows("SELECT id FROM reagent_uses WHERE reagent_id = ?", (r["id"],))
        )
    return out


@app.post("/api/projects/{project_id}/reagents")
def create_reagent(project_id: int, body: ReagentIn):
    if not body.name.strip():
        raise HTTPException(422, "A name, at least.")
    rid = db.insert(
        """INSERT INTO reagents
           (project_id, name, kind, supplier, catalogue, lot, concentration, unit,
            amount_total, amount_left, low_at, location, opened_at, expires_at, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (project_id, body.name.strip(), body.kind, body.supplier, body.catalogue, body.lot,
         body.concentration, body.unit, body.amount_total,
         body.amount_left if body.amount_left is not None else body.amount_total,
         body.low_at, body.location, body.opened_at, body.expires_at, body.notes, db.now()),
    )
    return db.reagent_bundle(rid)


@app.get("/api/reagents/{reagent_id}")
def get_reagent(reagent_id: int):
    r = db.reagent_bundle(reagent_id)
    if not r:
        raise HTTPException(404, "No such reagent")
    return r


@app.put("/api/reagents/{reagent_id}")
def update_reagent(reagent_id: int, body: ReagentIn):
    if not db.row("SELECT id FROM reagents WHERE id = ?", (reagent_id,)):
        raise HTTPException(404, "No such reagent")
    db.execute(
        """UPDATE reagents SET name=?, kind=?, supplier=?, catalogue=?, lot=?, concentration=?,
           unit=?, amount_total=?, amount_left=?, low_at=?, location=?, opened_at=?,
           expires_at=?, notes=? WHERE id=?""",
        (body.name.strip(), body.kind, body.supplier, body.catalogue, body.lot,
         body.concentration, body.unit, body.amount_total, body.amount_left, body.low_at,
         body.location, body.opened_at, body.expires_at, body.notes, reagent_id),
    )
    return db.reagent_bundle(reagent_id)


@app.delete("/api/reagents/{reagent_id}")
def archive_reagent(reagent_id: int):
    r = db.row("SELECT * FROM reagents WHERE id = ?", (reagent_id,))
    if not r:
        raise HTTPException(404, "No such reagent")
    db.execute("UPDATE reagents SET archived = 1 WHERE id = ?", (reagent_id,))
    return list_reagents(r["project_id"])


@app.post("/api/reagents/{reagent_id}/components")
def add_component(reagent_id: int, body: ComponentIn):
    if not db.row("SELECT id FROM reagents WHERE id = ?", (reagent_id,)):
        raise HTTPException(404, "No such reagent")
    n = len(db.rows("SELECT id FROM reagent_components WHERE reagent_id = ?", (reagent_id,)))
    db.insert(
        """INSERT INTO reagent_components (reagent_id, name, final_conc, source_reagent_id, position)
           VALUES (?, ?, ?, ?, ?)""",
        (reagent_id, body.name.strip(), body.final_conc, body.source_reagent_id, n),
    )
    return db.reagent_bundle(reagent_id)


@app.delete("/api/components/{component_id}")
def delete_component(component_id: int):
    c = db.row("SELECT * FROM reagent_components WHERE id = ?", (component_id,))
    if not c:
        raise HTTPException(404, "No such component")
    db.execute("DELETE FROM reagent_components WHERE id = ?", (component_id,))
    return db.reagent_bundle(c["reagent_id"])


@app.post("/api/reagents/{reagent_id}/use")
def log_use(reagent_id: int, body: UseIn):
    r = db.row("SELECT * FROM reagents WHERE id = ?", (reagent_id,))
    if not r:
        raise HTTPException(404, "No such reagent")
    db.insert(
        """INSERT INTO reagent_uses (reagent_id, experiment_id, amount, note, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (reagent_id, body.experiment_id, body.amount, body.note, db.now()),
    )
    if body.amount and r["amount_left"] is not None:
        db.execute(
            "UPDATE reagents SET amount_left = MAX(0, amount_left - ?) WHERE id = ?",
            (body.amount, reagent_id),
        )
    return db.reagent_bundle(reagent_id)


@app.delete("/api/uses/{use_id}")
def delete_use(use_id: int):
    u = db.row("SELECT * FROM reagent_uses WHERE id = ?", (use_id,))
    if not u:
        raise HTTPException(404, "No such entry")
    if u["amount"]:
        db.execute(
            "UPDATE reagents SET amount_left = amount_left + ? WHERE id = ? AND amount_left IS NOT NULL",
            (u["amount"], u["reagent_id"]),
        )
    db.execute("DELETE FROM reagent_uses WHERE id = ?", (use_id,))
    return db.reagent_bundle(u["reagent_id"])


@app.get("/api/projects/{project_id}/restock")
def restock(project_id: int):
    out = []
    for r in list_reagents(project_id):
        if r["status"] in {"low", "out"}:
            pct = None
            if r["amount_total"]:
                pct = round(100 * (r["amount_left"] or 0) / r["amount_total"])
            out.append({
                "id": r["id"], "name": r["name"], "status": r["status"],
                "supplier": r["supplier"], "catalogue": r["catalogue"], "lot": r["lot"],
                "amount_left": r["amount_left"], "unit": r["unit"], "percent_left": pct,
                "location": r["location"],
            })
    return out


@app.get("/api/experiments/{experiment_id}/deletion_preview")
def deletion_preview(experiment_id: int):
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    commitments = exp["commitments"]
    challenges = sum(len(c["challenges"]) for c in commitments)
    resolutions = sum(1 for c in commitments if c.get("resolution"))
    children = db.rows(
        "SELECT id, title FROM experiments WHERE parent_experiment_id = ?", (experiment_id,)
    )
    return {
        "title": exp["title"],
        "notes": len(exp["notes"]),
        "recordings": len(exp["recordings"]),
        "ink": len(exp["ink"]),
        "highlights": len(exp["highlights"]),
        "papers": len(exp["papers"]),
        "commitments": len(commitments),
        "challenges": challenges,
        "resolutions": resolutions,
        "children": [c["title"] for c in children],
    }


@app.delete("/api/experiments/{experiment_id}")
def delete_experiment(experiment_id: int):
    exp = db.row("SELECT * FROM experiments WHERE id = ?", (experiment_id,))
    if not exp:
        raise HTTPException(404, "No such experiment")
    for r in db.rows("SELECT stored_path FROM recordings WHERE experiment_id = ?", (experiment_id,)):
        Path(r["stored_path"]).unlink(missing_ok=True)
    db.execute(
        "UPDATE experiments SET parent_experiment_id = NULL WHERE parent_experiment_id = ?",
        (experiment_id,),
    )
    db.execute("DELETE FROM experiments WHERE id = ?", (experiment_id,))
    return {"deleted": experiment_id, "project_id": exp["project_id"]}


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int):
    n = db.row("SELECT * FROM notes WHERE id = ?", (note_id,))
    if not n:
        raise HTTPException(404, "No such note")
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return db.experiment_bundle(n["experiment_id"])


@app.delete("/api/recordings/{recording_id}")
def delete_recording(recording_id: int):
    r = db.row("SELECT * FROM recordings WHERE id = ?", (recording_id,))
    if not r:
        raise HTTPException(404, "No such recording")
    Path(r["stored_path"]).unlink(missing_ok=True)
    db.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
    return db.experiment_bundle(r["experiment_id"])


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


@app.post("/api/experiments/{experiment_id}/ink")
def add_ink(experiment_id: int, body: InkIn):
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    if not body.strokes:
        raise HTTPException(422, "Nothing written.")
    db.insert(
        """INSERT INTO ink_notes (experiment_id, strokes, width, height, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (experiment_id, json.dumps(body.strokes), body.width, body.height, db.now()),
    )
    return db.experiment_bundle(experiment_id)


@app.delete("/api/ink/{ink_id}")
def delete_ink(ink_id: int):
    r = db.row("SELECT * FROM ink_notes WHERE id = ?", (ink_id,))
    if not r:
        raise HTTPException(404, "No such ink note")
    db.execute("DELETE FROM ink_notes WHERE id = ?", (ink_id,))
    return db.experiment_bundle(r["experiment_id"])


@app.post("/api/experiments/{experiment_id}/highlights")
def add_highlight(experiment_id: int, body: HighlightIn):
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "Nothing selected.")
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    if not db.row(
        "SELECT id FROM highlights WHERE experiment_id = ? AND body = ?", (experiment_id, text)
    ):
        db.insert(
            "INSERT INTO highlights (experiment_id, body, created_at) VALUES (?, ?, ?)",
            (experiment_id, text, db.now()),
        )
    return db.experiment_bundle(experiment_id)


@app.delete("/api/highlights/{highlight_id}")
def delete_highlight(highlight_id: int):
    h = db.row("SELECT * FROM highlights WHERE id = ?", (highlight_id,))
    if not h:
        raise HTTPException(404, "No such highlight")
    db.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))
    return db.experiment_bundle(h["experiment_id"])


@app.post("/api/notes/{note_id}/annotations")
def annotate_step(note_id: int, body: StepNoteIn):
    n = db.row("SELECT * FROM notes WHERE id = ?", (note_id,))
    if not n:
        raise HTTPException(404, "No such line")
    if not body.body.strip():
        raise HTTPException(422, "Nothing written.")
    db.insert(
        "INSERT INTO step_notes (note_id, body, created_at) VALUES (?, ?, ?)",
        (note_id, body.body.strip(), db.now()),
    )
    return db.experiment_bundle(n["experiment_id"])


@app.delete("/api/annotations/{annotation_id}")
def delete_annotation(annotation_id: int):
    a = db.row("SELECT * FROM step_notes WHERE id = ?", (annotation_id,))
    if not a:
        raise HTTPException(404, "No such annotation")
    n = db.row("SELECT * FROM notes WHERE id = ?", (a["note_id"],))
    db.execute("DELETE FROM step_notes WHERE id = ?", (annotation_id,))
    return db.experiment_bundle(n["experiment_id"])


@app.post("/api/experiments/{experiment_id}/datasets")
async def upload_dataset(experiment_id: int, file: UploadFile = File(...),
                         kind: str = "other", label: str = ""):
    exp = db.row("SELECT * FROM experiments WHERE id = ?", (experiment_id,))
    if not exp:
        raise HTTPException(404, "No such experiment")
    blob = await file.read()
    try:
        datafiles.check(file.filename or "", len(blob))
    except datafiles.DataError as e:
        raise HTTPException(422, str(e))

    db.DATA_DIR.mkdir(exist_ok=True)
    suffix = Path(file.filename).suffix.lower()
    stored = db.DATA_DIR / f"{uuid.uuid4().hex}{suffix}"
    stored.write_bytes(blob)

    prof = datafiles.profile(stored)
    did = db.insert(
        """INSERT INTO datasets
           (project_id, experiment_id, kind, label, filename, stored_path, size_bytes,
            n_rows, n_cols, columns_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (exp["project_id"], experiment_id, kind, label or Path(file.filename).stem,
         file.filename, str(stored), len(blob), prof["n_rows"], prof["n_cols"],
         json.dumps(prof["columns"]), db.now()),
    )
    return {"dataset_id": did, "experiment": db.experiment_bundle(experiment_id)}


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: int):
    d = db.row("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    if not d:
        raise HTTPException(404, "No such dataset")
    d["columns"] = datafiles.columns_of(d)
    d.pop("columns_json", None)
    path = Path(d["stored_path"])
    d["exists"] = path.exists()
    d["preview"] = datafiles.preview(path) if path.exists() else {"header": [], "rows": []}
    d.pop("stored_path", None)
    return d


@app.get("/api/datasets/{dataset_id}/file")
def download_dataset(dataset_id: int):
    d = db.row("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    if not d or not Path(d["stored_path"]).exists():
        raise HTTPException(404, "No file")
    return FileResponse(d["stored_path"], filename=d["filename"])


@app.put("/api/datasets/{dataset_id}")
def edit_dataset(dataset_id: int, body: DatasetIn):
    d = db.row("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    if not d:
        raise HTTPException(404, "No such dataset")
    db.execute("UPDATE datasets SET kind = ?, label = ?, notes = ? WHERE id = ?",
               (body.kind, body.label, body.notes, dataset_id))
    return get_dataset(dataset_id)


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int):
    d = db.row("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
    if not d:
        raise HTTPException(404, "No such dataset")
    Path(d["stored_path"]).unlink(missing_ok=True)
    db.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
    return db.experiment_bundle(d["experiment_id"]) if d["experiment_id"] else {"deleted": dataset_id}


@app.get("/api/projects/{project_id}/datasets")
def project_datasets(project_id: int):
    out = db.rows(
        """SELECT d.*, e.title AS experiment_title, f.name AS folder_name
           FROM datasets d
           LEFT JOIN experiments e ON e.id = d.experiment_id
           LEFT JOIN folders f ON f.id = e.folder_id
           WHERE d.project_id = ? ORDER BY d.created_at DESC""",
        (project_id,),
    )
    for d in out:
        d["columns"] = datafiles.columns_of(d)
        d.pop("columns_json", None)
        d.pop("stored_path", None)
    return out


@app.get("/api/templates")
def list_templates():
    return templates.TEMPLATES


@app.post("/api/calc")
def do_calc(body: CalcIn):
    try:
        return calc.run(body.kind, body.args)
    except calc.CalcError as e:
        raise HTTPException(422, str(e))


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


def _transcribe_worker(recording_id: int, path: str) -> None:
    try:
        text, engine = transcribe.transcribe(Path(path))
    except transcribe.Unavailable as e:
        db.execute(
            """UPDATE recordings SET transcript_state = 'failed', transcript_error = ?
               WHERE id = ?""",
            (str(e), recording_id),
        )
        return
    except Exception as e:
        db.execute(
            """UPDATE recordings SET transcript_state = 'failed', transcript_error = ?
               WHERE id = ?""",
            (f"Transcription failed: {e}", recording_id),
        )
        return
    db.execute(
        """UPDATE recordings SET transcript = ?, transcript_engine = ?,
           transcript_state = 'done', transcript_error = '' WHERE id = ?""",
        (text, engine, recording_id),
    )


@app.post("/api/recordings/{recording_id}/transcribe")
def run_transcription(recording_id: int):
    rec = db.row("SELECT * FROM recordings WHERE id = ?", (recording_id,))
    if not rec:
        raise HTTPException(404, "No such recording")
    if rec["transcript_state"] == "running":
        return db.experiment_bundle(rec["experiment_id"])
    st = transcribe.status()
    if not st["ready"]:
        raise HTTPException(503, "; ".join(st["missing"]))

    db.execute(
        """UPDATE recordings SET transcript_state = 'running', transcript_error = ''
           WHERE id = ?""",
        (recording_id,),
    )
    threading.Thread(
        target=_transcribe_worker, args=(recording_id, rec["stored_path"]), daemon=True
    ).start()
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
    for field in ("observed", "interpretation"):
        if not getattr(body, field).strip():
            raise HTTPException(
                422,
                "You need what you saw and what you make of it. Everything else is optional.",
            )
    cid = db.insert(
        """INSERT INTO commitments
           (experiment_id, aim, expected, observed, interpretation, confidence,
            disconfirming, proposed_next, locked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (experiment_id, body.aim, body.expected, body.observed, body.interpretation,
         body.confidence, body.disconfirming, body.proposed_next, db.now()),
    )
    return {"commitment_id": cid, "experiment": db.experiment_bundle(experiment_id)}


@app.post("/api/commitments/{commitment_id}/challenge")
def run_challenge(commitment_id: int):
    commitment = db.row("SELECT * FROM commitments WHERE id = ?", (commitment_id,))
    if not commitment:
        raise HTTPException(404, "No such commitment")
    exp = db.experiment_bundle(commitment["experiment_id"])
    history = db.folder_history(exp["id"])
    folder = db.folder_name(exp["id"])
    try:
        blind = llm.blind_challenge(exp, commitment, history=history, folder=folder)
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


@app.post("/api/projects/{project_id}/glossary/define")
def define_term(project_id: int, body: DefineIn):
    term = body.term.strip()
    if not term or len(term) > 80:
        raise HTTPException(422, "Select a word or short phrase.")
    existing = db.row(
        "SELECT * FROM glossary WHERE project_id = ? AND LOWER(term) = LOWER(?)",
        (project_id, term),
    )
    if existing:
        return existing
    context = ""
    if body.experiment_id:
        exp = db.experiment_bundle(body.experiment_id)
        if exp:
            context = db.experiment_text(exp)
    try:
        entry = llm.define_term(term, context)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    db.execute(
        """INSERT INTO glossary (project_id, term, plain, source, created_at)
           VALUES (?, ?, ?, 'ai', ?)
           ON CONFLICT (project_id, term) DO UPDATE SET plain = excluded.plain""",
        (project_id, entry["term"].strip() or term, entry["plain"].strip(), db.now()),
    )
    return db.row(
        "SELECT * FROM glossary WHERE project_id = ? AND LOWER(term) = LOWER(?)",
        (project_id, entry["term"].strip() or term),
    )


@app.get("/api/projects/{project_id}/folders")
def list_folders(project_id: int):
    return db.rows(
        """SELECT f.*, (SELECT COUNT(*) FROM experiments e WHERE e.folder_id = f.id) AS n
           FROM folders f WHERE f.project_id = ? ORDER BY f.name""",
        (project_id,),
    )


@app.post("/api/projects/{project_id}/folders")
def create_folder(project_id: int, body: FolderIn):
    if not body.name.strip():
        raise HTTPException(422, "A name, at least.")
    db.insert(
        "INSERT INTO folders (project_id, name, created_at) VALUES (?, ?, ?)",
        (project_id, body.name.strip(), db.now()),
    )
    return list_folders(project_id)


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int):
    f = db.row("SELECT * FROM folders WHERE id = ?", (folder_id,))
    if not f:
        raise HTTPException(404, "No such folder")
    db.execute("UPDATE experiments SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return list_folders(f["project_id"])


@app.put("/api/experiments/{experiment_id}/folder")
def set_folder(experiment_id: int, body: dict):
    fid = body.get("folder_id")
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    db.execute("UPDATE experiments SET folder_id = ? WHERE id = ?", (fid, experiment_id))
    return db.experiment_bundle(experiment_id)


@app.get("/api/projects/{project_id}/suggestions")
def suggestions(project_id: int):
    keys: dict[str, dict[str, int]] = {}
    for e in db.rows("SELECT context_json FROM experiments WHERE project_id = ?", (project_id,)):
        for k, v in (json.loads(e["context_json"] or "{}")).items():
            k, v = k.strip(), str(v).strip()
            if not k or not v:
                continue
            keys.setdefault(k, {})
            keys[k][v] = keys[k].get(v, 0) + 1

    values = {
        k: [v for v, _ in sorted(vs.items(), key=lambda kv: (-kv[1], kv[0]))]
        for k, vs in keys.items()
    }
    ordered_keys = sorted(keys, key=lambda k: (-sum(keys[k].values()), k))

    terms = [g["term"] for g in db.rows(
        "SELECT term FROM glossary WHERE project_id = ? ORDER BY term", (project_id,))]

    return {"context_keys": ordered_keys, "context_values": values, "terms": terms}


@app.get("/api/experiments/{experiment_id}/literature/suggest")
def suggest_literature_query(experiment_id: int):
    exp = db.experiment_bundle(experiment_id)
    if not exp:
        raise HTTPException(404, "No such experiment")
    terms = [g["term"] for g in glossary_matches(exp["project_id"], experiment_id)]
    return {"query": literature.suggest_query(exp, terms)}


@app.post("/api/literature/search")
def search_literature(body: SearchIn):
    try:
        out = literature.search(
            body.query, include_preprints=body.include_preprints,
            reviews_only=body.reviews_only,
        )
    except literature.LookupError_ as e:
        raise HTTPException(502, str(e))
    have = {i["doi"].lower() for i in (zotero.items() if zotero.status()["ready"] else [])
            if i.get("doi")}
    for r in out["results"]:
        r["in_my_library"] = bool(r["doi"]) and r["doi"].lower() in have
    return out


@app.get("/api/zotero/status")
def zotero_status():
    return zotero.status()


@app.get("/api/zotero/collections")
def zotero_collections():
    try:
        return zotero.collections()
    except zotero.Unavailable as e:
        raise HTTPException(503, str(e))


@app.get("/api/zotero/items")
def zotero_items(collection: str | None = None, engaged_only: bool = False):
    try:
        out = zotero.items(collection_key=collection, engaged_only=engaged_only)
    except zotero.Unavailable as e:
        raise HTTPException(503, str(e))
    digests = {d["zotero_key"] for d in db.rows("SELECT zotero_key FROM paper_digests")}
    noted = {n["zotero_key"] for n in db.rows("SELECT zotero_key FROM paper_notes WHERE body != ''")}
    for it in out:
        it["has_digest"] = it["key"] in digests
        it["has_my_note"] = it["key"] in noted
    return out


def _split_authors(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    for sep in (";", " and ", "&"):
        if sep in raw:
            return [a.strip() for a in raw.split(sep) if a.strip()][:3]
    parts = [a.strip() for a in raw.split(",") if a.strip()]
    if any(len(a.replace(".", "")) <= 2 for a in parts):
        return [raw]
    return parts[:3]


def _uploaded(key: str) -> dict | None:
    if not key.startswith("upload:"):
        return None
    r = db.row("SELECT * FROM uploaded_papers WHERE id = ?", (key.split(":", 1)[1],))
    if not r:
        return None
    return {
        "key": key, "type": "uploaded", "title": r["title"],
        "abstract": "", "date": r["year"], "doi": r["doi"], "url": "",
        "journal": r["journal"],
        "authors": _split_authors(r["authors"]),
        "more_authors": 0, "tags": [], "notes": [], "annotations": [],
        "engaged": True, "has_pdf": Path(r["stored_path"]).exists(),
        "filename": r["filename"], "source": "upload",
    }


@app.post("/api/projects/{project_id}/papers/upload")
async def upload_paper(project_id: int, file: UploadFile = File(...)):
    if not db.row("SELECT id FROM projects WHERE id = ?", (project_id,)):
        raise HTTPException(404, "No such project")
    if Path(file.filename or "").suffix.lower() != ".pdf":
        raise HTTPException(422, "PDF only for now.")
    db.PAPER_DIR.mkdir(exist_ok=True)
    stored = db.PAPER_DIR / f"{uuid.uuid4().hex}.pdf"
    with stored.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    title = Path(file.filename).stem.replace("_", " ").strip()
    authors = year = doi = journal = ""
    try:
        from pypdf import PdfReader

        rd = PdfReader(str(stored))
        meta = rd.metadata or {}
        title = (meta.get("/Title") or "").strip() or title
        authors = (meta.get("/Author") or "").strip()
        first = (rd.pages[0].extract_text() or "")[:3000]
        m = re.search(r"\b(10\.\d{4,9}/[^\s\"<>]+)", first)
        if m:
            doi = m.group(1).rstrip(".,;")
        y = re.search(r"\b(19|20)\d{2}\b", first)
        if y:
            year = y.group(0)
    except Exception:
        pass

    pid = db.insert(
        """INSERT INTO uploaded_papers
           (project_id, title, filename, stored_path, authors, year, doi, journal, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (project_id, title or file.filename, file.filename, str(stored),
         authors, year, doi, journal, db.now()),
    )
    return get_paper(f"upload:{pid}")


@app.get("/api/projects/{project_id}/papers/uploaded")
def list_uploaded(project_id: int):
    digests = {d["zotero_key"] for d in db.rows("SELECT zotero_key FROM paper_digests")}
    noted = {n["zotero_key"] for n in db.rows("SELECT zotero_key FROM paper_notes WHERE body != ''")}
    out = []
    for r in db.rows(
        "SELECT id FROM uploaded_papers WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ):
        it = _uploaded(f"upload:{r['id']}")
        it["has_digest"] = it["key"] in digests
        it["has_my_note"] = it["key"] in noted
        out.append(it)
    return out


@app.delete("/api/uploaded_papers/{paper_id}")
def delete_uploaded(paper_id: int):
    r = db.row("SELECT * FROM uploaded_papers WHERE id = ?", (paper_id,))
    if not r:
        raise HTTPException(404, "No such paper")
    Path(r["stored_path"]).unlink(missing_ok=True)
    db.execute("DELETE FROM uploaded_papers WHERE id = ?", (paper_id,))
    return list_uploaded(r["project_id"])


@app.get("/api/papers/{key}/pdf")
def paper_pdf(key: str):
    r = db.row("SELECT * FROM uploaded_papers WHERE id = ?", (key.split(":", 1)[-1],))
    if not r or not Path(r["stored_path"]).exists():
        raise HTTPException(404, "No file")
    return FileResponse(r["stored_path"], filename=r["filename"], media_type="application/pdf")


@app.get("/api/papers/{key}")
def get_paper(key: str):
    it = _uploaded(key)
    if it is None:
        try:
            it = zotero.item(key)
        except zotero.Unavailable as e:
            raise HTTPException(503, str(e))
    if not it:
        raise HTTPException(404, "Not found in your library or uploads")
    d = db.row("SELECT * FROM paper_digests WHERE zotero_key = ?", (key,))
    if d:
        for f in ("experiments", "methods", "limitations"):
            d[f] = json.loads(d[f])
    note = db.row("SELECT * FROM paper_notes WHERE zotero_key = ?", (key,))
    return {"item": it, "digest": d, "my_note": note["body"] if note else ""}


@app.post("/api/papers/{key}/digest")
def make_digest(key: str):
    up = _uploaded(key)
    if up:
        it = up
        r = db.row("SELECT * FROM uploaded_papers WHERE id = ?", (key.split(":", 1)[1],))
        try:
            from pypdf import PdfReader

            raw = "\n".join((pg.extract_text() or "") for pg in PdfReader(r["stored_path"]).pages)
            text = zotero._clean(raw).strip()[:60000]
        except Exception as e:
            raise HTTPException(503, f"Could not read that PDF: {e}")
        if len(text) < 400:
            raise HTTPException(503, "That PDF has no extractable text. It may be a scan.")
        source = f"full text, {r['filename']}"
    else:
        try:
            it = zotero.item(key)
            if not it:
                raise HTTPException(404, "Not in your Zotero library")
            text, source = zotero.source_text(key)
        except zotero.Unavailable as e:
            raise HTTPException(503, str(e))
    try:
        d = llm.paper_digest(it["title"], text, source)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    db.execute(
        """INSERT INTO paper_digests
           (zotero_key, main_claim, experiments, methods, limitations, source, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (zotero_key) DO UPDATE SET
             main_claim = excluded.main_claim, experiments = excluded.experiments,
             methods = excluded.methods, limitations = excluded.limitations,
             source = excluded.source, model = excluded.model, created_at = excluded.created_at""",
        (key, d["main_claim"], json.dumps(d["experiments"]), json.dumps(d["methods"]),
         json.dumps(d["limitations"]), source, llm.MODEL, db.now()),
    )
    return get_paper(key)


@app.put("/api/papers/{key}/note")
def set_paper_note(key: str, body: PaperNoteIn):
    db.execute(
        """INSERT INTO paper_notes (zotero_key, body, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (zotero_key) DO UPDATE SET body = excluded.body,
           updated_at = excluded.updated_at""",
        (key, body.body, db.now()),
    )
    return get_paper(key)


@app.post("/api/experiments/{experiment_id}/papers")
def link_paper(experiment_id: int, body: PaperLinkIn):
    if not db.row("SELECT id FROM experiments WHERE id = ?", (experiment_id,)):
        raise HTTPException(404, "No such experiment")
    db.execute(
        """INSERT INTO experiment_papers (experiment_id, zotero_key, created_at)
           VALUES (?, ?, ?) ON CONFLICT (experiment_id, zotero_key) DO NOTHING""",
        (experiment_id, body.zotero_key, db.now()),
    )
    return db.experiment_bundle(experiment_id)


@app.delete("/api/experiments/{experiment_id}/papers/{key}")
def unlink_paper(experiment_id: int, key: str):
    db.execute(
        "DELETE FROM experiment_papers WHERE experiment_id = ? AND zotero_key = ?",
        (experiment_id, key),
    )
    return db.experiment_bundle(experiment_id)


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
            "commitment_id": last["id"] if last else None,
            "title": e["title"],
            "parent": e["parent_experiment_id"],
            "confidence": last["confidence"] if last else None,
            "confidence_after": after,
            "stance": stance,
            "challenged": bool(last and last["challenges"]),
            "resolution": (last or {}).get("resolution") or None,
        })
    pending = [
        {"commitment_id": n["commitment_id"], "title": n["title"],
         "confidence": n["confidence"]}
        for n in nodes
        if n["commitment_id"]
        and (not n["resolution"] or n["resolution"]["verdict"] == "unresolved")
    ]
    return {
        "nodes": nodes,
        "edges": [{"from": n["parent"], "to": n["id"]} for n in nodes if n["parent"]],
        "awaiting_verdict": pending,
    }


@app.get("/api/projects/{project_id}/calibration")
def calibration(project_id: int):
    scored = {"held": 1.0, "partly": 0.5, "overturned": 0.0}
    have_conf = db.rows(
        """SELECT c.id FROM commitments c JOIN experiments e ON e.id = c.experiment_id
           WHERE e.project_id = ? AND c.confidence IS NOT NULL""",
        (project_id,),
    )
    buckets: dict[str, dict] = {}
    points = []
    resolved = db.rows(
        """SELECT c.confidence, r.verdict, e.title
           FROM commitments c
           JOIN experiments e ON e.id = c.experiment_id
           JOIN resolutions r ON r.commitment_id = c.id
           WHERE e.project_id = ? AND r.verdict != 'unresolved'
             AND c.confidence IS NOT NULL""",
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
        "tracked_confidence_n": len(have_conf),
        "resolved_n": len(points),
        "brier_score": brier,
        "buckets": buckets,
        "stance_counts": {s["stance"]: s["n"] for s in stances},
    }


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
