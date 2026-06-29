"""HTTP Bearer token authentication middleware.

Applied at the ASGI level so it covers both the REST endpoints and the mounted
MCP sub-application. /healthz and /readyz are exempt so Kubernetes liveness and
readiness probes always work without credentials.

Enable by setting AUTH_ENABLED=true and API_TOKEN=<secret> in your .env file.
"""

from __future__ import annotations

import secrets
from typing import cast

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# Paths that bypass auth (infra probes + unprotected info endpoints).
_EXEMPT = frozenset(
    {
        "/healthz",
        "/readyz",
        "/version",
        "/changelog",
        "/openapi.json",
        "/docs",
        "/redoc",
    }
)


class BearerTokenMiddleware:
    """ASGI middleware enforcing a static Bearer token.

    - Constant-time comparison prevents timing-based token enumeration.
    - Non-HTTP ASGI scopes (lifespan, websocket) pass through unchanged.
    """

    def __init__(
        self, app: ASGIApp, api_token: str, base_path: str = "", root_path: str = ""
    ) -> None:
        self._app = app
        self._token = api_token.encode()
        self._root_path = root_path
        # Exempt paths are relative to the configured base_path (e.g. when the
        # service is served under "/nifmcp", "/nifmcp/healthz" is the probe).
        self._exempt = frozenset(f"{base_path}{p}" for p in _EXEMPT)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        # Strip the reverse-proxy prefix before matching exempt paths.
        path = cast(str, scope.get("path", ""))
        if self._root_path and path.startswith(self._root_path):
            path = path[len(self._root_path) :]
        if path in self._exempt:
            await self._app(scope, receive, send)
            return

        # Pass CORS preflight requests through — they never carry Authorization
        # headers and must not be blocked. The gateway or a CORS middleware
        # handles the actual preflight response.
        method = cast(str, scope.get("method", ""))
        if method == "OPTIONS":
            await self._app(scope, receive, send)
            return

        raw_headers = cast(list[tuple[bytes, bytes]], scope.get("headers", []))
        auth = dict(raw_headers).get(b"authorization", b"").decode()

        if not auth.startswith("Bearer ") or not secrets.compare_digest(
            auth[len("Bearer ") :].encode(), self._token
        ):
            response = JSONResponse(
                {"detail": "Unauthorized"},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
            await response(scope, receive, send)
            return

        await self._app(scope, receive, send)
