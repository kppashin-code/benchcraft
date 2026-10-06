import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

import base64
import json
import re
import shutil
import subprocess

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


OWNER = "kppashin-code"
IMAGES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp"}
GH = shutil.which("gh") or "/opt/homebrew/bin/gh"


def _gh(path: str):
    out = subprocess.run([GH, "api", path], capture_output=True, text=True, timeout=90)
    if out.returncode:
        raise RuntimeError(out.stderr.strip() or "gh api failed")
    return json.loads(out.stdout)


def _full(repo: str) -> str:
    return repo if "/" in repo else f"{OWNER}/{repo}"


@server.tool(annotations=OPEN, description="Your GitHub repositories, most recently updated first.")
def github_repos() -> dict:
    rows = _gh("user/repos?per_page=100&sort=updated&affiliation=owner")
    return {"repos": [{"name": r["name"], "full_name": r["full_name"], "private": r["private"], "updated": r["updated_at"][:10],
                       "description": r.get("description") or "", "branch": r["default_branch"]} for r in rows]}


@server.tool(annotations=OPEN, description="Image files (figures) in one repository, optionally under a folder.")
def github_figures(repo: str, under: str = "") -> dict:
    full = _full(repo)
    branch = _gh(f"repos/{full}")["default_branch"]
    tree = _gh(f"repos/{full}/git/trees/{branch}?recursive=1")
    under = under.strip("/")
    figs = [{"path": t["path"], "size": t.get("size", 0), "sha": t["sha"]} for t in tree.get("tree", [])
            if t["type"] == "blob" and any(t["path"].lower().endswith(x) for x in IMAGES)
            and (not under or t["path"].startswith(under + "/")) and t.get("size", 0) <= 15_000_000]
    figs.sort(key=lambda f: f["path"])
    return {"repo": full, "branch": branch, "figures": figs[:400], "truncated": len(figs) > 400}


@server.tool(annotations=OPEN, description="One figure from a repository, as base64, with a link back to it on GitHub.")
def github_figure(repo: str, path: str) -> dict:
    full = _full(repo)
    meta = _gh(f"repos/{full}/contents/{path}")
    data = meta.get("content") or _gh(f"repos/{full}/git/blobs/{meta['sha']}")["content"]
    ext = "." + path.rsplit(".", 1)[-1].lower()
    return {"repo": full, "path": path, "sha": meta["sha"], "mime": IMAGES.get(ext, "application/octet-stream"),
            "url": meta.get("html_url", ""), "base64": data.replace("\n", "")}


if __name__ == "__main__":
    server.run("stdio")
