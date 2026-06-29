# --- builder ---
# ghcr.io/astral-sh/uv:python3.13-bookworm-slim bundles uv + CPython 3.13 on
# Debian bookworm-slim — no need to COPY uv from a separate image.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

WORKDIR /app

# Pre-compile .pyc files at build time for faster cold starts.
# copy mode avoids hard-link issues across image layers.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Layer the lock/manifest first so dependency installation is cached
# independently from application source changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache

COPY src ./src
RUN uv sync --frozen --no-dev --no-cache

# --- runtime ---
# python:3.13-slim is Debian bookworm-slim with CPython — lean and binary-compatible.
FROM python:3.13-slim

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Non-root user; no home directory needed inside the container.
RUN useradd --no-create-home --shell /usr/sbin/nologin appuser

# Copy only the installed venv and application source from the builder.
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

# Changelog is served at runtime by the /version and /changelog endpoints.
COPY CHANGELOG.md /app/CHANGELOG.md

# Entrypoint script — reads HOST/PORT/LOG_LEVEL from env vars at runtime.
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"

CMD ["/app/start.sh"]
