import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "benchcraft.db"
AUDIO_DIR = ROOT / "audio"
PAPER_DIR = ROOT / "papers"
DATA_DIR = ROOT / "data"

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
    id                   INTEGER PRIMARY KEY,
    project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    folder_id            INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    parent_experiment_id INTEGER REFERENCES experiments(id),
    title                TEXT NOT NULL,
    mode                 TEXT NOT NULL DEFAULT 'notebook',
    question             TEXT NOT NULL DEFAULT '',
    context_json         TEXT NOT NULL DEFAULT '{}',
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
    id                INTEGER PRIMARY KEY,
    experiment_id     INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    filename          TEXT NOT NULL,
    stored_path       TEXT NOT NULL,
    duration_s        REAL,
    transcript        TEXT NOT NULL DEFAULT '',
    transcript_engine TEXT NOT NULL DEFAULT '',
    transcript_state  TEXT NOT NULL DEFAULT 'pending',
    transcript_error  TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id            INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    body          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'typed',
    recording_id  INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_papers (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    authors     TEXT NOT NULL DEFAULT '',
    year        TEXT NOT NULL DEFAULT '',
    doi         TEXT NOT NULL DEFAULT '',
    journal     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reagents (
    id             INTEGER PRIMARY KEY,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'reagent',
    supplier       TEXT NOT NULL DEFAULT '',
    catalogue      TEXT NOT NULL DEFAULT '',
    lot            TEXT NOT NULL DEFAULT '',
    concentration  TEXT NOT NULL DEFAULT '',
    unit           TEXT NOT NULL DEFAULT '',
    amount_total   REAL,
    amount_left    REAL,
    low_at         REAL,
    location       TEXT NOT NULL DEFAULT '',
    opened_at      TEXT NOT NULL DEFAULT '',
    expires_at     TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    archived       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reagent_components (
    id                INTEGER PRIMARY KEY,
    reagent_id        INTEGER NOT NULL REFERENCES reagents(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    final_conc        TEXT NOT NULL DEFAULT '',
    source_reagent_id INTEGER REFERENCES reagents(id) ON DELETE SET NULL,
    position          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reagent_uses (
    id            INTEGER PRIMARY KEY,
    reagent_id    INTEGER NOT NULL REFERENCES reagents(id) ON DELETE CASCADE,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
    amount        REAL,
    note          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
    kind          TEXT NOT NULL DEFAULT 'other',
    label         TEXT NOT NULL DEFAULT '',
    filename      TEXT NOT NULL,
    stored_path   TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    n_rows        INTEGER,
    n_cols        INTEGER,
    columns_json  TEXT NOT NULL DEFAULT '[]',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_notes (
    id         INTEGER PRIMARY KEY,
    note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ink_notes (
    id            INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    strokes       TEXT NOT NULL,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS highlights (
    id            INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    body          TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commitments (
    id             INTEGER PRIMARY KEY,
    experiment_id  INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    aim            TEXT NOT NULL DEFAULT '',
    expected       TEXT NOT NULL DEFAULT '',
    observed       TEXT NOT NULL,
    interpretation TEXT NOT NULL,
    confidence     INTEGER,
    disconfirming  TEXT NOT NULL DEFAULT '',
    proposed_next  TEXT NOT NULL DEFAULT '',
    locked_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
    id              INTEGER PRIMARY KEY,
    commitment_id   INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    blind_json      TEXT NOT NULL,
    divergence_json TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
    id               INTEGER PRIMARY KEY,
    challenge_id     INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    stance           TEXT NOT NULL,
    reasoning        TEXT NOT NULL,
    confidence_after INTEGER NOT NULL,
    chosen_next      TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolutions (
    id            INTEGER PRIMARY KEY,
    commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    verdict       TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    term       TEXT NOT NULL,
    plain      TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'curated',
    created_at TEXT NOT NULL,
    UNIQUE (project_id, term)
);

CREATE TABLE IF NOT EXISTS connectors (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    endpoint    TEXT NOT NULL DEFAULT '',
    key_env     TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_calls (
    id            INTEGER PRIMARY KEY,
    connector_id  INTEGER NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    request       TEXT NOT NULL,
    response      TEXT NOT NULL,
    ok            INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_digests (
    id          INTEGER PRIMARY KEY,
    zotero_key  TEXT NOT NULL UNIQUE,
    main_claim  TEXT NOT NULL,
    experiments TEXT NOT NULL DEFAULT '[]',
    methods     TEXT NOT NULL DEFAULT '[]',
    limitations TEXT NOT NULL DEFAULT '[]',
    source      TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_notes (
    id         INTEGER PRIMARY KEY,
    zotero_key TEXT NOT NULL UNIQUE,
    body       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_papers (
    id            INTEGER PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    zotero_key    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE (experiment_id, zotero_key)
);

CREATE INDEX IF NOT EXISTS idx_exp_project ON experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_commit_exp  ON commitments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_chal_commit ON challenges(commitment_id);
CREATE INDEX IF NOT EXISTS idx_rec_exp     ON recordings(experiment_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(notes)").fetchall()}
    if cols and "recording_id" not in cols:
        conn.execute("ALTER TABLE notes ADD COLUMN recording_id INTEGER REFERENCES recordings(id)")
    ecols = {r["name"] for r in conn.execute("PRAGMA table_info(experiments)").fetchall()}
    if ecols and "folder_id" not in ecols:
        conn.execute("ALTER TABLE experiments ADD COLUMN folder_id INTEGER REFERENCES folders(id)")
    ccols = conn.execute("PRAGMA table_info(commitments)").fetchall()
    names = {r["name"] for r in ccols}
    conf_required = any(r["name"] == "confidence" and r["notnull"] for r in ccols)
    if names and (("aim" not in names) or conf_required):
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS commitments_new (
                id             INTEGER PRIMARY KEY,
                experiment_id  INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
                aim            TEXT NOT NULL DEFAULT '',
                expected       TEXT NOT NULL DEFAULT '',
                observed       TEXT NOT NULL,
                interpretation TEXT NOT NULL,
                confidence     INTEGER,
                disconfirming  TEXT NOT NULL DEFAULT '',
                proposed_next  TEXT NOT NULL DEFAULT '',
                locked_at      TEXT NOT NULL
            );
            """
        )
        cols = "aim, " if "aim" in names else "'' AS aim, "
        conn.execute(
            "INSERT INTO commitments_new (id, experiment_id, aim, expected, observed, "
            "interpretation, confidence, disconfirming, proposed_next, locked_at) "
            f"SELECT id, experiment_id, {cols} expected, observed, interpretation, confidence, "
            "disconfirming, proposed_next, locked_at FROM commitments"
        )
        conn.executescript(
            "DROP TABLE commitments;"
            "ALTER TABLE commitments_new RENAME TO commitments;"
            "CREATE INDEX IF NOT EXISTS idx_commit_exp ON commitments(experiment_id);"
        )
        conn.execute("PRAGMA foreign_keys = ON")
    if ecols and "mode" not in ecols:
        conn.execute("ALTER TABLE experiments ADD COLUMN mode TEXT NOT NULL DEFAULT 'notebook'")
        conn.execute(
            """UPDATE experiments SET mode = 'cycle' WHERE id IN
               (SELECT DISTINCT experiment_id FROM commitments)"""
        )
    rcols = {r["name"] for r in conn.execute("PRAGMA table_info(recordings)").fetchall()}
    if rcols and "transcript_error" not in rcols:
        conn.execute("ALTER TABLE recordings ADD COLUMN transcript_error TEXT NOT NULL DEFAULT ''")
    conn.execute(
        """UPDATE recordings SET transcript_state = 'failed',
           transcript_error = 'Interrupted when Benchcraft restarted. Run it again.'
           WHERE transcript_state = 'running'"""
    )


def init() -> None:
    AUDIO_DIR.mkdir(exist_ok=True)
    PAPER_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()


def rows(sql: str, args=()) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]


def row(sql: str, args=()) -> dict | None:
    with connect() as conn:
        r = conn.execute(sql, args).fetchone()
        return dict(r) if r else None


def insert(sql: str, args=()) -> int:
    with connect() as conn:
        cur = conn.execute(sql, args)
        conn.commit()
        return cur.lastrowid


def execute(sql: str, args=()) -> None:
    with connect() as conn:
        conn.execute(sql, args)
        conn.commit()


def experiment_bundle(experiment_id: int) -> dict | None:
    exp = row("SELECT * FROM experiments WHERE id = ?", (experiment_id,))
    if not exp:
        return None
    exp["context"] = json.loads(exp.pop("context_json") or "{}")
    exp["notes"] = rows(
        "SELECT * FROM notes WHERE experiment_id = ? ORDER BY created_at", (experiment_id,)
    )
    for n in exp["notes"]:
        n["annotations"] = rows(
            "SELECT * FROM step_notes WHERE note_id = ? ORDER BY created_at", (n["id"],)
        )
    exp["recordings"] = rows(
        "SELECT * FROM recordings WHERE experiment_id = ? ORDER BY created_at", (experiment_id,)
    )
    exp["datasets"] = rows(
        "SELECT * FROM datasets WHERE experiment_id = ? ORDER BY created_at", (experiment_id,)
    )
    exp["reagents"] = rows(
        """SELECT u.*, r.name, r.lot, r.supplier, r.catalogue, r.concentration, r.unit,
                  r.amount_left, r.low_at, r.location
           FROM reagent_uses u JOIN reagents r ON r.id = u.reagent_id
           WHERE u.experiment_id = ? ORDER BY u.created_at""",
        (experiment_id,),
    )
    exp["ink"] = rows(
        "SELECT * FROM ink_notes WHERE experiment_id = ? ORDER BY created_at", (experiment_id,)
    )
    exp["highlights"] = rows(
        "SELECT * FROM highlights WHERE experiment_id = ? ORDER BY created_at", (experiment_id,)
    )
    exp["papers"] = rows(
        "SELECT * FROM experiment_papers WHERE experiment_id = ? ORDER BY created_at",
        (experiment_id,),
    )
    exp["connector_calls"] = rows(
        """SELECT cc.*, c.name AS connector_name
           FROM connector_calls cc JOIN connectors c ON c.id = cc.connector_id
           WHERE cc.experiment_id = ? ORDER BY cc.created_at""",
        (experiment_id,),
    )

    commitments = rows(
        "SELECT * FROM commitments WHERE experiment_id = ? ORDER BY locked_at", (experiment_id,)
    )
    for c in commitments:
        c["challenges"] = []
        for ch in rows(
            "SELECT * FROM challenges WHERE commitment_id = ? ORDER BY created_at", (c["id"],)
        ):
            ch["blind"] = json.loads(ch.pop("blind_json"))
            div = ch.pop("divergence_json")
            ch["divergence"] = json.loads(div) if div else None
            ch["responses"] = rows(
                "SELECT * FROM responses WHERE challenge_id = ? ORDER BY created_at", (ch["id"],)
            )
            c["challenges"].append(ch)
        c["resolution"] = row(
            "SELECT * FROM resolutions WHERE commitment_id = ? ORDER BY created_at DESC LIMIT 1",
            (c["id"],),
        )
    exp["commitments"] = commitments
    return exp


def experiment_text(exp: dict) -> str:
    parts = [exp["title"], exp["question"]]
    parts += [f"{k} {v}" for k, v in (exp.get("context") or {}).items()]
    parts += [n["body"] for n in exp.get("notes", [])]
    parts += [r["transcript"] for r in exp.get("recordings", [])]
    for c in exp.get("commitments", []):
        parts += [c["expected"], c["observed"], c["interpretation"], c["disconfirming"]]
    return "\n".join(p for p in parts if p)


def folder_history(experiment_id: int) -> list[dict]:
    exp = row("SELECT folder_id, project_id, created_at FROM experiments WHERE id = ?",
              (experiment_id,))
    if not exp or not exp["folder_id"]:
        return []
    prior = rows(
        """SELECT id FROM experiments
           WHERE folder_id = ? AND id != ? AND created_at <= ?
           ORDER BY created_at""",
        (exp["folder_id"], experiment_id, exp["created_at"]),
    )
    out = []
    for e in prior:
        b = experiment_bundle(e["id"])
        if not b:
            continue
        last = b["commitments"][-1] if b["commitments"] else None
        out.append({
            "title": b["title"],
            "created_at": b["created_at"],
            "context": b["context"],
            "notes": [n["body"] for n in b["notes"]],
            "observed": last["observed"] if last else "",
            "interpretation": last["interpretation"] if last else "",
            "confidence": last["confidence"] if last else None,
            "verdict": (last or {}).get("resolution", {}) and last["resolution"]["verdict"]
                       if last and last.get("resolution") else "",
        })
    return out


def folder_name(experiment_id: int) -> str:
    r = row(
        """SELECT f.name FROM experiments e JOIN folders f ON f.id = e.folder_id
           WHERE e.id = ?""",
        (experiment_id,),
    )
    return r["name"] if r else ""


def reagent_status(r: dict) -> str:
    left, low = r.get("amount_left"), r.get("low_at")
    if left is not None and left <= 0:
        return "out"
    if left is not None and low is not None and left <= low:
        return "low"
    return "ok"


def reagent_bundle(reagent_id: int) -> dict | None:
    r = row("SELECT * FROM reagents WHERE id = ?", (reagent_id,))
    if not r:
        return None
    r["status"] = reagent_status(r)
    r["components"] = rows(
        """SELECT c.*, s.name AS source_name, s.lot AS source_lot
           FROM reagent_components c
           LEFT JOIN reagents s ON s.id = c.source_reagent_id
           WHERE c.reagent_id = ? ORDER BY c.position, c.id""",
        (reagent_id,),
    )
    r["uses"] = rows(
        """SELECT u.*, e.title AS experiment_title
           FROM reagent_uses u LEFT JOIN experiments e ON e.id = u.experiment_id
           WHERE u.reagent_id = ? ORDER BY u.created_at DESC""",
        (reagent_id,),
    )
    r["used_in"] = rows(
        """SELECT DISTINCT c.reagent_id, r2.name FROM reagent_components c
           JOIN reagents r2 ON r2.id = c.reagent_id
           WHERE c.source_reagent_id = ?""",
        (reagent_id,),
    )
    return r
