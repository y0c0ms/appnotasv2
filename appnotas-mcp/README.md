# appnotas-mcp

Local read/write access to your **AppNotas** notes and tasks, over MCP. Fully
local — it reads and writes the Markdown files AppNotas stores on disk; there is
no network, no database, and no app API involved.

Scaffolded by **mcp-factory**, so it inherits the hardened template (auth,
limits, reverse-proxy support, CI, Docker, stdio + HTTP). Designed for **stdio**
use from Claude Desktop / Zed / pi.

## How it reads your notes

AppNotas keeps each note as a UTF-8 Markdown file with a small frontmatter block
(`title`, `created`, `modified`, `tags`, optional `color`) plus a body. Notes
live flat in the notes directory; "task" notes live in a flat `tasks/`
subfolder, and tasks are `- [ ] item` checkbox lines inside those files.

The notes directory is **auto-discovered** from the AppNotas settings file
(`%APPDATA%/com.appnotas.desktop/appnotas-settings.json` → `notesDirectory`), or
set `NOTES_DIR` to override (point it at a throwaway folder while developing).

## Tools

| Tool | Purpose |
| --- | --- |
| `list_notes(folder?, query?)` | List notes (newest first), optionally filtered. |
| `search_notes(query, folder?)` | Find notes by text in title/body. |
| `read_note(id)` | Full note content. |
| `create_note(title, body?, tags?, folder?, color?)` | Create a note (checklists → `folder="tasks"`). |
| `update_note(id, …)` | Edit; **preserves** created/tags/color you don't pass. |
| `delete_note(id, confirm)` | **Soft** delete to `.trash`; requires `confirm=true`. |
| `list_tasks(folder?)` | Checkbox tasks (the `tasks` folder is what the app overlay shows). |
| `toggle_task(task_id, checked)` | Check/uncheck one item without disturbing the rest. |

A note id is its filename (`note-….md`, or `tasks/note-….md` for a task note).
A task id is `<note id>:<line>`.

## Safety / guardrails

- **Path-confined:** ids must be a `*.md` filename, optionally under `tasks/`;
  separators / `..` / anything escaping the notes dir is rejected before any I/O.
- **Non-destructive edits:** `update_note` does a read-modify-write that keeps
  `created`/`tags`/`color` (AppNotas' own save would clobber them).
- **Soft delete only:** `delete_note` moves the file to `.trash` (the app ignores
  dot-folders) and refuses unless `confirm=true`. Nothing is erased.
- **Atomic writes + retry** (the notes dir is usually OneDrive-synced and can
  briefly lock files); BOM-tolerant parsing.
- **No content in logs** — only tool name, request id, duration.

## Run / test

```bash
uv sync
cp .env.example .env            # set NOTES_DIR to a sandbox while testing
uv run python -m app            # MCP at http://localhost:8000/mcp
uv run serve-stdio              # stdio (Claude Desktop / Zed / pi)
uv run pytest                   # tests run on throwaway temp dirs, never real notes
```

## Caveat: the app's in-memory cache

AppNotas loads notes into memory and has **no file watcher**, so changes this
MCP makes won't appear until you reload the app, and if you edit a note in the
app after an MCP write, the app's save will overwrite the MCP change
(last-writer-wins). Write when the app isn't actively editing the same note, or
reload after. (Adding a file watcher to AppNotas would remove this caveat.)
