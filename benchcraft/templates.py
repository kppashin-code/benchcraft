TEMPLATES = [
    {
        "id": "blank",
        "name": "Blank",
        "who": "Start with nothing and add what you need.",
        "mode": "notebook",
        "context": {},
        "protocol": [],
        "glossary": [],
    },
    {
        "id": "wet-culture",
        "name": "Cell or organoid culture",
        "who": "Differentiations, passaging, encapsulation, anything with a line and a timepoint.",
        "mode": "notebook",
        "context": {
            "cell line": "",
            "passage": "",
            "differentiation day": "",
            "medium": "",
            "reagent lot": "",
            "readout": "",
        },
        "protocol": [],
        "glossary": [
            ["passage", "The number of times a culture has been detached and reseeded into new vessels."],
            ["confluency", "The proportion of the growth surface covered by cells."],
        ],
    },
    {
        "id": "wet-assay",
        "name": "Bench assay",
        "who": "Westerns, qPCR, ELISA, staining. Anything with plates, replicates and a standard.",
        "mode": "notebook",
        "context": {
            "sample": "",
            "antibody or primer": "",
            "dilution": "",
            "replicates": "",
            "control": "",
            "instrument": "",
        },
        "protocol": [],
        "glossary": [
            ["technical replicate", "Repeated measurement of the same sample."],
            ["biological replicate", "Measurement of a separately prepared sample."],
        ],
    },
    {
        "id": "wet-material",
        "name": "Materials and rheology",
        "who": "Hydrogels, scaffolds, mechanical characterisation.",
        "mode": "notebook",
        "context": {
            "material": "",
            "formulation": "",
            "crosslinker": "",
            "stress relaxation": "",
            "storage modulus": "",
            "instrument": "",
        },
        "protocol": [],
        "glossary": [
            ["stress relaxation", "How quickly a material's resisting force decays when it is held at a fixed deformation."],
            ["storage modulus", "The elastic component of a viscoelastic material's response to deformation."],
        ],
    },
    {
        "id": "comp-seq",
        "name": "Sequencing analysis",
        "who": "scRNA-seq, bulk RNA-seq, anything where the run must be reproducible.",
        "mode": "notebook",
        "context": {
            "dataset": "",
            "reference genome": "",
            "pipeline and version": "",
            "parameters changed": "",
            "random seed": "",
            "compute": "",
        },
        "protocol": [],
        "glossary": [
            ["random seed", "The number that fixes a pseudo-random sequence so a run can be repeated exactly."],
            ["reference genome", "The assembly and annotation build that reads were aligned to."],
        ],
    },
    {
        "id": "comp-model",
        "name": "Model or method run",
        "who": "Training, benchmarking, parameter sweeps.",
        "mode": "notebook",
        "context": {
            "model or method": "",
            "version or commit": "",
            "input data": "",
            "hyperparameters": "",
            "random seed": "",
            "hardware": "",
        },
        "protocol": [],
        "glossary": [],
    },
]


def by_id(tid: str) -> dict | None:
    for t in TEMPLATES:
        if t["id"] == tid:
            return t
    return None
