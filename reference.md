# reference

mechanical notes for running benchcraft. not authored prose.

## environment variables

| variable | default | purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | needed for challenge, glossary, brief |
| `BENCHCRAFT_MODEL` | `claude-opus-5` | model used for all three |
| `BENCHCRAFT_WHISPER` | `mlx-community/whisper-large-v3-turbo` | local transcription model |
| `BENCHCRAFT_PROXY` | unset | connector calls go direct unless this is set |

## files

| path | holds |
|---|---|
| `benchcraft/db.py` | sqlite store, one file, plus the schema |
| `benchcraft/llm.py` | prompts and output schemas |
| `benchcraft/transcribe.py` | local whisper, audio stays on the machine |
| `benchcraft/connectors.py` | tools you register yourself |
| `benchcraft/app.py` | http api |
| `benchcraft/static/` | frontend, no build step |
| `seed.py` | worked case and starter glossary |
| `benchcraft.db` | your record, gitignored |
| `audio/` | uploaded voice memos, gitignored |

## api routes

| route | does |
|---|---|
| `POST /api/projects/{id}/experiments` | create an experiment |
| `POST /api/experiments/{id}/notes` | add a bench note |
| `POST /api/experiments/{id}/commitments` | lock a view, no edit path after this |
| `POST /api/commitments/{id}/challenge` | blind pass, then divergence |
| `POST /api/challenges/{id}/response` | record hold, revise or abandon |
| `POST /api/commitments/{id}/resolution` | outcome, feeds calibration |
| `POST /api/experiments/{id}/recordings` | upload audio |
| `POST /api/recordings/{id}/transcribe` | local verbatim transcript |
| `PUT /api/recordings/{id}/transcript` | correct a transcript by hand |
| `GET /api/recordings/{id}/audio` | play the file back |
| `GET /api/projects/{id}/glossary` | list glossary entries |
| `POST /api/projects/{id}/glossary/detect` | find terms and define them plainly |
| `GET /api/projects/{id}/glossary/matches/{exp}` | entries matching one experiment |
| `GET /api/projects/{id}/connectors` | list registered tools |
| `POST /api/connectors/{id}/call` | ask a tool you registered |
| `GET /api/projects/{id}/calibration` | brier score, confidence buckets, stance counts |
| `GET /api/projects/{id}/graph` | decision graph nodes and edges |
| `GET /api/projects/{id}/brief` | supervisor brief |

## calibration

`resolution` verdicts score as held 1.0, partly 0.5, overturned 0.0. brier score is the mean squared difference between stated confidence and outcome, so 0 is perfect and 0.25 is a coin flip. computed from stored rows only, never asked of a model.

## dependencies

`requirements.txt` is the base install. `requirements-voice.txt` adds mlx-whisper for local transcription, which also needs `ffmpeg` on the path.
