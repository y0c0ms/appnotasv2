"""Tests for Bearer token authentication middleware."""

from __future__ import annotations

import os
from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

_TOKEN = "test-secret-token-for-auth-tests-only-32x"  # noqa: S105


@pytest.fixture
def auth_client() -> Iterator[TestClient]:
    """Test client with AUTH_ENABLED=true and a known token."""
    with patch.dict(os.environ, {"AUTH_ENABLED": "true", "API_TOKEN": _TOKEN}):
        from app.main import create_app

        with TestClient(create_app()) as c:
            yield c


def _auth(token: str = _TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# No token / wrong token
# ---------------------------------------------------------------------------


def test_no_token_returns_401(auth_client: TestClient) -> None:
    assert auth_client.get("/mcp").status_code == 401


def test_wrong_token_returns_401(auth_client: TestClient) -> None:
    assert auth_client.get("/mcp", headers=_auth("wrong")).status_code == 401


def test_bearer_prefix_required(auth_client: TestClient) -> None:
    assert auth_client.get("/mcp", headers={"Authorization": _TOKEN}).status_code == 401


# ---------------------------------------------------------------------------
# Valid token
# ---------------------------------------------------------------------------


def test_valid_token_allows_mcp(auth_client: TestClient) -> None:
    # A valid token must not be rejected; MCP may respond with any non-401 code.
    assert auth_client.get("/mcp", headers=_auth()).status_code != 401


def test_valid_token_openapi(auth_client: TestClient) -> None:
    # /openapi.json is exempt — accessible with or without a token.
    assert auth_client.get("/openapi.json").status_code == 200


# ---------------------------------------------------------------------------
# Exempt paths (always accessible without auth)
# ---------------------------------------------------------------------------


def test_healthz_exempt(auth_client: TestClient) -> None:
    assert auth_client.get("/healthz").status_code == 200


def test_readyz_exempt(auth_client: TestClient) -> None:
    assert auth_client.get("/readyz").status_code == 200


def test_version_exempt(auth_client: TestClient) -> None:
    assert auth_client.get("/version").status_code == 200


def test_changelog_exempt(auth_client: TestClient) -> None:
    assert auth_client.get("/changelog").status_code == 200


# ---------------------------------------------------------------------------
# Auth disabled (default) — existing tests still work unchanged
# ---------------------------------------------------------------------------


def test_auth_disabled_no_token_needed(client: TestClient) -> None:
    assert client.get("/version").status_code == 200
