"""Tests for HTTP request limits and the fail-closed auth policy.

These exercise the ASGI middleware and startup policy on the HTTP transport.
Each test builds its own app with patched env vars (and clears the settings
cache) so it sees fresh configuration.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

_ACCEPT = {"Accept": "application/json, text/event-stream"}


def test_fail_closed_without_auth_in_prod() -> None:
    with patch.dict(os.environ, {"ENVIRONMENT": "prd", "AUTH_ENABLED": "false"}):
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="without authentication"):
            create_app()


def test_prod_with_auth_starts() -> None:
    env = {"ENVIRONMENT": "prd", "AUTH_ENABLED": "true", "API_TOKEN": "x" * 32}
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        # Should not raise.
        create_app()


def test_rate_limit_returns_429() -> None:
    env = {
        "AUTH_ENABLED": "false",
        "ENVIRONMENT": "local",
        "RATE_LIMIT_ENABLED": "true",
        "RATE_LIMIT_REQUESTS": "3",
        "RATE_LIMIT_WINDOW_SECONDS": "60",
    }
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            codes = [client.get("/version").status_code for _ in range(4)]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429


def test_rate_limit_exempts_health() -> None:
    env = {
        "AUTH_ENABLED": "false",
        "ENVIRONMENT": "local",
        "RATE_LIMIT_ENABLED": "true",
        "RATE_LIMIT_REQUESTS": "1",
        "RATE_LIMIT_WINDOW_SECONDS": "60",
    }
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            codes = [client.get("/healthz").status_code for _ in range(5)]
    assert codes == [200] * 5


def test_body_too_large_returns_413() -> None:
    env = {"AUTH_ENABLED": "false", "ENVIRONMENT": "local", "MAX_BODY_BYTES": "10"}
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            resp = client.post("/mcp", content=b"x" * 100, headers=_ACCEPT)
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# Reverse-proxy base_path routing
# ---------------------------------------------------------------------------

_INIT_PAYLOAD = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0.1.0"},
    },
}


def test_base_path_routing() -> None:
    env = {"AUTH_ENABLED": "false", "ENVIRONMENT": "local", "BASE_PATH": "/nifmcp"}
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            assert client.get("/nifmcp/healthz").status_code == 200
            assert client.get("/nifmcp/changelog").status_code == 200
            # Root paths no longer exist under a base_path.
            assert client.get("/healthz").status_code == 404
            # MCP is reachable under the base path with no redirect / 404.
            mcp = client.post("/nifmcp/mcp", json=_INIT_PAYLOAD, headers=_ACCEPT)
            assert mcp.status_code == 200


def test_root_path_proxy_stripped_path_resolves() -> None:
    # Gateway strips ROOT_PATH and forwards /nifmcp/...; RootPathMiddleware
    # re-adds the prefix so FastAPI's root_path routing resolves it.
    env = {
        "AUTH_ENABLED": "false",
        "ENVIRONMENT": "local",
        "BASE_PATH": "/nifmcp",
        "ROOT_PATH": "/gir-router",
    }
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            assert client.get("/nifmcp/changelog").status_code == 200
            assert client.get("/nifmcp/healthz").status_code == 200


def test_base_path_auth_exempt_and_protected() -> None:
    env = {
        "AUTH_ENABLED": "true",
        "API_TOKEN": "x" * 32,
        "ENVIRONMENT": "local",
        "BASE_PATH": "/nifmcp",
    }
    with patch.dict(os.environ, env):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as client:
            # Probe is exempt even under the base path.
            assert client.get("/nifmcp/healthz").status_code == 200
            # MCP under the base path still requires a token.
            assert client.get("/nifmcp/mcp").status_code == 401
