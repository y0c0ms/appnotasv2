"""NotesStore tests — real file I/O on throwaway temp dirs, never real notes."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.mcp_server.server import create_mcp_server
from app.services.notes import NotesError, NotesStore


def _store(tmp_path: Path) -> NotesStore:
    (tmp_path / "tasks").mkdir()
    return NotesStore(tmp_path)


# ---------------------------------------------------------------------------
# create / read roundtrip
# ---------------------------------------------------------------------------


def test_create_and_read(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("My Title", body="Hello body", tags=["a", "b"], color="#fff")
    assert note.id.endswith(".md")
    assert note.folder == "notes"
    got = s.read_note(note.id)
    assert got.title == "My Title"
    assert got.body == "Hello body"
    assert got.tags == ["a", "b"]
    assert got.color == "#fff"
    assert got.created == got.modified  # set equal on create


def test_create_in_tasks_folder_has_prefix(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("Sprint", body="- [ ] x", folder="tasks")
    assert note.id.startswith("tasks/")
    assert (tmp_path / "tasks" / note.id.split("/", 1)[1]).is_file()


def test_create_blank_title_rejected(tmp_path: Path) -> None:
    with pytest.raises(NotesError):
        _store(tmp_path).create_note("   ")


# ---------------------------------------------------------------------------
# list / search
# ---------------------------------------------------------------------------


def test_list_orders_newest_first_and_filters(tmp_path: Path) -> None:
    s = _store(tmp_path)
    s.create_note("Alpha", body="apple")
    s.create_note("Beta", body="banana")
    ids = [n.title for n in s.list_notes()]
    assert set(ids) == {"Alpha", "Beta"}
    hits = s.list_notes(query="banana")
    assert [n.title for n in hits] == ["Beta"]


def test_bom_file_is_parsed(tmp_path: Path) -> None:
    s = _store(tmp_path)
    body = (
        "﻿---\ntitle: B\ncreated: 2026-01-01T00:00:00+00:00\n"
        "modified: 2026-01-01T00:00:00+00:00\ntags: []\n---\n\nbody"
    )
    (tmp_path / "bom.md").write_text(body, encoding="utf-8")
    note = s.read_note("bom.md")
    assert note.title == "B"
    assert note.body == "body"


def test_no_frontmatter_note(tmp_path: Path) -> None:
    s = _store(tmp_path)
    (tmp_path / "plain.md").write_text("just body text", encoding="utf-8")
    note = s.read_note("plain.md")
    assert note.title == "plain"  # filename stem
    assert note.body == "just body text"


# ---------------------------------------------------------------------------
# update preserves fields
# ---------------------------------------------------------------------------


def test_update_preserves_created_tags_color(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("Keep", body="v1", tags=["t1"], color="#abc")
    updated = s.update_note(note.id, body="v2")
    assert updated.body == "v2"
    assert updated.created == note.created  # preserved (app's save would clobber)
    assert updated.tags == ["t1"]
    assert updated.color == "#abc"
    assert updated.modified >= note.modified


# ---------------------------------------------------------------------------
# soft delete
# ---------------------------------------------------------------------------


def test_delete_requires_confirm(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("Doomed")
    res = s.delete_note(note.id, confirm=False)
    assert res.deleted is False
    assert s.read_note(note.id)  # still there


def test_delete_soft_moves_to_trash(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("Doomed")
    res = s.delete_note(note.id, confirm=True)
    assert res.deleted is True
    assert ".trash" in res.trashed_to
    with pytest.raises(NotesError):
        s.read_note(note.id)  # gone from the listing dir
    assert (tmp_path / ".trash").is_dir()


# ---------------------------------------------------------------------------
# tasks
# ---------------------------------------------------------------------------


def test_list_and_toggle_tasks(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("Sprint", body="- [ ] one\n- [x] two\nplain line", folder="tasks")
    tasks = s.list_tasks("tasks")
    assert [(t.text, t.checked) for t in tasks] == [("one", False), ("two", True)]

    toggled = s.toggle_task(tasks[0].task_id, checked=True)
    assert toggled.checked is True
    after = s.read_note(note.id)
    assert after.body.splitlines() == [
        "- [x] one",
        "- [x] two",
        "plain line",
    ]  # only line 0 changed


def test_toggle_non_task_line_rejected(tmp_path: Path) -> None:
    s = _store(tmp_path)
    note = s.create_note("X", body="not a task", folder="tasks")
    with pytest.raises(NotesError):
        s.toggle_task(f"{note.id}:0", checked=True)


# ---------------------------------------------------------------------------
# path confinement
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_id",
    ["../escape.md", "..\\escape.md", "sub/dir/x.md", "evil/x.md", "no-extension", "a.txt"],
)
def test_confinement_rejects_bad_ids(tmp_path: Path, bad_id: str) -> None:
    with pytest.raises(NotesError):
        _store(tmp_path).read_note(bad_id)


# ---------------------------------------------------------------------------
# MCP registration
# ---------------------------------------------------------------------------


async def test_tools_registered() -> None:
    names = {t.name for t in await create_mcp_server().list_tools()}
    assert {
        "list_notes",
        "search_notes",
        "read_note",
        "create_note",
        "update_note",
        "delete_note",
        "list_tasks",
        "toggle_task",
    }.issubset(names)
