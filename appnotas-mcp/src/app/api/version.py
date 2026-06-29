"""Version endpoint — returns the latest version from CHANGELOG.md as plain text.

If the file is missing or contains no version heading, returns 404 with a
descriptive message so callers can distinguish "server up but no changelog"
from a genuine 5xx failure.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.services.changelog import parse_latest_version, read_changelog

router = APIRouter(tags=["meta"])


@router.get(
    "/version",
    operation_id="get_version",
    summary="Latest version from CHANGELOG.md",
    response_class=PlainTextResponse,
)
async def version() -> PlainTextResponse:
    try:
        content = read_changelog()
        ver = parse_latest_version(content)
        return PlainTextResponse(ver)
    except FileNotFoundError:
        return PlainTextResponse(
            "CHANGELOG.md not found — cannot determine current version",
            status_code=404,
        )
    except ValueError as exc:
        return PlainTextResponse(str(exc), status_code=404)
