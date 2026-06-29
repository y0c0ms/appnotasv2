"""Changelog endpoint — returns the full CHANGELOG.md content as plain text.

Returns 404 with a descriptive message if the file is not found.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.services.changelog import read_changelog

router = APIRouter(tags=["meta"])


@router.get(
    "/changelog",
    operation_id="get_changelog",
    summary="Full CHANGELOG.md content",
    response_class=PlainTextResponse,
)
async def changelog() -> PlainTextResponse:
    try:
        content = read_changelog()
        return PlainTextResponse(content)
    except FileNotFoundError:
        return PlainTextResponse(
            "CHANGELOG.md not found",
            status_code=404,
        )
