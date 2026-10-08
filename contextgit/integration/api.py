"""Authenticated merge-agent control surface."""

import os
import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel


class SettingsRequest(BaseModel):
    project: str
    harness: Literal["codex", "claude"]
    target: str
    checks: str
    authority: Literal["enabled", "paused", "disabled"]


def router(get_repo: Any) -> APIRouter:
    def authorize(request: Request) -> None:
        token = os.getenv("CONTEXTGIT_API_TOKEN", "")
        if not token or not secrets.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + token
        ):
            raise HTTPException(401, "Merge-agent APIs require the local backend token")

    routes = APIRouter(prefix="/api/v1/integration", dependencies=[Depends(authorize)])

    def call(operation: Any) -> Any:
        try:
            return operation()
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @routes.get("/settings")
    def settings(project: str) -> Any:
        return call(lambda: get_repo().integration.settings(project))

    @routes.put("/settings")
    def configure(body: SettingsRequest) -> Any:
        return call(lambda: get_repo().integration.configure(**body.model_dump()))

    @routes.get("/jobs")
    def jobs(project: str | None = None) -> Any:
        return get_repo().integration.jobs(project)

    @routes.post("/ready/{session_id}")
    def ready(session_id: str) -> Any:
        return call(lambda: get_repo().integration.ready(session_id))

    @routes.post("/jobs/{job_id}/cancel")
    def cancel(job_id: str) -> Any:
        return call(lambda: get_repo().integration.cancel(job_id))

    @routes.post("/jobs/{job_id}/retry")
    def retry(job_id: str) -> Any:
        return call(lambda: get_repo().integration.retry(job_id))

    return routes
