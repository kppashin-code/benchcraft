import json

from benchcraft import db

FOLDER = "MX-12 viability screen"

PROTOCOL_STEPS = [
    "d0: seed HEK293 at 5,000 cells per well in 100 uL, 96-well clear-bottom plate",
    "d0: allow 4 h to attach before dosing",
    "d0: dose MX-12 as an 8-point series, 0.1 to 10 uM, vehicle control in column 1",
    "d1: visual check for evaporation in the outer columns",
    "d2: 48 h endpoint, equilibrate the plate to room temperature for 30 min",
    "d2: CellTiter-Glo, 10 min orbital shake, read luminescence",
]

RUNS = [
    {
        "title": "Run 1, plate uniformity check",
        "created": "2026-06-12T09:00:00+00:00",
        "question": "Does the assay give a uniform vehicle signal across the plate?",
        "context": {
            "cell line": "HEK293",
            "passage": "p12",
            "plate": "96-well, clear bottom",
            "compound": "vehicle only",
            "incubation": "48 h",
            "readout": "CellTiter-Glo luminescence; all 96 wells",
        },
        "notes": [
            "Plate ran on the lower shelf, near the incubator door.",
            "Outer columns looked to have slightly less medium at the endpoint.",
        ],
        "expected": "Vehicle signal should be flat across all columns.",
        "observed": "Vehicle signal approx 12 percent lower in the outer columns, 1 and 12.",
        "interpretation": "The assay works, with a mild edge effect I can handle by excluding "
                          "the outer columns.",
        "confidence": 75,
        "disconfirming": "If the gap persists after excluding the outer columns, it is not position.",
        "verdict": "held",
        "resolution_note": "Excluding the outer columns flattened vehicle signal to within 3 percent.",
    },
    {
        "title": "Run 2, first dose response",
        "created": "2026-07-03T09:00:00+00:00",
        "question": "Does MX-12 reduce viability, and at what concentration?",
        "context": {
            "cell line": "HEK293",
            "passage": "p14",
            "plate": "96-well, clear bottom",
            "compound": "MX-12, 8-point series, 0.1 to 10 uM",
            "incubation": "48 h",
            "layout": "doses in columns, ascending left to right",
            "readout": "CellTiter-Glo luminescence; n = 3 wells per dose",
        },
        "notes": [
            "Same shelf position as run 1.",
            "Highest doses sat in the rightmost columns, at the plate edge.",
            "Outer columns again looked low on medium at the endpoint.",
        ],
        "expected": "A dose-dependent drop in signal if MX-12 is active.",
        "observed": "Clear dose response, apparent IC50 near 2 uM. Strongest apparent killing "
                    "in the highest-dose columns, which sat at the plate edge.",
        "interpretation": "MX-12 reduces viability with an IC50 around 2 uM.",
        "confidence": 65,
        "disconfirming": "If randomising dose position across the plate moves the IC50, the "
                         "effect is positional.",
        "verdict": "partly",
        "resolution_note": "Randomising the layout shifted the IC50 to about 6 uM.",
    },
    {
        "title": "Run 3, randomised layout",
        "created": "2026-07-29T09:00:00+00:00",
        "question": "With dose position randomised, does the potency estimate survive?",
        "context": {
            "cell line": "HEK293",
            "passage": "p16",
            "plate": "96-well, clear bottom",
            "compound": "MX-12, 8-point series, 0.1 to 10 uM",
            "incubation": "48 h",
            "layout": "doses randomised across the plate, outer columns filled with buffer",
            "readout": "CellTiter-Glo luminescence; n = 4 wells per dose",
        },
        "notes": [
            "Outer columns filled with buffer this time, not cells.",
            "Same MX-12 stock as run 2.",
            "Plate on the lower shelf again.",
        ],
        "expected": "If the run 2 potency was purely positional, the dose response should flatten.",
        "observed": "IC50 approx 6 uM. Effect smaller than run 2 but still present.",
        "interpretation": "Most of the original potency was plate position, but a real effect "
                          "remains.",
        "confidence": 55,
        "disconfirming": "If a fresh compound stock removes the residual effect, it was the "
                         "stock and not the compound.",
        "verdict": "unresolved",
        "resolution_note": "",
    },
]

CURRENT = {
    "title": "Run 4, fresh compound stock",
    "question": "Does the residual effect survive a fresh MX-12 stock?",
    "context": {
        "cell line": "HEK293",
        "passage": "p18",
        "plate": "96-well, clear bottom",
        "compound": "MX-12, fresh stock, lot B, 8-point series, 0.1 to 10 uM",
        "incubation": "48 h",
        "layout": "doses randomised across the plate, outer columns filled with buffer",
        "readout": "CellTiter-Glo luminescence; n = 4 wells per dose",
    },
    "notes": [
        "New MX-12 stock, prepared the same morning.",
        "Randomised layout again, same as run 3.",
        "Plate sat mid-shelf this time, not by the door.",
    ],
}


def main() -> None:
    db.init()
    project = db.row("SELECT * FROM projects ORDER BY id LIMIT 1")
    if not project:
        print("No project yet. Run seed.py first.")
        return
    pid = project["id"]

    if db.row("SELECT id FROM folders WHERE project_id = ? AND name = ?", (pid, FOLDER)):
        print(f"'{FOLDER}' already exists. Not seeding over it.")
        return

    fid = db.insert(
        "INSERT INTO folders (project_id, name, created_at) VALUES (?, ?, ?)",
        (pid, FOLDER, db.now()),
    )

    for run in RUNS:
        eid = db.insert(
            """INSERT INTO experiments
               (project_id, folder_id, title, question, context_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (pid, fid, run["title"], run["question"], json.dumps(run["context"]), run["created"]),
        )
        for n in run["notes"]:
            db.insert(
                "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
                (eid, n, "typed", run["created"]),
            )
        cid = db.insert(
            """INSERT INTO commitments
               (experiment_id, expected, observed, interpretation, confidence,
                disconfirming, proposed_next, locked_at)
               VALUES (?, ?, ?, ?, ?, ?, '', ?)""",
            (eid, run["expected"], run["observed"], run["interpretation"],
             run["confidence"], run["disconfirming"], run["created"]),
        )
        if run["verdict"]:
            db.insert(
                """INSERT INTO resolutions (commitment_id, verdict, notes, created_at)
                   VALUES (?, ?, ?, ?)""",
                (cid, run["verdict"], run["resolution_note"], run["created"]),
            )

    cur = db.insert(
        """INSERT INTO experiments
           (project_id, folder_id, title, question, context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (pid, fid, CURRENT["title"], CURRENT["question"],
         json.dumps(CURRENT["context"]), db.now()),
    )
    for n in CURRENT["notes"]:
        db.insert(
            "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
            (cur, n, "typed", db.now()),
        )

    for step in PROTOCOL_STEPS:
        db.insert(
            "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
            (cur, step, "protocol", db.now()),
        )

    print(f"Seeded folder '{FOLDER}' with {len(RUNS)} completed runs and one open run.")
    print(f"Open experiment {cur}, write your own interpretation, then challenge it.")
    print("The challenge will see all three earlier runs and should notice what recurs.")


if __name__ == "__main__":
    main()
