"""MCP tool adapters for AppNotas (local Markdown notes + tasks).

Thin async adapters over ``NotesStore``. First docstring line is a routing
sentence; params carry schema-level descriptions; every call is wrapped in
``_observe`` (logs tool/request-id/duration, never note contents).

This server reads and writes real local files. Deletes are soft (moved to
.trash) and require confirm=true. Updates preserve created/tags/color.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import structlog
from mcp.server.fastmcp import FastMCP, Image
from pydantic import Field

from app.config import get_settings
from app.services.images import inline_remote_images
from app.services.notes import DeleteResult, Note, NotesStore, NoteSummary, Task, resolve_notes_dir
from app.services.render import render_note_pdf, render_note_png

logger = structlog.get_logger(__name__)


@contextmanager
def _observe(tool: str) -> Iterator[structlog.BoundLogger]:
    request_id = uuid.uuid4().hex[:8]
    bound = logger.bind(tool=tool, request_id=request_id)
    start = time.perf_counter()
    bound.debug("tool.start")
    try:
        yield bound
    except Exception:
        bound.error("tool.error", duration_ms=round((time.perf_counter() - start) * 1000, 1))
        raise
    else:
        bound.info("tool.done", duration_ms=round((time.perf_counter() - start) * 1000, 1))


@lru_cache
def _store() -> NotesStore:
    return NotesStore.from_settings(get_settings())


_IdParam = Annotated[
    str,
    Field(
        description="Note id = its filename, e.g. 'note-….md', or 'tasks/note-….md' "
        "for a task note. Use the id returned by list_notes / search_notes.",
        examples=["note-20260101-090000-welcome.md", "tasks/note-20260104-080000-sprint.md"],
        max_length=200,
    ),
]
_FolderParam = Annotated[
    str,
    Field(description="'notes' (root), 'tasks' (the tasks subfolder), or 'all'.", examples=["all"]),
]


async def list_notes(
    folder: _FolderParam = "all",
    query: Annotated[
        str,
        Field(description="Optional case-insensitive text filter on title/body.", max_length=200),
    ] = "",
) -> list[NoteSummary]:
    """List notes (newest first) — call this to discover notes before reading or \
editing. Optionally filter by folder or a text query.

    Result: [{id, title, folder, modified, tags, snippet}].
    """
    with _observe("list_notes"):
        return _store().list_notes(folder, query)


async def search_notes(
    query: Annotated[str, Field(description="Text to find in note titles/bodies.", max_length=200)],
    folder: _FolderParam = "all",
) -> list[NoteSummary]:
    """Search notes by text in title or body — use this to find notes when you \
don't know the id.

    Result: matching note summaries, newest first.
    """
    with _observe("search_notes"):
        return _store().list_notes(folder, query)


async def read_note(note_id: _IdParam) -> Note:
    """Read one note's full content — call this before editing so you can preserve \
the existing body/tags.

    Result: {id, title, folder, created, modified, tags, color, body}.
    """
    with _observe("read_note"):
        return _store().read_note(note_id)


async def create_note(
    title: Annotated[
        str, Field(description="Note title (used to generate the filename).", max_length=200)
    ],
    body: Annotated[
        str,
        Field(
            description="Markdown body. For a task list, use '- [ ] item' lines. "
            "To include a web image, reference it by URL — Markdown ![alt](https://…) "
            "or an <img src=\"https://…\"> tag — and the server downloads it and embeds "
            "it as base64 automatically. Never paste raw base64 yourself."
        ),
    ] = "",
    tags: Annotated[list[str] | None, Field(description="Optional tags.")] = None,
    folder: Annotated[
        str, Field(description="'notes' (root) or 'tasks'. Put checklists in 'tasks'.")
    ] = "notes",
    color: Annotated[
        str, Field(description="Optional color (e.g. '#4a9eff').", max_length=32)
    ] = "",
) -> Note:
    """Create a new note — for a checklist the user wants in the task overlay, set \
