import json

from benchcraft import db

FOLDER = "Midbrain DA differentiation"

PROTOCOL_STEPS = [
    "d0: plate iPSC as single cells on laminin-521, dual SMAD inhibition begins",
    "d1 to d9: SHH C25II and CHIR99021, patterning to floor plate identity",
    "d11: replate onto laminin-111, switch to maturation medium",
    "d16: FGF8b withdrawal, begin BDNF and GDNF",
    "d25: first maturation checkpoint, expect TH and FOXA2 co-expression",
    "d40: second checkpoint, TH / NURR1 / MAP2 panel by wholemount IF",
]

RUNS = [
    {
        "title": "Run 1, baseline fast-relaxing gel",
        "created": "2026-06-12T09:00:00+00:00",
        "question": "Does the standard protocol give TH+ yield in the published range?",
        "context": {
            "cell line": "SFC840-03-03 (control iPSC)",
            "passage": "p26",
            "hydrogel": "alginate-RGD, 2% w/v",
            "stress relaxation": "fast (t half approx 70 s)",
            "differentiation day": "d40",
            "readout": "wholemount IF, TH / FOXA2 / MAP2; n = 3 wells",
        },
        "notes": [
            "Gel handled normally. Beads sat centred in the well.",
            "Two wells had a few dark centres at d30 but they cleared by d35.",
        ],
        "expected": "TH+ fraction around 20 percent at d40, in line with the protocol paper.",
        "observed": "TH+ 19 percent, FOXA2 co-expression high. Organoid diameter approx 480 um.",
        "interpretation": "The protocol is working as published in our hands.",
        "confidence": 80,
        "disconfirming": "If a repeat gave TH+ below 12 percent I would suspect our patterning.",
        "verdict": "held",
        "resolution_note": "Repeat at p28 gave 18 percent. Baseline is solid.",
    },
    {
        "title": "Run 2, first slow-relaxing arm",
        "created": "2026-07-03T09:00:00+00:00",
        "question": "Does slower stress relaxation change dopaminergic maturation?",
        "context": {
            "cell line": "SFC840-03-03 (control iPSC)",
            "passage": "p29",
            "hydrogel": "alginate-RGD, 2% w/v",
            "stress relaxation": "fast (t half approx 70 s) vs slow (t half approx 900 s)",
            "differentiation day": "d40",
            "readout": "wholemount IF, TH / FOXA2 / MAP2; n = 3 wells per arm",
        },
        "notes": [
            "Slow gel was harder to pipette than the fast one. Noticeably thicker.",
            "Slow arm beads sat lower in the well.",
            "Slow arm organoids looked larger by eye before fixing.",
        ],
        "expected": "Slower relaxation should improve maturation, so higher TH+.",
        "observed": "Slow arm organoids approx 40 percent larger by area. TH+ 13 percent slow "
                    "vs 19 percent fast. FOXA2 similar in both.",
        "interpretation": "Slow relaxation permits more growth, and the larger organoids develop "
                          "hypoxic cores that limit maturation.",
        "confidence": 65,
        "disconfirming": "If TH+ tracks organoid size within each arm, it is size and not stiffness.",
        "verdict": "partly",
        "resolution_note": "Size-matching removed most but not all of the difference.",
    },
    {
        "title": "Run 3, size-matched repeat",
        "created": "2026-07-29T09:00:00+00:00",
        "question": "With organoids size-matched at encapsulation, does the stiffness effect survive?",
        "context": {
            "cell line": "SFC840-03-03 (control iPSC)",
            "passage": "p31",
            "hydrogel": "alginate-RGD, 2% w/v",
            "stress relaxation": "fast (t half approx 70 s) vs slow (t half approx 900 s)",
            "differentiation day": "d40",
            "readout": "wholemount IF, TH / FOXA2 / MAP2; n = 4 wells per arm",
        },
        "notes": [
            "Sorted organoids to 300 to 350 um before encapsulation.",
            "Slow gel thick again. Same batch of alginate as run 2.",
            "Slow arm beads sat low in the well again.",
        ],
        "expected": "If it was purely size, TH+ should now match between arms.",
        "observed": "TH+ 16 percent slow vs 19 percent fast. Gap narrowed but did not close. "
                    "Diameters matched within 8 percent at d40.",
        "interpretation": "Most of the original effect was size, but a small stiffness effect "
                          "remains.",
        "confidence": 55,
        "disconfirming": "If a fresh alginate lot removes the residual gap, it was the material "
                         "and not the mechanics.",
        "verdict": "unresolved",
        "resolution_note": "",
    },
]

CURRENT = {
    "title": "Run 4, new alginate lot",
    "question": "Does the residual gap survive a fresh alginate lot?",
    "context": {
        "cell line": "SFC840-03-03 (control iPSC)",
        "passage": "p33",
        "hydrogel": "alginate-RGD, 2% w/v, lot B",
        "stress relaxation": "fast (t half approx 70 s) vs slow (t half approx 900 s)",
        "differentiation day": "d40",
        "readout": "wholemount IF, TH / FOXA2 / MAP2; n = 4 wells per arm",
    },
    "notes": [
        "New alginate lot. Slow gel felt thinner than the last two runs, easier to pipette.",
        "Beads sat centred this time, in both arms.",
        "Line looked slightly unhealthy the morning of encapsulation.",
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
