import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "benchcraft-export.json"

TABLES = [
    "projects", "folders", "experiments", "notes", "step_notes", "recordings", "uploaded_papers",
    "reagents", "reagent_components", "reagent_uses", "datasets", "ink_notes", "highlights",
    "commitments", "challenges", "responses", "resolutions", "glossary", "connectors",
    "connector_calls", "paper_digests", "paper_notes", "experiment_papers",
]


def main() -> None:
    conn = sqlite3.connect(ROOT / "benchcraft.db")
    conn.row_factory = sqlite3.Row
    dump = {"benchcraft_export": 1}
    for t in TABLES:
        dump[t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t}")]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(dump, indent=1))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
