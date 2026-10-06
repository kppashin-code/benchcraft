import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

import re

from benchcraft import literature, zotero

READ = ToolAnnotations(readOnlyHint=True)
OPEN = ToolAnnotations(readOnlyHint=True, openWorldHint=True)

server = MCPServer("benchcraft-local", instructions="Zotero on this Mac, read only, and literature search run from this Mac.")


@server.tool(annotations=READ, description="Whether the Zotero library was found, and how many items it holds.")
def zotero_status() -> dict:
    return zotero.status()


@server.tool(annotations=READ, description="The collections in the library, with item counts.")
def zotero_collections() -> dict:
    return {"collections": zotero.collections()}


@server.tool(annotations=READ, description="Items in the library, optionally one collection, optionally only tagged or annotated ones.")
def zotero_items(collection: str = "", engaged_only: bool = False) -> dict:
    return {"items": zotero.items(collection_key=collection or None, engaged_only=engaged_only)}


@server.tool(annotations=READ, description="One item by its Zotero key, with notes, tags and annotations.")
def zotero_item(key: str) -> dict:
    return zotero.item(key) or {}


@server.tool(annotations=READ, description="The readable text of one item, from its PDF where there is one, else its abstract.")
def zotero_text(key: str) -> dict:
    text, source = zotero.source_text(key)
    return {"text": text, "source": source}


def _library() -> list[dict]:
    try:
        return zotero.items() if zotero.status()["ready"] else []
    except zotero.Unavailable:
        return []


def _matches(query: str, items: list[dict], limit: int = 8) -> list[dict]:
    words = [w.lower() for w in re.findall(r"[A-Za-z0-9-]{3,}", query) if w.upper() not in {"AND", "OR", "NOT"}]
    if not words:
        return []
    scored = []
    for it in items:
        hay = " ".join([it.get("title", ""), it.get("abstract", ""), " ".join(it.get("tags", []))]).lower()
        n = sum(w in hay for w in words)
        if n:
            scored.append((n, it))
    scored.sort(key=lambda x: -x[0])
    return [it for _, it in scored[:limit]]


@server.tool(annotations=OPEN, description="Search Europe PMC from this Mac, marking results already in the Zotero library and listing library items that match.")
def literature_search(query: str, include_preprints: bool = False, reviews_only: bool = False) -> dict:
    out = literature.search(query, include_preprints=include_preprints, reviews_only=reviews_only)
    lib = _library()
    have = {i["doi"].lower() for i in lib if i.get("doi")}
    for r in out["results"]:
        r["in_my_library"] = bool(r["doi"]) and r["doi"].lower() in have
    out["library_matches"] = _matches(query, lib)
    return out


if __name__ == "__main__":
    server.run("stdio")
