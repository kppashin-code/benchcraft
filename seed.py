import json

from benchcraft import db


def main() -> None:
    db.init()
    if db.rows("SELECT id FROM projects LIMIT 1"):
        print("Database already has a project, not seeding over it.")
        return

    pid = db.insert(
        "INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)",
        (
            "Stress relaxation and midbrain organoid maturation",
            "Does hydrogel stress-relaxation rate change dopaminergic maturation in "
            "iPSC-derived midbrain organoids, independently of organoid size?",
            db.now(),
        ),
    )

    eid = db.insert(
        """INSERT INTO experiments
           (project_id, parent_experiment_id, title, question, context_json, created_at)
           VALUES (?, NULL, ?, ?, ?, ?)""",
        (
            pid,
            "Fast vs slow-relaxing gel, day 40 maturation panel",
            "Does a slower-relaxing matrix change dopaminergic maturation, or only change "
            "how big the organoids get?",
            json.dumps({
                "cell line": "SFC840-03-03 (control iPSC)",
                "passage": "p31",
                "hydrogel": "alginate-RGD, 2% w/v",
                "stress relaxation": "fast (t½ ≈ 70 s) vs slow (t½ ≈ 900 s)",
                "differentiation day": "d40",
                "encapsulation density": "1 organoid per 20 µL bead",
                "readout": "wholemount IF, TH / MAP2 / NURR1; n = 3 wells per arm",
            }),
            db.now(),
        ),
    )

    for note in [
        "The slow-relaxing gel felt noticeably more viscous than the last batch, harder to "
        "pipette, and organoids were harder to centre in the bead.",
        "Line looked slightly unhealthy the morning of encapsulation; a few dark centres in "
        "the fast-relaxing arm before it went in.",
        "Slow arm beads sat lower in the well. Possible they were closer to the plastic and "
        "got less medium exchange.",
    ]:
        db.insert(
            "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
            (eid, note, "typed", db.now()),
        )

    for term, plain in [
        ("TH", "Tyrosine hydroxylase; the enzyme catalysing the rate-limiting step in dopamine synthesis."),
        ("NURR1", "A nuclear receptor transcription factor, NR4A2, expressed in midbrain dopaminergic neurons."),
        ("MAP2", "Microtubule-associated protein 2; a cytoskeletal protein found in neuronal dendrites."),
        ("stress relaxation", "How quickly a material's resisting force decays when it is held at a fixed deformation."),
        ("passage", "The number of times a cell culture has been detached and reseeded into new vessels."),
    ]:
        db.insert(
            """INSERT INTO glossary (project_id, term, plain, source, created_at)
               VALUES (?, ?, ?, 'curated', ?)""",
            (pid, term, plain, db.now()),
        )

    print(f"Seeded project {pid}, experiment {eid}.")
    print("Start with ./run.sh and write your own interpretation first.")


if __name__ == "__main__":
    main()
