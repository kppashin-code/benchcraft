import os
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

LIBRARY = Path(os.environ.get("BENCHCRAFT_ZOTERO", Path.home() / "Zotero"))

FIELDS = ("title", "abstractNote", "date", "DOI", "url", "publicationTitle", "PMID")


GLYPHS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "period": ".", "comma": ",", "hyphen": "-", "slash": "/", "percent": "%",
}


class Unavailable(RuntimeError):
    pass


def _clean(text: str) -> str:
    def sub(m):
        return GLYPHS.get(m.group(1), m.group(0))

    text = re.sub(r"/([a-z]+)\.(?:tnum|lf|pnum|tosf|osf)\b", sub, text)
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    return re.sub(r"[ \t]{2,}", " ", text)


def db_path() -> Path:
    return LIBRARY / "zotero.sqlite"


def status() -> dict:
    p = db_path()
    if not p.exists():
        return {"ready": False, "library": str(LIBRARY),
                "detail": f"No zotero.sqlite under {LIBRARY}. Set BENCHCRAFT_ZOTERO."}
    try:
        with _open() as c:
            n = c.execute(
                """SELECT COUNT(*) FROM items i JOIN itemTypes it
                   ON it.itemTypeID = i.itemTypeID AND it.typeName != 'attachment'
                   WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)"""
            ).fetchone()[0]
        return {"ready": True, "library": str(LIBRARY), "items": n, "detail": ""}
    except Exception as e:
        return {"ready": False, "library": str(LIBRARY), "detail": str(e)}


def _open() -> sqlite3.Connection:
    src = db_path()
    if not src.exists():
        raise Unavailable(f"No Zotero library at {src}")
    tmp = Path(tempfile.gettempdir()) / "benchcraft-zotero.sqlite"
    if not tmp.exists() or tmp.stat().st_mtime < src.stat().st_mtime:
        shutil.copy2(src, tmp)
    c = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def collections() -> list[dict]:
    with _open() as c:
        return [
            {"key": r["key"], "name": r["collectionName"], "n": r["n"]}
            for r in c.execute(
                """SELECT co.key, co.collectionName, COUNT(ci.itemID) AS n
                   FROM collections co
                   LEFT JOIN collectionItems ci ON ci.collectionID = co.collectionID
                   GROUP BY co.collectionID ORDER BY co.collectionName"""
            )
        ]


def _creators(c: sqlite3.Connection, item_id: int) -> list[str]:
    return [
        (r["lastName"] or r["firstName"] or "").strip()
        for r in c.execute(
            """SELECT cr.firstName, cr.lastName FROM itemCreators ic
               JOIN creators cr ON cr.creatorID = ic.creatorID
               WHERE ic.itemID = ? ORDER BY ic.orderIndex""",
            (item_id,),
        )
    ]


def _tags(c: sqlite3.Connection, item_id: int) -> list[str]:
    return [
        r["name"]
        for r in c.execute(
            "SELECT t.name FROM itemTags it JOIN tags t ON t.tagID = it.tagID WHERE it.itemID = ?",
            (item_id,),
        )
    ]


def _notes(c: sqlite3.Connection, item_id: int) -> list[str]:
    try:
        return [
            r["note"]
            for r in c.execute("SELECT note FROM itemNotes WHERE parentItemID = ?", (item_id,))
            if r["note"]
        ]
    except sqlite3.OperationalError:
        return []


def _annotations(c: sqlite3.Connection, item_id: int) -> list[dict]:
    try:
        return [
            {"text": r["text"] or "", "comment": r["comment"] or "", "page": r["pageLabel"] or ""}
            for r in c.execute(
                """SELECT a.text, a.comment, a.pageLabel FROM itemAnnotations a
                   JOIN itemAttachments ia ON ia.itemID = a.parentItemID
                   WHERE ia.parentItemID = ?""",
                (item_id,),
            )
        ]
    except sqlite3.OperationalError:
        return []


def pdf_path(c: sqlite3.Connection, item_id: int) -> Path | None:
    for r in c.execute(
        """SELECT i.key, ia.path FROM itemAttachments ia
           JOIN items i ON i.itemID = ia.itemID
           WHERE ia.parentItemID = ? AND ia.contentType = 'application/pdf'""",
        (item_id,),
    ):
        path = r["path"] or ""
        if path.startswith("storage:"):
            p = LIBRARY / "storage" / r["key"] / path[len("storage:"):]
            if p.exists():
                return p
        elif path and Path(path).exists():
            return Path(path)
    return None


def items(collection_key: str | None = None, engaged_only: bool = False) -> list[dict]:
    with _open() as c:
        sql = """
            SELECT i.itemID, i.key, it.typeName
            FROM items i
            JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
            WHERE it.typeName NOT IN ('attachment', 'note')
              AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
        """
        args: tuple = ()
        if collection_key:
            sql += """ AND i.itemID IN (
                SELECT ci.itemID FROM collectionItems ci
                JOIN collections co ON co.collectionID = ci.collectionID
                WHERE co.key = ?)"""
            args = (collection_key,)

        out = []
        for r in c.execute(sql, args):
            data = {
                f["fieldName"]: f["value"]
                for f in c.execute(
                    """SELECT fl.fieldName, idv.value FROM itemData id
                       JOIN fields fl ON fl.fieldID = id.fieldID
                       JOIN itemDataValues idv ON idv.valueID = id.valueID
                       WHERE id.itemID = ?""",
                    (r["itemID"],),
                )
                if f["fieldName"] in FIELDS
            }
            if not data.get("title"):
                continue
            tags = _tags(c, r["itemID"])
            notes = _notes(c, r["itemID"])
            anns = _annotations(c, r["itemID"])
            engaged = bool(tags or notes or anns)
            if engaged_only and not engaged:
                continue
            creators = _creators(c, r["itemID"])
            out.append(
                {
                    "key": r["key"],
                    "type": r["typeName"],
                    "title": data.get("title", ""),
                    "abstract": data.get("abstractNote", ""),
                    "date": (data.get("date") or "")[:4],
                    "doi": data.get("DOI", ""),
                    "url": data.get("url", ""),
                    "journal": data.get("publicationTitle", ""),
                    "pmid": data.get("PMID", ""),
                    "authors": creators[:3],
                    "more_authors": max(0, len(creators) - 3),
                    "tags": tags,
                    "notes": notes,
                    "annotations": anns,
                    "engaged": engaged,
                    "has_pdf": pdf_path(c, r["itemID"]) is not None,
                }
            )
        out.sort(key=lambda x: (not x["engaged"], x["title"].lower()))
        return out


def item(key: str) -> dict | None:
    for it in items():
        if it["key"] == key:
            return it
    return None


def source_text(key: str, max_chars: int = 60000) -> tuple[str, str]:
    with _open() as c:
        row = c.execute("SELECT itemID FROM items WHERE key = ?", (key,)).fetchone()
        if not row:
            raise Unavailable("No such item in your Zotero library.")
        p = pdf_path(c, row["itemID"])

    if p:
        try:
            from pypdf import PdfReader

            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages)
            text = _clean(text).strip()
            if len(text) > 400:
                return text[:max_chars], f"full text, {p.name}"
        except ImportError:
            pass
        except Exception:
            pass

    it = item(key)
    if it and it["abstract"]:
        return it["abstract"], "abstract only"
    raise Unavailable(
        "No readable text for this item. Install pypdf for full-text, or add an abstract in Zotero."
    )
