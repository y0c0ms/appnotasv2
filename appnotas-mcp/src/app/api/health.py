"""Health and readiness probe endpoints.

/healthz — liveness:  the process is running (used by Kubernetes to decide
            whether to restart the pod).
/readyz   — readiness: the server is ready to accept traffic (used by
            Kubernetes to decide whether to send requests to this pod).
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz", operation_id="get_healthz", summary="Liveness probe")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", operation_id="get_readyz", summary="Readiness probe")
async def readyz() -> dict[str, str]:
    return {"status": "ready"}
