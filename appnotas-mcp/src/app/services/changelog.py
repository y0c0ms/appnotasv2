"""Business logic for reading and parsing CHANGELOG.md.

Pure Python — no FastAPI or MCP SDK dependencies.
Both the REST API layer and MCP tools can call these functions.
"""

from __future__ import annotations

import re
from pathlib import Path

# CHANGELOG.md lives at the project root, four directories above this file:
#   src/app/services/changelog.py → services/ → app/ → src/ → root
_CHANGELOG_PATH = Path(__file__).resolve().parent.parent.parent.parent / "CHANGELOG.md"

_VERSION_RE = re.compile(r"^##\s+\[([^\]]+)\]", re.MULTILINE)


def read_changelog() -> str:
    """Return the full content of CHANGELOG.md.

    Raises FileNotFoundError if the file does not exist.
    """
    if not _CHANGELOG_PATH.exists():
        raise FileNotFoundError(f"CHANGELOG.md not found at {_CHANGELOG_PATH}")
    return _CHANGELOG_PATH.read_text(encoding="utf-8")


def parse_latest_version(content: str) -> str:
    """Extract the latest version string from changelog content.

    Looks for the first ``## [x.y.z]`` heading and returns the value inside
    the brackets.  Raises ValueError if no such heading is found.
    """
    match = _VERSION_RE.search(content)
    if not match:
        raise ValueError(
            "No version heading found in CHANGELOG.md — expected a line like '## [1.2.3]'"
        )
    return match.group(1)
