"""HTTP-level regression tests for the MCP Streamable HTTP transport.

These tests MUST use real HTTP (TestClient) and cannot be replaced by
FastMCP's Python API (mcp.call_tool / list_tools), because the bugs they
guard against live in the HTTP routing and ASGI lifespan layers:

  Bug 1 — 307 Temporary Redirect
    Cause:  app.mount("/mcp", sub_app) caused Starlette to redirect
            POST /mcp → POST /mcp/ before the MCP handler could respond.
    Guard:  test_mcp_no_redirect

  Bug 2 — 500 / RuntimeError: Task group is not initialized
    Cause:  StreamableHTTPSessionManager.run() was never called because
            Starlette does not trigger a mounted sub-app's lifespan.
    Guard:  test_mcp_no_server_error

  Bug 3 — 404 Not Found
    Cause:  After the redirect, /mcp/ reached the sub-app as /, which had
            no matching route.
    Guard:  test_mcp_no_not_found
"""

from __future__ import annotations

import json
from typing import cast

import httpx
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ACCEPT = {"Accept": "application/json, text/event-stream"}

_INIT_PAYLOAD = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "pytest-client", "version": "0.1.0"},
    },
}


def _post_mcp(client: TestClient, payload: dict[str, object]) -> httpx.Response:
    """POST a JSON-RPC payload to /mcp and return the raw HTTP response.

    The typed assignment (rather than a cast) is robust across httpx versions:
    some return ``Response`` from ``client.post`` and some return ``Any``.
    """
    resp: httpx.Response = client.post("/mcp", json=payload, headers=_ACCEPT)
    return resp


def _first_message(resp: httpx.Response) -> dict[str, object]:
    """Return the first JSON-RPC message from a JSON or SSE response."""
    ct = resp.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in resp.text.splitlines():
            if line.startswith("data: "):
                # json.loads returns Any; cast tells mypy the expected shape.
                return cast(dict[str, object], json.loads(line[6:]))
        raise AssertionError(f"No SSE data events in response:\n{resp.text[:400]}")
    # resp.json() returns Any; cast pins the expected shape.
    return cast(dict[str, object], resp.json())


# ---------------------------------------------------------------------------
# Bug 1 & 3 — routing regressions
# ---------------------------------------------------------------------------


def test_mcp_no_redirect(client: TestClient) -> None:
    """POST /mcp must not redirect (Bug 1: wrong mount path → 307)."""
    resp = _post_mcp(client, _INIT_PAYLOAD)
    assert resp.status_code not in (301, 302, 307, 308), (
        f"Got {resp.status_code} redirect — check app.mount() path in main.py"
    )


def test_mcp_no_not_found(client: TestClient) -> None:
    """POST /mcp must not 404 (Bug 3: prefix stripped, sub-app gets /)."""
    resp = _post_mcp(client, _INIT_PAYLOAD)
    assert resp.status_code != 404, "MCP endpoint returned 404 — sub-app routing is broken"


# ---------------------------------------------------------------------------
# Bug 2 — lifespan regression
# ---------------------------------------------------------------------------


def test_mcp_no_server_error(client: TestClient) -> None:
    """POST /mcp must not 500 (Bug 2: session_manager.run() not in lifespan)."""
    resp = _post_mcp(client, _INIT_PAYLOAD)
    assert resp.status_code == 200, (
        f"Expected 200, got {resp.status_code}.\n"
        "If 500: check that the FastAPI lifespan calls session_manager.run()."
    )


# ---------------------------------------------------------------------------
# MCP protocol smoke test
# ---------------------------------------------------------------------------


def test_mcp_initialize_response(client: TestClient) -> None:
    """initialize must return protocolVersion and serverInfo."""
    resp = _post_mcp(client, _INIT_PAYLOAD)
    assert resp.status_code == 200
    msg = _first_message(resp)
    assert "error" not in msg, f"MCP error: {msg.get('error')}"
    result = msg.get("result")
    assert isinstance(result, dict), f"'result' should be a dict: {msg}"
    assert "protocolVersion" in result, f"Missing protocolVersion: {result}"
    assert "serverInfo" in result, f"Missing serverInfo: {result}"
