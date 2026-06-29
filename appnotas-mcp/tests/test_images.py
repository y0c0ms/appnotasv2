"""Tests for remote-image inlining (no real network — the fetcher is patched)."""

from __future__ import annotations

import httpx
import pytest

from app.services import images


async def _fake_fetch(client: httpx.AsyncClient, url: str) -> str | None:
    """Return a tiny data URL for any url containing 'good', else None."""
    if "good" in url:
        return "data:image/png;base64,QUJD"  # 'ABC'
    return None


async def test_inlines_markdown_and_html(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(images, "_fetch_data_url", _fake_fetch)
    body = (
        "intro\n\n"
        "![cap](https://x.test/good.png)\n\n"
        '<img class="tiptap-image" src="https://x.test/good-2.png" alt="A" '
        'width="10" height="20">\n\n'
        "![miss](https://x.test/bad.png)\n\n"
        '<img src="data:image/png;base64,ZZZ">\n'
    )
    out = await images.inline_remote_images(body)

    # Markdown image -> app-format <img class="tiptap-image" ...> with data URL
    assert "![cap]" not in out
    assert 'class="tiptap-image" src="data:image/png;base64,QUJD" alt="cap"' in out
    # HTML <img>: src swapped to data URL, other attributes preserved
    assert 'src="data:image/png;base64,QUJD" alt="A" width="10" height="20"' in out
    # Unreachable image left untouched (nothing silently dropped)
    assert "![miss](https://x.test/bad.png)" in out
    # Existing data: URL left untouched (idempotent)
    assert 'src="data:image/png;base64,ZZZ"' in out


async def test_noop_without_images(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(images, "_fetch_data_url", _fake_fetch)
    body = "# Title\n\nplain text, a https://example.com link but no image"
    # A bare link is not an image reference, so the body is returned unchanged.
    assert await images.inline_remote_images(body) == body
    assert await images.inline_remote_images("") == ""
    assert await images.inline_remote_images(None) is None


def test_guess_mime() -> None:
    assert images._guess_mime("https://x/y.PNG", None) == "image/png"
    assert images._guess_mime("https://x/y", "image/jpeg; charset=binary") == "image/jpeg"
    assert images._guess_mime("https://x/y.webp?v=2", None) == "image/webp"
    assert images._guess_mime("https://x/y", "text/html") == ""


def test_collect_urls_ignores_data_and_non_image() -> None:
    body = (
        "![a](https://x/a.png) "
        '<img src="http://x/b.jpg"> '
        '<img src="data:image/png;base64,ZZ"> '
        "[link](https://x/page)"
    )
    urls = set(images._collect_urls(body))
    assert urls == {"https://x/a.png", "http://x/b.jpg"}
