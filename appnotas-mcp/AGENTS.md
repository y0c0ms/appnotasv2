# AGENTS.md

Production-ready MCP server as a Kubernetes microservice, exposing domain tools over MCP Streamable HTTP to clients such as VS Code Copilot, Antigravity, OpenCode, and MCP Inspector. Make it also that it can be ran without being in a container
Make the code as simple as possible as this will be a teaching repository

Detailed code templates, examples, and client configs live in [docs/agent-reference.md](docs/agent-reference.md). Read it only when implementing the matching section.

## Stack (non-negotiable)

- Python 3.13+
- FastAPI (OpenAPI enabled)
- Official `mcp` Python SDK
- MCP **Streamable HTTP** transport only — no legacy HTTP+SSE
- Pydantic v2 + `pydantic-settings`
- `uv` as the exclusive package manager
- `.env` via `python-dotenv` / pydantic-settings
- Structured logging (stdout/stderr only)

## Transport rules

- Canonical MCP endpoint: `/mcp`
- Use `mcp.run(transport="streamable-http")` or `app.mount("/mcp", mcp.streamable_http_app())`
- Forbidden: `/sse`, `/messages`, `mcp.sse_app()`, custom SSE loops, raw ASGI SSE
- If the SDK exposes a newer Streamable HTTP helper, use it but keep the public path `/mcp`
- Don't add SSE for "backwards compatibility" unless explicitly requested

## Two surfaces

1. **MCP surface**: `POST/GET /mcp` — tools, resources, prompts (discovered via MCP protocol, not OpenAPI)
2. **HTTP surface**: `/healthz`, `/readyz`, `/version`, `/openapi.json`, `/docs`, `/redoc`

OpenAPI must remain enabled and document only the REST surface. Never try to model MCP itself in OpenAPI.

## Configuration

- All env vars centralized in `src/app/config.py` via `pydantic-settings`. Never call `os.environ` elsewhere.
- Load `.env` locally; provide `.env.example`. Never commit real secrets.
- Don't bake environment-specific values into the image.

## MCP server design

- Default `stateless_http=True` for Kubernetes friendliness.
- If state is required, document storage, sticky-session needs, cleanup, and rolling-deploy behavior.
- Tools: verb-based names, typed params, Pydantic models for structured I/O, JSON-serializable deterministic results, input validation, no hidden globals, no leaked exceptions.
- Every tool docstring states: purpose, when to use, constraints, result meaning.
- Use **resources** for read-only context, **prompts** for reusable templates, **tools** for parameterized/side-effecting operations.
- Start every project with a `ping` smoke-test tool.

## REST endpoint rules

Each endpoint declares: `response_model` (where useful), `operation_id`, `tags`, `summary`.

## Logging & errors

- Structured logs to stdout/stderr; never to files inside the container.
- Include: timestamp, level, logger, message, request ID, tool name, duration for slow ops.
- Never log secrets, tokens, auth headers, or full sensitive payloads.
- Don't expose stack traces to MCP clients — convert domain errors to clean structured results, log details server-side.
- Avoid bare `except Exception` without re-raise or log.

## Security

- Bearer token auth is implemented via `BearerTokenMiddleware` in `src/app/auth.py`.
  Enable with `AUTH_ENABLED=true` + `API_TOKEN=<secret>` in `.env`.
  `/healthz` and `/readyz` are exempt so infra probes always work.
- Never commit `.env`; rotate `API_TOKEN` before exposing beyond localhost.
- For production prefer OAuth/OIDC or a gateway (e.g. Kong, Envoy) in front.
- Never pass tokens via query strings. Never ship `AUTH_ENABLED=false` in production.
- Destructive tools must be explicit in name, docstring, and require validated parameters.

## Code style

- `from __future__ import annotations`, type hints everywhere
- Async I/O for network; `httpx.AsyncClient` for outbound HTTP
- Small functions, explicit exceptions, dependency injection
- Forbidden: global mutable state, sync blocking I/O inside async, untyped dicts for complex payloads, magic strings, framework hacks that reduce MCP compatibility

## Kubernetes *(optional — do not create manifests unless explicitly requested)*

- Listen on `0.0.0.0:8000`, `containerPort: 8000`
- Liveness `/healthz`, readiness `/readyz`
- Non-root container, drop all caps, no privilege escalation
- Resource requests + limits; env from ConfigMaps/Secrets
- Stateless by default for multi-replica
- Ingress must preserve long requests, body size, timeouts, TLS, and `/mcp` path

## Testing

- `pytest` with `pytest-asyncio`
- Cover REST endpoints AND MCP tool registration + invocation
- Minimum: `tests/test_health.py` (200 for `/healthz`, `/readyz`, `/version`, `/openapi.json`), `tests/test_mcp_tools.py` (server starts, tools registered, smoke tool callable, stable output shape)
- Test MCP tools through the SDK client where possible — don't rely on manual VS Code testing.

## Local run

```bash
# reads HOST / PORT / LOG_LEVEL from .env
uv run python -m app

# or via the installed script
uv run serve

# explicit override (bypasses .env for host/port)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

MCP: `http://localhost:8000/mcp` · Docs: `http://localhost:8000/docs`

## Pre-commit gates

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src tests
uv run pytest
```

Work is not complete if any of these fail.

## Implementation order

1. config → 2. logging → 3. FastAPI app → 4. health/version → 5. MCP server → 6. smoke tool → 7. expose `/mcp` via Streamable HTTP → 8. tests → 9. Dockerfile → 10. VS Code MCP config → 11. README

## README requirement

Every change must be reflected in `README.md`. The README must always document:

- project purpose
- local setup (uv, Python version)
- `.env` setup and variables
- run command
- MCP endpoint (`/mcp`)
- OpenAPI endpoints (`/docs`, `/openapi.json`)
- `.vscode/mcp.json` example
- MCP Inspector test steps
- Docker build/run commands
- Kubernetes deployment notes
- authentication status
- known client compatibility notes
- any new tool, resource, prompt, endpoint, env var, or operational change introduced by the task

A PR/commit is not done if README is out of date relative to the code.

## CHANGELOG requirement

Every relevant change, bug fix, feature addition, or configuration update must be documented in `CHANGELOG.md` under the appropriate version before completing a task or submitting a commit. The running app reads its version from the top entry of `CHANGELOG.md`, so the changelog is the single source of truth for the version.

## Definition of done

App starts locally · `/healthz`, `/readyz`, `/docs`, `/openapi.json` return 200 · `/mcp` reachable by an MCP client · at least one MCP tool listed and callable · tests / lint / type checks pass · container image builds · README updated.

## Hard "do nots"

- Don't downgrade to HTTP+SSE
- Don't replace FastAPI or the official MCP SDK
- Don't remove OpenAPI
- Don't build only a stdio MCP server
- Don't hardcode local paths, tokens, or env-specific URLs
- Don't assume a single replica unless statefulness requires it (and document it)

Keep the project boring, typed, testable, container-friendly, and compatible with modern MCP clients.
