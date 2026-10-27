---
name: install-benchcraft
description: Install or update Benchcraft, a lab notebook, as a private claude.ai artifact on the user's own account, and optionally set up its local helper for Zotero, literature search and GitHub figures. Use when the user asks to install, set up, update or try Benchcraft.
---

# Install Benchcraft

Benchcraft runs as an artifact on the person's own Claude account. Their notebook lives in their own private storage, model calls use their own plan, and connectors (Google Drive, Calendar, Gmail) are their own.

## 1. Get the source

Clone or update `https://github.com/kppashin-code/benchcraft` into `~/benchcraft`. Only the `artifact/` folder is published.

## 2. Publish the artifact

Publish `artifact/index.html` with the Artifact tool, with `root` set to the `artifact/` folder and these files:
`ui.js`, `todo.js`, `today.js`, `lab.js`, `freezer.js`, `slides.js`, `logo-mark.png`, and every file in `lib/` (including `lib/example.json`).

Use `icon: "notebook"` and these capabilities:

```json
{"sample": {}, "db": {}, "user": {}, "assets": {}, "downloads": true,
 "mcp": {"servers": [
   {"server": "host:benchcraft-local", "tools": ["zotero_status", "zotero_collections", "zotero_items", "zotero_item", "zotero_text", "literature_search", "github_repos", "github_figures", "github_figure"]},
   {"server": "Google Drive", "tools": ["search_files", "download_file_content", "create_file", "update_file"]},
   {"server": "Google Calendar", "tools": ["list_events", "create_event"]},
   {"server": "Gmail", "tools": ["create_draft"]}]}}
```

If a connector is not on the person's account, drop that server from the list rather than failing; the page works without it. If they installed before, publish to the same artifact URL so their notebook is kept.

## 3. The local helper (optional, Claude desktop app only)

Only if they want Zotero, literature search or figures from GitHub:

1. Create `~/benchcraft/.venv` and install `requirements-zotero.txt` into it.
2. Add `benchcraft-local` to the Claude desktop app's `claude_desktop_config.json` under `mcpServers`, running `~/benchcraft/.venv/bin/python ~/benchcraft/benchcraft/local_mcp.py`. Back the file up first and keep every existing key.
3. GitHub figures use the `gh` command line, so they need `gh auth login` once.
4. Tell them to quit and reopen the desktop app.

## 4. Hand over

Give them the artifact link. Tell them that the first open asks a few questions and offers an example project, that Google Drive, Calendar and Gmail each connect under claude.ai Settings, Connectors, and that the helper only answers when Benchcraft is opened in the desktop app.
