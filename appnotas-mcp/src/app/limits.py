"""HTTP request-limit middleware: rate limiting and body-size capping.

Applied at the ASGI level so they cover both the REST endpoints and the
mounted MCP sub-application. /healthz and /readyz are exempt so infra probes
are never throttled.

These guards only exist on the HTTP transport. The stdio entrypoint
(`app.stdio`) has no network surface, so neither applies there.
"""

from __future__ import annotations

import hashlib
import time
from typing import cast

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# Probe endpoints must never be rate-limited or size-checked.
_EXEMPT_PATHS = frozenset({"/healthz", "/readyz"})


class MaxBodySizeMiddleware:
    """Reject HTTP requests whose declared Content-Length is too large (413).

    This is a cheap header check. Requests using chunked transfer encoding
    without a Content-Length are passed through; cap those at the gateway if
    that is a concern in your deployment.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self._app = app
        self._max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        headers = dict(cast(list[tuple[bytes, bytes]], scope.get("headers", [])))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self._max_bytes:
                    response = JSONResponse({"detail": "Request body too large"}, status_code=413)
                    await response(scope, receive, send)
                    return
            except ValueError:
                pass  # malformed header — let the server handle it

        await self._app(scope, receive, send)


class RateLimitMiddleware:
    """Fixed-window, in-memory rate limit per client (token hash or IP).

    NOTE: state is per-process. With multiple replicas, each enforces the
    limit independently — use a shared store or gateway limiter for a global
    limit. Keyed by a hash of the Authorization header when present, else the
    client IP, so the raw token is never stored.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_requests: int,
        window_seconds: float,
        base_path: str = "",
        root_path: str = "",
    ) -> None:
        self._app = app
        self._max = max_requests
        self._window = window_seconds
        self._root_path = root_path
        self._buckets: dict[str, tuple[float, int]] = {}
        self._exempt = frozenset(f"{base_path}{p}" for p in _EXEMPT_PATHS)

    def _client_key(self, scope: Scope) -> str:
        headers = dict(cast(list[tuple[bytes, bytes]], scope.get("headers", [])))
        auth = headers.get(b"authorization")
        if auth:
            return "tok:" + hashlib.sha256(auth).hexdigest()[:16]
        client = scope.get("client")
        return "ip:" + (client[0] if client else "unknown")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        path = cast(str, scope.get("path", ""))
        if self._root_path and path.startswith(self._root_path):
            path = path[len(self._root_path) :]
        if path in self._exempt:
            await self._app(scope, receive, send)
            return

        key = self._client_key(scope)
        now = time.monotonic()
        window_start, count = self._buckets.get(key, (now, 0))
        if now - window_start >= self._window:
            window_start, count = now, 0
        count += 1
        self._buckets[key] = (window_start, count)

        if count > self._max:
            retry_after = max(1, int(self._window - (now - window_start)))
            response = JSONResponse(
                {"detail": "Rate limit exceeded"},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
            await response(scope, receive, send)
            return

        await self._app(scope, receive, send)
