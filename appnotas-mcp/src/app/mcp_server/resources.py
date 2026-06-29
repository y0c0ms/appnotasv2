"""MCP resources — read-only context for clients."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

_WORKFLOW = """\
AppNotas local notes (8 tools)

  Discover:  list_notes(folder?, query?) · search_notes(query)
  Read:      read_note(id)
  Write:     create_note(title, body, tags?, folder?, color?)
             update_note(id, title?, body?, tags?, color?)  -- pass whole new body
  Delete:    delete_note(id, confirm)  -- soft delete to .trash, confirm REQUIRED
  Tasks:     list_tasks(folder?) · toggle_task(task_id, checked)

Notes are Markdown files. A note id is its filename ('note-….md', or
'tasks/note-….md' for a task note). Tasks are '- [ ] item' checkbox lines inside
task notes; the app's task overlay shows tasks from the 'tasks' folder, so put
checklists there.

Rules:
  - To edit text, read_note first, change the body, then update_note with the
    whole new body. update_note preserves created/tags/color you don't pass.
  - To check/uncheck an item, use toggle_task (don't rewrite the body) so other
    task lines keep their position.
  - delete_note does nothing unless confirm=true; confirm with the user first.
    It soft-deletes (moves to .trash), it does not erase.
  - The AppNotas desktop app caches notes and has no file watcher: after a write,
    the user may need to reload the app to see the change.
"""


def register_resources(mcp: FastMCP) -> None:
    """Register all resources on the MCP server instance."""

    @mcp.resource("info://app")
    async def app_info() -> str:
        """Static description of this MCP server."""
        return "appnotas-mcp — local read/write access to AppNotas Markdown notes and tasks."

    @mcp.resource("info://notes-workflow")
    async def notes_workflow() -> str:
        """How the AppNotas tools chain together (read before calling them)."""
        return _WORKFLOW
