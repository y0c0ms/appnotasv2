"""Tests for the REST health and metadata endpoints.

Covers: /healthz, /readyz, /version, and /openapi.json.
These are always the first tests to run — if they fail, something is
fundamentally broken with the app startup or routing.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz(client: TestClient) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_readyz(client: TestClient) -> None:
    resp = client.get("/readyz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ready"}


def test_version(client: TestClient) -> None:
    resp = client.get("/version")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.text.strip()  # non-empty version string


def test_version_matches_changelog(client: TestClient) -> None:
    version_resp = client.get("/version")
    changelog_resp = client.get("/changelog")
    assert version_resp.status_code == 200
    assert changelog_resp.status_code == 200
    # The version returned by /version must appear in the changelog body.
    assert version_resp.text.strip() in changelog_resp.text


def test_changelog(client: TestClient) -> None:
    resp = client.get("/changelog")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert "## [" in resp.text  # at least one version heading


def test_openapi(client: TestClient) -> None:
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
