import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from benchcraft import zotero

READ = ToolAnnotations(readOnlyHint=True)

server = MCPServer("benchcraft-zotero", instructions="Read-only access to the Zotero library on this Mac.")


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


if __name__ == "__main__":
    server.run("stdio")
