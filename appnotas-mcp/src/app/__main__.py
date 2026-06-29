"""Programmatic uvicorn entry point.

Reads host, port, and log_level from Settings (i.e. from .env or environment
variables) so that ``uv run python -m app`` respects the .env file without
requiring CLI flags.

Usage:
    uv run python -m app              # uses .env / env vars
    HOST=0.0.0.0 PORT=9000 uv run python -m app
"""

from __future__ import annotations

import uvicorn

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