folder='tasks' and put '- [ ] item' lines in the body.

    Result: the created note (with its generated id).
    """
    with _observe("create_note") as log:
        body = await inline_remote_images(body) or ""
        note = _store().create_note(title, body, tags, folder, color)
        log.info("note.created", note_id=note.id)
        return note


async def update_note(
    note_id: _IdParam,
    title: Annotated[str | None, Field(description="New title, or omit to keep.")] = None,
    body: Annotated[
        str | None,
        Field(
            description="New full body, or omit to keep. Web images referenced by URL "
            "(Markdown ![alt](https://…) or <img src=\"https://…\">) are downloaded and "
            "embedded as base64 automatically; never paste raw base64 yourself."
        ),
    ] = None,
    tags: Annotated[list[str] | None, Field(description="New tags, or omit to keep.")] = None,
    color: Annotated[
        str | None, Field(description="New color, or omit to keep.", max_length=32)
    ] = None,
) -> Note:
    """Update a note, preserving everything you don't pass — only the given fields \
change; created/tags/color/body are kept otherwise, and modified is bumped.

    Pass the whole new body when editing text (there is no partial-line edit;
    use toggle_task to flip a checkbox). Result: the updated note.
    """
    with _observe("update_note") as log:
        body = await inline_remote_images(body)
        note = _store().update_note(note_id, title, body, tags, color)
        log.info("note.updated", note_id=note.id)
        return note


async def delete_note(
    note_id: _IdParam,
    confirm: Annotated[
        bool, Field(description="Must be true to actually delete (soft-delete to .trash).")
    ] = False,
) -> DeleteResult:
    """Delete a note (SOFT delete) — moves it to .trash; requires confirm=true. \
Always confirm with the user first, then call with confirm=true.

    Result: {id, deleted, trashed_to, note}. With confirm=false it does nothing
    and tells you to confirm.
    """
    with _observe("delete_note") as log:
        result = _store().delete_note(note_id, confirm)
        log.info("note.delete", note_id=note_id, deleted=result.deleted)
        return result


async def list_tasks(
    folder: Annotated[
        str, Field(description="'tasks' (default; what the app overlay shows), 'notes', or 'all'.")
    ] = "tasks",
) -> list[Task]:
    """List checkbox tasks across notes — use this to see open/done items. Tasks in \
the 'tasks' folder are the ones AppNotas shows in its overlay.

    Result: [{task_id, note_id, note_title, line, text, checked}].
    """
    with _observe("list_tasks"):
        return _store().list_tasks(folder)


async def toggle_task(
    task_id: Annotated[
        str,
        Field(
            description="The task_id from list_tasks ('<note id>:<line>').",
            examples=["tasks/note-20260104-080000-sprint.md:1"],
            max_length=240,
        ),
    ],
    checked: Annotated[bool, Field(description="True to check (done), false to uncheck.")],
) -> Task:
    """Check or uncheck a task — flips the checkbox on that exact line without \
disturbing the rest of the note.

    Result: the updated task.
    """
    with _observe("toggle_task") as log:
        task = _store().toggle_task(task_id, checked)
        log.info("task.toggled", task_id=task_id, checked=checked)
        return task


async def render_note(
    note_id: _IdParam,
    width: Annotated[
        int,
        Field(description="Render width in px (the editor reading column). Default 860.", ge=320, le=2000),
    ] = 860,
) -> Image:
    """Render a note to a PNG image so you can VISUALLY review it — call this after \
creating or editing a note to confirm images resolved, tables aligned, code blocks \
and checklists came out right (what a human sees in the app).

    Result: a PNG of the note rendered with the app's dark theme.
    """
    with _observe("render_note"):
        note = _store().read_note(note_id)
        png = await render_note_png(note.title, note.body, note.tags, width=width)
        return Image(data=png, format="png")


async def export_note_pdf(
    note_id: _IdParam,
    dest: Annotated[
        str,
        Field(
            description="Optional absolute output path for the .pdf. "
            "Default: <notes>/.exports/<note>.pdf",
            max_length=400,
        ),
    ] = "",
) -> str:
    """Export a note to a PDF file on disk (for sharing/printing/archival) and return \
its path.

    Result: the absolute path to the written PDF.
    """
    with _observe("export_note_pdf") as log:
        note = _store().read_note(note_id)
        pdf = await render_note_pdf(note.title, note.body, note.tags)
        if dest:
            out = Path(dest)
        else:
            stem = note_id.split("/")[-1].removesuffix(".md")
            out = resolve_notes_dir(get_settings()) / ".exports" / f"{stem}.pdf"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(pdf)
        log.info("note.exported_pdf", note_id=note_id, path=str(out))
        return str(out)


def register_tools(mcp: FastMCP) -> None:
    """Register all tools on the MCP server instance."""
    mcp.tool()(list_notes)
    mcp.tool()(search_notes)
    mcp.tool()(read_note)
    mcp.tool()(create_note)
    mcp.tool()(update_note)
    mcp.tool()(delete_note)
    mcp.tool()(list_tasks)
    mcp.tool()(toggle_task)
    mcp.tool()(render_note)
    mcp.tool()(export_note_pdf)
