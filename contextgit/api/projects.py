"""Authenticated desktop project routing with isolated repository applications."""
from __future__ import annotations

import asyncio
import hashlib
import secrets
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from contextgit.api.cors import LocalAPI
from contextgit.core.repo import Repo
from contextgit.core.errors import RepoNotFound


class OpenProject(BaseModel):
    path: str


class ProjectRegistry:
    def __init__(self, token: str):
        self.token = token
        self.lock = asyncio.Lock()
        self.entries: OrderedDict[str, dict] = OrderedDict()

    async def open(self, value: str) -> dict[str, str]:
        path = Path(value).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(400, "Choose an existing project folder.")
        root = path / ".contextgit"
        identity = hashlib.sha256(str(root).encode()).hexdigest()
        async with self.lock:
            if identity not in self.entries:
                def prepare():
                    from contextgit.api.app import create_app
                    try:
                        repo = Repo.open(root)
                    except RepoNotFound:
                        repo = Repo.init(root)
                    return repo, create_app(repo=repo, api_token=self.token)
                repo, app = await asyncio.to_thread(prepare)
                await asyncio.to_thread(repo.integration.start)
                self.entries[identity] = {"repo": repo, "app": app, "requests": 0}
            self.entries.move_to_end(identity)
            await self.trim(keep=identity)
        return {"projectId": identity, "repoId": identity, "path": str(path)}

    async def trim(self, keep: str):
        idle = []
        for key, entry in self.entries.items():
            if key == keep or entry["requests"]:
                continue
            repo = entry["repo"]
            busy = await asyncio.to_thread(lambda: (
                any(s.status == "running" for s in repo.list_sessions())
                or any(j["state"] in {"queued", "building", "reviewing", "checking", "publishing"} for j in repo.integration.jobs())
            ))
            if not busy:
                idle.append(key)
        for key in idle[:-8]:
            if self.entries[key]["requests"]:
                continue
            entry = self.entries.pop(key)
            await asyncio.to_thread(entry["repo"].integration.stop)
            await asyncio.to_thread(entry["repo"]._storage.close)

    async def close(self):
        for entry in self.entries.values():
            await asyncio.to_thread(entry["repo"].integration.stop)
            await asyncio.to_thread(entry["repo"]._storage.close)
        self.entries.clear()


def create_desktop_app(token: str) -> ASGIApp:
    registry = ProjectRegistry(token)
    instance = uuid4().hex

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            await registry.close()

    root = LocalAPI(lifespan=lifespan)
    root.state.projects = registry

    @root.get("/api/v1/health")
    def health():
        return {"status": "ok", "service": "contextgit", "api_version": "1", "instance_id": instance}

    @root.post("/api/v1/projects/open")
    async def open_project(body: OpenProject):
        return await registry.open(body.path)

    class Dispatch:
        async def __call__(self, scope: Scope, receive: Receive, send: Send):
            if scope["type"] != "http":
                return await root(scope, receive, send)
            headers = dict(scope.get("headers", []))
            if scope["method"] != "OPTIONS" and scope["path"] != "/api/v1/health":
                supplied = headers.get(b"authorization", b"").decode()
                if not secrets.compare_digest(supplied, f"Bearer {token}"):
                    return await JSONResponse({"error": "Unauthorized"}, 401)(scope, receive, send)
            if scope["path"] in {"/api/v1/health", "/api/v1/projects/open"} or scope["method"] == "OPTIONS":
                return await root(scope, receive, send)
            key = headers.get(b"x-contextgit-project", b"").decode()
            entry = registry.entries.get(key)
            if entry is None:
                return await JSONResponse({"error": "Project context is unavailable. Reload this project.", "type": "ProjectNotOpen"}, 409)(scope, receive, send)
            entry["requests"] += 1
            registry.entries.move_to_end(key)
            try:
                await entry["app"](scope, receive, send)
            finally:
                entry["requests"] -= 1

    # Wrap dispatch errors as well as individual project routes with CORS.
    from starlette.middleware.cors import CORSMiddleware
    import os
    return CORSMiddleware(Dispatch(), allow_origins=os.getenv("CONTEXTGIT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-ContextGit-Repo", "X-ContextGit-Project"])
