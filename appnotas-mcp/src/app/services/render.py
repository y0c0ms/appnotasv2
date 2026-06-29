"""Render a note to a PNG image or PDF for visual review.

An agent that writes a note can't otherwise *see* the result — whether images
resolved, tables aligned, code blocks and checklists came out right. This module
renders the note's Markdown the way the AppNotas editor does (GFM tables, task
lists, inline HTML / ``data:`` images) into a self-contained HTML document with a
dark theme matching the app, then drives the locally-installed **Edge** browser
(headless, via Playwright) to screenshot it (PNG) or print it (PDF).

Edge is used via Playwright's ``channel="msedge"`` so no Chromium download is
needed — important on locked-down machines. Falls back to ``chrome``.
"""

from __future__ import annotations

import html as _html

from markdown_it import MarkdownIt
from mdit_py_plugins.tasklists import tasklists_plugin

_CSS = """
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; }
.tiptap-editor {
  max-width: 820px; margin: 0 auto; padding: 2.25rem 3rem 4rem;
  color: #e0e0e0;
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px; line-height: 1.6; word-wrap: break-word;
}
.note-meta { color: #8b949e; font-size: .8rem; margin-bottom: 1.5rem;
  padding-bottom: .6rem; border-bottom: 1px solid #21262d; }
.note-meta .title { color: #c9d1d9; font-weight: 600; font-size: 1rem; }
.note-meta .tag { display: inline-block; margin-left: .4rem; padding: .05rem .45rem;
  background: #1f2630; border: 1px solid #30363d; border-radius: 10px; }
.tiptap-editor h1 { font-size: 2.1rem; font-weight: 800; color: #fff;
  border-bottom: 2px solid #333; padding-bottom: .4rem; margin: 1.6rem 0 1rem; }
.tiptap-editor h2 { font-size: 1.6rem; font-weight: 700; color: #fff; margin: 1.4rem 0 .8rem; }
.tiptap-editor h3 { font-size: 1.3rem; font-weight: 700; color: #fff; margin: 1.2rem 0 .6rem; }
.tiptap-editor p { margin: .6rem 0; }
.tiptap-editor a { color: #4a9eff; text-decoration: none; }
.tiptap-editor strong { color: #fff; }
.tiptap-editor code { background: #161b22; border: 1px solid #30363d; border-radius: 4px;
  padding: .1em .35em; font-family: Consolas, Menlo, monospace; font-size: .9em; }
.tiptap-editor pre { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 1rem; overflow: auto; }
.tiptap-editor pre code { background: none; border: none; padding: 0; }
.tiptap-editor img { max-width: 100%; height: auto; border-radius: 6px; margin: .5rem 0; }
.tiptap-editor blockquote { border-left: 3px solid #4a9eff; margin: .8rem 0;
  padding: .2rem 1rem; color: #adb6c0; }
.tiptap-editor ul, .tiptap-editor ol { padding-left: 1.4rem; }
.tiptap-editor hr { border: none; border-top: 1px solid #333; margin: 1.5rem 0; }
.tiptap-editor table { border-collapse: collapse; width: 100%; margin: 1rem 0;
  table-layout: fixed; font-size: .95em; }
.tiptap-editor th, .tiptap-editor td { border: 1px solid #4a5260; padding: .45rem .6rem;
  text-align: left; vertical-align: top; }
.tiptap-editor th { background: #20262f; font-weight: 600; }
.tiptap-editor ul.contains-task-list { list-style: none; padding-left: .2rem; }
.tiptap-editor li.task-list-item { display: flex; align-items: flex-start; gap: .15rem; }
.tiptap-editor input[type=checkbox] { width: 1.05rem; height: 1.05rem; margin: .2rem .5rem 0 0;
  accent-color: #4a9eff; }
"""

_TEMPLATE = (
    "<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head>"
    "<body><div class='tiptap-editor'>{meta}{content}</div></body></html>"
)


def _md() -> MarkdownIt:
    # gfm-like = tables + strikethrough (+ linkify, which we disable to avoid the
    # linkify-it-py dep and match the app). html=True passes <img>/<div> through;
    # breaks=True matches the app's tiptap-markdown config.
    return MarkdownIt("gfm-like", {"html": True, "breaks": True, "linkify": False}).use(
        tasklists_plugin
    )


def note_to_html(title: str, body: str, tags: list[str] | None = None) -> str:
    """Render a note's title/body/tags to a full, self-contained HTML document."""
    content = _md().render(body or "")
    tag_html = "".join(f"<span class='tag'>{_html.escape(t)}</span>" for t in (tags or []))
    meta = f"<div class='note-meta'><span class='title'>{_html.escape(title)}</span>{tag_html}</div>"
    return _TEMPLATE.format(css=_CSS, meta=meta, content=content)


async def _render(html_doc: str, *, fmt: str, width: int) -> bytes:
    from playwright.async_api import async_playwright

    last: Exception | None = None
    async with async_playwright() as p:
        for channel in ("msedge", "chrome"):
            try:
                browser = await p.chromium.launch(channel=channel, headless=True)
            except Exception as exc:  # browser not installed under this channel
                last = exc
                continue
            try:
                page = await browser.new_page(
                    viewport={"width": width, "height": 1200}, device_scale_factor=2
                )
                await page.set_content(html_doc, wait_until="networkidle")
                if fmt == "pdf":
                    # device_scale_factor isn't used for pdf; print backgrounds.
                    return await page.pdf(print_background=True, prefer_css_page_size=True)
                return await page.screenshot(full_page=True, type="png")
            finally:
                await browser.close()
    raise RuntimeError(
        f"No usable browser (tried msedge, chrome). Install Edge or Chrome. Last error: {last}"
    )


async def render_note_png(title: str, body: str, tags: list[str] | None = None, width: int = 860) -> bytes:
    return await _render(note_to_html(title, body, tags), fmt="png", width=width)


async def render_note_pdf(title: str, body: str, tags: list[str] | None = None, width: int = 860) -> bytes:
    return await _render(note_to_html(title, body, tags), fmt="pdf", width=width)
