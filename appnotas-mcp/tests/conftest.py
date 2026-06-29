"""Shared pytest fixtures.

All fixtures defined here are automatically available to every test file.
The ``client`` fixture provides a pre-configured HTTP test client so
individual tests do not need to create the FastAPI app themselves.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Iterator[None]:
    """Reset the settings LRU cache before and after every test.

    This ensures tests that patch environment variables always see
    fresh Settings instances instead of a stale cached value.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    """HTTP test client for the full FastAPI application.

    The base_url must be a loopback address WITH a port number.
    The MCP SDK's DNS-rebinding protection only allows hosts matching
    ``localhost:*`` or ``127.0.0.1:*``; bare ``localhost`` (no port)
    and the httpx default ``testserver`` are both rejected with HTTP 421.
    """
    with patch.dict(os.environ, {"AUTH_ENABLED": "false"}):
        get_settings.cache_clear()
        with TestClient(create_app(), base_url="http://localhost:8000") as c:
            yield c
