import csv
import io
import json
import statistics
from pathlib import Path

ALLOWED = {
    ".csv": "table", ".tsv": "table", ".txt": "table",
    ".xlsx": "spreadsheet", ".xls": "spreadsheet",
    ".json": "table",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".tif": "image", ".tiff": "image",
    ".pdf": "document",
}

MAX_BYTES = 60 * 1024 * 1024
PREVIEW_ROWS = 200


class DataError(ValueError):
    pass


def check(filename: str, size: int) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise DataError(
            f"'{suffix or 'that'}' is not a type Benchcraft stores. "
            f"Allowed: {', '.join(sorted(ALLOWED))}"
        )
    if size > MAX_BYTES:
        raise DataError(f"That file is {size / 1e6:.0f} MB. The limit is {MAX_BYTES // 1024 // 1024} MB.")
    return ALLOWED[suffix]


def _sniff(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;|").delimiter
    except csv.Error:
        return "\t" if sample.count("\t") > sample.count(",") else ","


def profile(path: Path) -> dict:
    suffix = path.suffix.lower()
    if ALLOWED.get(suffix) != "table" or suffix == ".json":
        return {"n_rows": None, "n_cols": None, "columns": []}
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {"n_rows": None, "n_cols": None, "columns": []}
    if not raw.strip():
        return {"n_rows": 0, "n_cols": 0, "columns": []}

    delim = _sniff(raw[:4000])
    reader = csv.reader(io.StringIO(raw), delimiter=delim)
    rows = list(reader)
    if not rows:
        return {"n_rows": 0, "n_cols": 0, "columns": []}

    header = rows[0]
    body = rows[1:]
    looks_numeric = all(_is_number(c) for c in header if c.strip())
    if looks_numeric:
        header = [f"col{i + 1}" for i in range(len(rows[0]))]
        body = rows

    cols = []
    for i, name in enumerate(header):
        values = [r[i] for r in body if i < len(r) and r[i].strip() != ""]
        nums = [float(v) for v in values if _is_number(v)]
        col = {"name": name.strip() or f"col{i + 1}", "n": len(values),
               "numeric": len(nums) > 0 and len(nums) >= 0.8 * max(1, len(values))}
        if col["numeric"] and nums:
            col["min"] = round(min(nums), 6)
            col["max"] = round(max(nums), 6)
            col["mean"] = round(statistics.fmean(nums), 6)
            if len(nums) > 1:
                col["sd"] = round(statistics.stdev(nums), 6)
        else:
            uniq = sorted({v for v in values})[:8]
            col["examples"] = uniq
        cols.append(col)

    return {"n_rows": len(body), "n_cols": len(header), "columns": cols}


def _is_number(v: str) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def preview(path: Path, limit: int = 25) -> dict:
    if ALLOWED.get(path.suffix.lower()) != "table" or path.suffix.lower() == ".json":
        return {"header": [], "rows": []}
    raw = path.read_text(encoding="utf-8", errors="replace")
    delim = _sniff(raw[:4000])
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if not rows:
        return {"header": [], "rows": []}
    return {"header": rows[0], "rows": rows[1:limit + 1]}


def columns_of(dataset: dict) -> list[dict]:
    try:
        return json.loads(dataset.get("columns_json") or "[]")
    except json.JSONDecodeError:
        return []
