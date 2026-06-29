"""FastAPI application factory.

This module wires together all the pieces:
  - FastAPI with REST endpoints (health, version, OpenAPI docs)
  - MCP server mounted at /mcp for AI tool calling
  - Optional Bearer token authentication
  - Structured logging

Entry point for uvicorn: ``uvicorn app.main:app --host 0.0.0.0 --port 8000``
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.changelog import router as changelog_router
from app.api.health import router as health_router
from app.api.version import router as version_router
from app.auth import BearerTokenMiddleware
from app.config import Settings, get_settings
from app.limits import MaxBodySizeMiddleware, RateLimitMiddleware
from app.logging_setup import configure_logging
from app.mcp_server.server import create_mcp_server

logger = structlog.get_logger(__name__)

# Environments where running the HTTP server without auth is allowed.
_AUTH_OPTIONAL_ENVS = frozenset({"local", "dev", "test"})


class RootPathMiddleware:
    """Normalise the request path for reverse proxies that strip ``root_path``.

    If ROOT_PATH is set (e.g. /gir-router) but the incoming path does not start
    with it (because the proxy stripped it), this restores the prefix so
    FastAPI's root_path-based routing succeeds. If the proxy forwards the full
    path, it is left unchanged. This makes the service work behind gateways
    that strip the prefix AND those that don't.
    """

    def __init__(self, app: ASGIApp, root_path: str) -> None:
        self._app = app
        self._root_path = root_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket") and self._root_path:
            path = scope.get("path", "")
            if not path.startswith(self._root_path):
                scope["path"] = self._root_path + path
        await self._app(scope, receive, send)


def _enforce_auth_policy(settings: Settings) -> None:
    """Fail closed: refuse to start an unauthenticated HTTP server in prod.

    Only applies to the HTTP transport (this factory). The stdio entrypoint
    has no network surface and is unaffected.
    """
    if not settings.auth_enabled and settings.environment.lower() not in _AUTH_OPTIONAL_ENVS:
        raise RuntimeError(
            "Refusing to start the HTTP server without authentication in environment "
            f"'{settings.environment}'. Set AUTH_ENABLED=true and API_TOKEN, or run behind "
            "an authenticating gateway and set ENVIRONMENT to a dev value."
        )


def create_app() -> FastAPI:
    """Application factory. Creates and wires up FastAPI + MCP."""
    settings = get_settings()
    configure_logging(settings.log_level)
    _enforce_auth_policy(settings)

    mcp = create_mcp_server()
    # streamable_http_app() lazily creates the StreamableHTTPSessionManager.
    # Must be called here so mcp.session_manager is available for the lifespan.
    mcp_asgi = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Starlette does not run mounted sub-app lifespans automatically.
        # We manually run the session manager so its anyio task group is
        # initialised before the first MCP request arrives.
        async with mcp.session_manager.run():
            yield

    base = settings.base_path
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=f"{settings.app_name} — MCP server (FastAPI + MCP Streamable HTTP)",
        lifespan=lifespan,
        # root_path: extra prefix a reverse proxy strips before forwarding.
        root_path=settings.root_path,
        # Serve docs/OpenAPI under the same base_path as everything else.
        docs_url=f"{base}/docs",
        redoc_url=f"{base}/redoc",
        openapi_url=f"{base}/openapi.json",
    )

    app.include_router(health_router, prefix=base)
    app.include_router(version_router, prefix=base)
    app.include_router(changelog_router, prefix=base)

    # FastMCP owns its "/mcp" route internally; mount at base_path (or "/") so
    # the sub-app receives "/mcp" and its own route matches (no 307/404).
    app.mount(base or "/", mcp_asgi)

    # Middleware order: add_middleware wraps outermost-last, so the body-size
    # guard (added last) runs first, then rate limiting, then auth. A flood of
    # oversized or unauthenticated requests is rejected as early as possible.
    if settings.auth_enabled:
        app.add_middleware(
            BearerTokenMiddleware,
            api_token=settings.api_token.get_secret_value(),
            base_path=base,
            root_path=settings.root_path,
        )
        logger.info("auth.enabled")
    else:
        logger.warning("auth.disabled — do not expose beyond localhost")

    if settings.rate_limit_enabled:
        app.add_middleware(
            RateLimitMiddleware,
            max_requests=settings.rate_limit_requests,
            window_seconds=settings.rate_limit_window_seconds,
            base_path=base,
            root_path=settings.root_path,
        )
        logger.info(
            "ratelimit.enabled",
            max_requests=settings.rate_limit_requests,
            window_seconds=settings.rate_limit_window_seconds,
        )

    app.add_middleware(MaxBodySizeMiddleware, max_bytes=settings.max_body_bytes)

    # Outermost (added last → runs first): normalise the proxy prefix before
    # any other middleware inspects the path.
    app.add_middleware(RootPathMiddleware, root_path=settings.root_path)

    logger.info("app.created", name=settings.app_name, version=settings.app_version)
    return app


# Module-level instance for uvicorn: `uvicorn app.main:app`
app = create_app()
