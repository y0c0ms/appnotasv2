"""Structured logging configuration.

Configures the ``structlog`` library to emit JSON-formatted log records to a
chosen stream. JSON logs are easy to ingest by log aggregators (Datadog, Loki,
etc.). All log output goes to stdout/stderr — never to files inside the
container.

The HTTP app logs to stdout (the container convention). The stdio entrypoint
MUST log to stderr instead: on the stdio transport, stdout is reserved for the
MCP JSON-RPC stream, and any stray log line there corrupts the protocol.
"""

from __future__ import annotations

import logging
import sys
from typing import TextIO

import structlog


def configure_logging(log_level: str = "INFO", stream: TextIO | None = None) -> None:
    """Configure structured JSON logging to ``stream`` (default stdout)."""
    level = getattr(logging, log_level.upper(), logging.INFO)

    logging.basicConfig(
        format="%(message)s",
        stream=stream or sys.stdout,
        level=level,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.JSONRenderer(),
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
