"""Inline remote images into note bodies as base64 ``data:`` URLs.

The AppNotas webview's Content-Security-Policy only allows images from ``'self'``,
``data:`` and ``asset:``, so external ``https`` image URLs never render. When an
agent writes a note that references web images — Markdown ``![alt](url)`` or an
``<img src="url">`` tag — we download each image here and rewrite the reference
to a self-contained ``data:`` URL, matching the shape the app produces for pasted
images (``<img class="tiptap-image" ...>``). The agent only ever passes the URL,
so the base64 never enters its context window.

Network egress on this machine goes through a TLS-inspecting proxy (Zscaler)
whose root CA lives in the OS trust store but not in certifi. We therefore verify
against the OS trust store via ``truststore``, falling back to the default
context if it is unavailable.
"""

from __future__ import annotations

import asyncio
import base64
import re
import ssl

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Markdown image: ![alt](http(s)://...)   — alt has no ']' , url has no ')'/space
_MD_IMG_RE = re.compile(r"!\[([^\]]*)\]\((https?://[^)\s]+)\)")
# HTML <img ...> tag (up to the first '>'; data URLs contain no '>')
_HTML_IMG_RE = re.compile(r"<img\b[^>]*?>", re.IGNORECASE)
# src="..." or src='...' inside a tag
_SRC_RE = re.compile(r"""\bsrc\s*=\s*("([^"]*)"|'([^']*)')""", re.IGNORECASE)

_MAX_BYTES = 12 * 1024 * 1024  # skip images larger than ~12 MB
_TIMEOUT = 30.0

_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
}


def _ssl_context() -> ssl.SSLContext | None:
    """OS-trust-store SSL context (trusts the Zscaler CA), or None to fall back."""
    try:
        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:  # pragma: no cover - truststore should be installed
        return None


def _guess_mime(url: str, content_type: str | None) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/"):
        return ct
    lower = url.lower().split("?")[0].split("#")[0]
    for ext, mime in _EXT_MIME.items():
        if lower.endswith(ext):
            return mime
    return ""


def _src_value(match: re.Match[str]) -> str | None:
    """The captured src value (double- or single-quoted)."""
    return match.group(2) if match.group(2) is not None else match.group(3)


def _esc_attr(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _collect_urls(body: str) -> list[str]:
    urls: set[str] = set()
    for m in _MD_IMG_RE.finditer(body):
        urls.add(m.group(2))
    for tag in _HTML_IMG_RE.finditer(body):
        sm = _SRC_RE.search(tag.group(0))
        if sm:
            src = _src_value(sm)
            if src and src.lower().startswith(("http://", "https://")):
                urls.add(src)
    return list(urls)


async def _fetch_data_url(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        resp = await client.get(url, timeout=_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
        if not data or len(data) > _MAX_BYTES:
            logger.warning("image.skip", url=url, reason="empty_or_too_large", size=len(data))
            return None
        mime = _guess_mime(url, resp.headers.get("content-type"))
        if not mime.startswith("image/"):
            logger.warning("image.skip", url=url, reason="not_an_image", content_type=mime)
            return None
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"
    except Exception as exc:
        logger.warning("image.fetch_failed", url=url, error=str(exc))
        return None


async def inline_remote_images(body: str | None) -> str | None:
    """Replace http(s) image references in ``body`` with base64 ``data:`` URLs.

    Markdown images become ``<img class="tiptap-image" ...>`` (the app's format);
    HTML ``<img>`` tags keep their attributes and only the ``src`` is swapped.
    Unreachable / non-image URLs are left untouched so nothing is silently
    dropped, and existing ``data:``/``asset:`` sources are ignored. Idempotent.
    """
    if not body or ("http://" not in body and "https://" not in body):
        return body
    url_list = _collect_urls(body)
    if not url_list:
        return body

    ctx = _ssl_context()
    verify: ssl.SSLContext | bool = ctx if ctx is not None else True
    async with httpx.AsyncClient(
        verify=verify, headers={"User-Agent": "appnotas-mcp/0.1 (+image-inline)"}
    ) as client:
        results = await asyncio.gather(*(_fetch_data_url(client, u) for u in url_list))
    data_urls = {u: d for u, d in zip(url_list, results) if d}
    if not data_urls:
        return body

    def md_repl(m: re.Match[str]) -> str:
        alt, url = m.group(1), m.group(2)
        data = data_urls.get(url)
        if not data:
            return m.group(0)
        alt_attr = f' alt="{_esc_attr(alt)}"' if alt else ""
        return f'<img class="tiptap-image" src="{data}"{alt_attr}>'

    body = _MD_IMG_RE.sub(md_repl, body)

    def tag_repl(m: re.Match[str]) -> str:
        tag = m.group(0)
        sm = _SRC_RE.search(tag)
        if not sm:
            return tag
        src = _src_value(sm)
        data = data_urls.get(src) if src else None
        if not data:
            return tag
        return tag[: sm.start(1)] + f'"{data}"' + tag[sm.end(1) :]

    return _HTML_IMG_RE.sub(tag_repl, body)
