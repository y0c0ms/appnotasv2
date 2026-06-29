#!/bin/sh
# Entrypoint for the container (and for local use).
# HOST, PORT, and LOG_LEVEL are read from environment variables (or .env
# locally) by pydantic-settings inside app/__main__.py — no hardcoded values.
set -eu
exec python -m app
