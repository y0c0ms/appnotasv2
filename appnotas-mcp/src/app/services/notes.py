"""Local read/write access to AppNotas notes — a folder of Markdown files.

AppNotas stores every note as a UTF-8 Markdown file with a small frontmatter
block. Notes live flat in the configured notes directory; "task" notes live in a
flat ``tasks/`` subfolder, and individual tasks are checkbox lines inside those
files. There is no database and no API — direct file access is the only way in.

Guardrails (this server can create, edit, and delete real notes):
  - Path confinement: an id is a bare ``*.md`` filename, optionally under
    ``tasks/``; anything with separators / ``..`` / escaping the notes dir is
    rejected before any I/O.
  - Non-destructive UPDATE: read-modify-write that preserves ``created``,
    ``tags`` and ``color`` (the app's own save is lossy — we do NOT imitate it).
  - Soft DELETE: files are moved to ``.trash/`` (the app ignores dot-folders),
    never unlinked, and only with an explicit confirm flag.
  - Atomic writes (temp file + os.replace) with retry, because the notes dir is
    OneDrive-synced and may briefly lock files.

The store is constructed with a notes directory, so tests run against a
throwaway folder and never touch real notes.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

_FNAME_RE = re.compile(r"^[^/\\:*?\"<>|]+\.md$")
_BULLET_TASK_RE = re.compile(r"^(\s*)[-*]\s*\[\s*([ xX])\s*\]\s*(.*)$")
_BARE_TASK_RE = re.compile(r"^(\s*)\[\s*([ xX])\s*\]\s*(.*)$")
_BRACKET_RE = re.compile(r"\[\s*[ xX]\s*\]")

Folder = str  # "notes" or "tasks"


class NotesError(ValueError):
    """Invalid note id, missing note, or unconfigured/unsafe path."""


# ───────────────────────────────────────────────────────────────────
# Models
# ───────────────────────────────────────────────────────────────────


class NoteSummary(BaseModel):
    id: str = Field(description="Note id = filename, e.g. 'note-….md' or 'tasks/note-….md'.")
    title: str
    folder: Folder = Field(description="'notes' (root) or 'tasks'.")
    modified: str = Field(description="RFC3339 UTC last-modified time.")
    tags: list[str] = Field(default_factory=list)
    snippet: str = Field(default="", description="First line of the body, for context.")


class Note(BaseModel):
    id: str
    title: str
    folder: Folder
    created: str
    modified: str
    tags: list[str] = Field(default_factory=list)
    color: str = Field(default="")
    body: str = Field(default="")


class Task(BaseModel):
    task_id: str = Field(description="'<note id>:<0-based line index>' — pass to toggle_task.")
    note_id: str
    note_title: str
    line: int
    text: str
    checked: bool


class DeleteResult(BaseModel):
    id: str
    deleted: bool
    trashed_to: str = Field(default="", description="Where the note was moved (soft delete).")
    note: str = Field(default="")


# ───────────────────────────────────────────────────────────────────
# Frontmatter parse / serialize (matches the app's format)
# ───────────────────────────────────────────────────────────────────


def _parse(content: str, fallback_title: str) -> dict[str, Any]:
    content = content.removeprefix("﻿")  # tolerate a stray UTF-8 BOM
    title, created, modified, color = fallback_title, "", "", ""
    tags: list[str] = []
    body = content
    if content.startswith("---"):
        parts = content.split("---", 2)  # mirrors the app's splitn(3, "---")
        if len(parts) == 3:
            _, frontmatter, rest = parts
            for line in frontmatter.strip().splitlines():
                key, sep, value = line.partition(":")
                if not sep:
                    continue
                key, value = key.strip().lower(), value.strip()
                if key == "title":
                    title = value
                elif key == "created":
                    created = value
                elif key == "modified":
                    modified = value
                elif key == "color":
                    color = value
                elif key == "tags":
                    inner = value.strip().removeprefix("[").removesuffix("]")
                    tags = [t.strip() for t in inner.split(",") if t.strip()]
            body = rest.strip("\n")
    return {
        "title": title,
        "created": created,
        "modified": modified,
        "color": color,
        "tags": tags,
        "body": body,
    }


def _serialize(
    *, title: str, created: str, modified: str, tags: list[str], color: str, body: str
) -> str:
    lines = [
        "---",
        f"title: {title}",
        f"created: {created}",
        f"modified: {modified}",
        f"tags: [{', '.join(tags)}]",
    ]
    if color:
        lines.append(f"color: {color}")
    lines += ["---", "", body]
    text = "\n".join(lines)
    return text if text.endswith("\n") else text + "\n"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", title.lower().replace(" ", "-")).strip("-")


# ───────────────────────────────────────────────────────────────────
# Store
# ───────────────────────────────────────────────────────────────────


class NotesStore:
    def __init__(self, notes_dir: Path) -> None:
        self._dir = notes_dir
        self._tasks = notes_dir / "tasks"
        self._trash = notes_dir / ".trash"

    # --- id / path resolution (confinement) --------------------------------

    def _resolve(self, note_id: str) -> tuple[Path, Folder]:
        nid = note_id.strip().replace("\\", "/")
        if "/" in nid:
            folder, _, fname = nid.partition("/")
            if folder != "tasks" or "/" in fname:
                raise NotesError(f"Invalid note id: {note_id!r}")
            base, folder_name = self._tasks, "tasks"
        else:
            fname, base, folder_name = nid, self._dir, "notes"
        if ".." in fname or not _FNAME_RE.fullmatch(fname):
            raise NotesError(f"Invalid note id: {note_id!r}")
        path = base / fname
        if path.resolve().parent != base.resolve():
            raise NotesError(f"Note id escapes the notes directory: {note_id!r}")
        return path, folder_name

    def _id_for(self, path: Path, folder: Folder) -> str:
        return f"tasks/{path.name}" if folder == "tasks" else path.name

    def _write_atomic(self, path: Path, content: str, retries: int = 5) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex[:8]}")
        last: Exception | None = None
        for attempt in range(retries):
            try:
                tmp.write_text(content, encoding="utf-8")
                os.replace(tmp, path)
                return
            except OSError as exc:  # OneDrive may briefly lock the file
                last = exc
                time.sleep(0.2 * (attempt + 1))
                try:
                    tmp.unlink()
                except OSError:
                    pass
        raise NotesError(f"Write failed after {retries} attempts ({type(last).__name__}).")

    # --- iteration ---------------------------------------------------------

    def _iter_files(self, folder: Folder) -> list[tuple[Path, Folder]]:
        out: list[tuple[Path, Folder]] = []
        if folder in ("notes", "all") and self._dir.is_dir():
            out += [(p, "notes") for p in self._dir.glob("*.md") if p.is_file()]
        if folder in ("tasks", "all") and self._tasks.is_dir():
            out += [(p, "tasks") for p in self._tasks.glob("*.md") if p.is_file()]
        return out

    def _read(self, path: Path, folder: Folder) -> Note:
        content = path.read_text(encoding="utf-8")
        data = _parse(content, fallback_title=path.stem)
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()
        return Note(
            id=self._id_for(path, folder),
            title=data["title"],
            folder=folder,
            created=data["created"] or mtime,
            modified=data["modified"] or mtime,
            tags=data["tags"],
            color=data["color"],
            body=data["body"],
        )

    # --- public API --------------------------------------------------------

    def list_notes(self, folder: Folder = "all", query: str = "") -> list[NoteSummary]:
        needle = query.lower()
        notes = [self._read(p, f) for p, f in self._iter_files(folder)]
        if needle:
            notes = [n for n in notes if needle in n.title.lower() or needle in n.body.lower()]
        notes.sort(key=lambda n: n.modified, reverse=True)
        return [
            NoteSummary(
                id=n.id,
                title=n.title,
                folder=n.folder,
                modified=n.modified,
                tags=n.tags,
                snippet=n.body.strip().splitlines()[0][:120] if n.body.strip() else "",
            )
            for n in notes
        ]

    def read_note(self, note_id: str) -> Note:
        path, folder = self._resolve(note_id)
        if not path.is_file():
            raise NotesError(f"Note not found: {note_id!r}")
        return self._read(path, folder)

    def create_note(
        self,
        title: str,
        body: str = "",
        tags: list[str] | None = None,
        folder: Folder = "notes",
        color: str = "",
    ) -> Note:
        if not title.strip():
            raise NotesError("title must not be blank.")
        if folder not in ("notes", "tasks"):
            raise NotesError("folder must be 'notes' or 'tasks'.")
        base = self._tasks if folder == "tasks" else self._dir
        ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        slug = _slug(title)
        stem = f"note-{ts}-{slug}" if slug else f"note-{ts}"
        path = base / f"{stem}.md"
        if path.exists():
            path = base / f"{stem}-{uuid.uuid4().hex[:4]}.md"
        now = _now()
        self._write_atomic(
            path,
            _serialize(
                title=title, created=now, modified=now, tags=tags or [], color=color, body=body
            ),
        )
        return self._read(path, folder)

    def update_note(
        self,
        note_id: str,
        title: str | None = None,
        body: str | None = None,
        tags: list[str] | None = None,
        color: str | None = None,
    ) -> Note:
        path, folder = self._resolve(note_id)
        if not path.is_file():
            raise NotesError(f"Note not found: {note_id!r}")
        cur = self._read(path, folder)
        self._write_atomic(
            path,
            _serialize(
                title=title if title is not None else cur.title,
                created=cur.created,  # preserved — the app's save would clobber this
                modified=_now(),
                tags=tags if tags is not None else cur.tags,
                color=color if color is not None else cur.color,
                body=body if body is not None else cur.body,
            ),
        )
        return self._read(path, folder)

    def delete_note(self, note_id: str, confirm: bool = False) -> DeleteResult:
        path, _ = self._resolve(note_id)
        if not path.is_file():
            raise NotesError(f"Note not found: {note_id!r}")
        if not confirm:
            return DeleteResult(
                id=note_id,
                deleted=False,
                note="Not deleted. Call again with confirm=true to move it to .trash.",
            )
        self._trash.mkdir(parents=True, exist_ok=True)
        dest = self._trash / path.name
        if dest.exists():
            dest = self._trash / f"{path.stem}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.md"
        os.replace(path, dest)
        return DeleteResult(
            id=note_id, deleted=True, trashed_to=str(dest), note="Soft-deleted (moved to .trash)."
        )

    def list_tasks(self, folder: Folder = "tasks") -> list[Task]:
        tasks: list[Task] = []
        for path, f in self._iter_files(folder):
            note = self._read(path, f)
            for i, line in enumerate(note.body.splitlines()):
                m = _BULLET_TASK_RE.match(line) or _BARE_TASK_RE.match(line)
                if not m:
                    continue
                tasks.append(
                    Task(
                        task_id=f"{note.id}:{i}",
                        note_id=note.id,
                        note_title=note.title,
                        line=i,
                        text=m.group(3).strip(),
                        checked=m.group(2).lower() == "x",
                    )
                )
        return tasks

    def toggle_task(self, task_id: str, checked: bool) -> Task:
        note_id, _, idx_str = task_id.rpartition(":")
        if not note_id or not idx_str.isdigit():
            raise NotesError(f"Invalid task id: {task_id!r} (expected '<note id>:<line>').")
        idx = int(idx_str)
        path, folder = self._resolve(note_id)
        if not path.is_file():
            raise NotesError(f"Note not found: {note_id!r}")
        note = self._read(path, folder)
        body_lines = note.body.splitlines()
        if idx < 0 or idx >= len(body_lines):
            raise NotesError(f"Line {idx} is out of range for {note_id!r}.")
        line = body_lines[idx]
        m = _BULLET_TASK_RE.match(line) or _BARE_TASK_RE.match(line)
        if not m:
            raise NotesError(f"Line {idx} of {note_id!r} is not a task (no checkbox).")
        body_lines[idx] = _BRACKET_RE.sub("[x]" if checked else "[ ]", line, count=1)
        self.update_note(note_id, body="\n".join(body_lines))
        return Task(
            task_id=task_id,
            note_id=note.id,
            note_title=note.title,
            line=idx,
            text=m.group(3).strip(),
            checked=checked,
        )

    # --- construction ------------------------------------------------------

    @classmethod
    def from_settings(cls, settings: Any) -> NotesStore:
        return cls(resolve_notes_dir(settings))


def resolve_notes_dir(settings: Any) -> Path:
    """Use NOTES_DIR if set, else auto-discover from the AppNotas settings JSON."""
    if settings.notes_dir:
        return Path(settings.notes_dir)
    appdata = os.environ.get("APPDATA")
    if appdata:
        cfg = Path(appdata) / "com.appnotas.desktop" / "appnotas-settings.json"
        if cfg.is_file():
            try:
                nd = json.loads(cfg.read_text(encoding="utf-8")).get("notesDirectory")
            except (OSError, json.JSONDecodeError):
                nd = None
            if nd:
                return Path(nd)
    raise NotesError("Notes directory not configured. Set NOTES_DIR or run AppNotas first.")
