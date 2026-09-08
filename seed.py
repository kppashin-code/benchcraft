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
            "Plate position and compound response in a viability assay",
            "Does compound MX-12 reduce viability in HEK293 cells, or does the apparent "
            "dose response track where the wells sit on the plate?",
            db.now(),
        ),
    )

    eid = db.insert(
        """INSERT INTO experiments
           (project_id, parent_experiment_id, title, question, context_json, created_at)
           VALUES (?, NULL, ?, ?, ?, ?)""",
        (
            pid,
            "MX-12 dose response, first pass",
            "Does MX-12 reduce viability at 10 uM, or is the apparent effect positional?",
            json.dumps({
                "cell line": "HEK293",
                "passage": "p14",
                "plate": "96-well, clear bottom",
                "compound": "MX-12, 8-point series, 0.1 to 10 uM",
                "incubation": "48 h",
                "layout": "doses in columns, vehicle control in column 1",
                "readout": "CellTiter-Glo luminescence; n = 3 wells per dose",
            }),
            db.now(),
        ),
    )

    for note in [
        "Outer wells looked to have less medium at 48 h, a visible meniscus difference "
        "against the inner columns.",
        "Plate sat closest to the incubator door and the door was opened several times "
        "during the run.",
        "Column 12 read brighter across every dose, including the vehicle wells.",
    ]:
        db.insert(
            "INSERT INTO notes (experiment_id, body, source, created_at) VALUES (?, ?, ?, ?)",
            (eid, note, "typed", db.now()),
        )

    for term, plain in [
        ("CellTiter-Glo", "A luminescent assay that estimates viable cell number from ATP content."),
        ("edge effect", "Systematic differences in the outer wells of a microplate, usually caused by uneven evaporation."),
        ("vehicle control", "Wells given the solvent alone, with no compound, used as the comparison baseline."),
        ("IC50", "The concentration at which a response falls to half of its maximum."),
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
