"""Tests for note->HTML rendering (deterministic; no browser needed)."""

from __future__ import annotations

from app.services.render import note_to_html


def test_table_renders_to_html() -> None:
    body = "| A | B |\n| --- | --- |\n| 1 | 2 |"
    out = note_to_html("T", body)
    assert "<table>" in out
    assert "<th>A</th>" in out or "<th>A" in out
    assert "<td>1</td>" in out or "<td>1" in out


def test_inline_html_image_passthrough() -> None:
    body = '<img class="tiptap-image" src="data:image/png;base64,QUJD" alt="x">'
    out = note_to_html("T", body)
    assert 'src="data:image/png;base64,QUJD"' in out


def test_task_list_renders_checkboxes() -> None:
    body = "- [ ] open\n- [x] done"
    out = note_to_html("T", body)
    assert 'type="checkbox"' in out
    assert "checked" in out  # the done item


def test_title_and_tags_in_meta() -> None:
    out = note_to_html("My <Note>", "body", tags=["paper", "llm"])
    assert "My &lt;Note&gt;" in out  # title is HTML-escaped
    assert "paper" in out and "llm" in out


def test_self_contained_document() -> None:
    out = note_to_html("T", "# Heading\n\ntext")
    assert out.startswith("<!doctype html>")
    assert "tiptap-editor" in out
    assert "<h1>Heading</h1>" in out
