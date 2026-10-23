"""Authenticated desktop project routing with isolated repository applications."""
from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
from collections import OrderedDict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from contextgit.api.cors import LocalAPI
from contextgit.core.errors import RepoNotFound
from contextgit.core.repo import Repo


class OpenProject(BaseModel):
    path: str


class ProjectEntry(TypedDict):
    repo: Repo
    app: ASGIApp
    requests: int


class ProjectRegistry:
    def __init__(self, token: str):
        self.token = token
        self.lock = asyncio.Lock()
        self.entries: OrderedDict[str, ProjectEntry] = OrderedDict()

    async def open(self, value: str) -> dict[str, str]:
        path = Path(value).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(400, "Choose an existing project folder.")
        root = path / ".contextgit"
        identity = hashlib.sha256(str(root).encode()).hexdigest()
        async with self.lock:
            if identity not in self.entries:
                def prepare() -> tuple[Repo, ASGIApp]:
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

    async def trim(self, keep: str) -> None:
        idle: list[str] = []
        for key, entry in self.entries.items():
            if key == keep or entry["requests"]:
                continue
            repo = entry["repo"]
            def is_busy(current: Repo = repo) -> bool:
                active_states = {"queued", "building", "reviewing", "checking", "publishing"}
                has_running_session = any(
                    session.status == "running" for session in current.list_sessions()
                )
                has_active_job = any(
                    job["state"] in active_states for job in current.integration.jobs()
                )
                return has_running_session or has_active_job

            busy = await asyncio.to_thread(is_busy)
            if not busy:
                idle.append(key)
        for key in idle[:-8]:
            if self.entries[key]["requests"]:
                continue
            entry = self.entries.pop(key)
            await asyncio.to_thread(entry["repo"].integration.stop)
            await asyncio.to_thread(entry["repo"]._storage.close)

    async def close(self) -> None:
        for entry in self.entries.values():
            await asyncio.to_thread(entry["repo"].integration.stop)
            await asyncio.to_thread(entry["repo"]._storage.close)
        self.entries.clear()


def create_desktop_app(token: str) -> ASGIApp:
    registry = ProjectRegistry(token)
    instance = uuid4().hex

    @asynccontextmanager
    async def lifespan(app: LocalAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await registry.close()

    root = LocalAPI(lifespan=lifespan)
    root.state.projects = registry

    @root.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "contextgit",
            "api_version": "1",
            "instance_id": instance,
        }

    @root.post("/api/v1/projects/open")
    async def open_project(body: OpenProject) -> dict[str, str]:
        return await registry.open(body.path)

    @root.websocket("/api/v1/terminal")
    async def terminal(websocket: WebSocket) -> None:
        """Stream one browser terminal without exposing an arbitrary shell API."""
        supplied = websocket.query_params.get("token", "")
        if not secrets.compare_digest(supplied, token):
            await websocket.close(code=4401)
            return
        project_id = websocket.query_params.get("project", "")
        entry = registry.entries.get(project_id)
        if entry is None:
            await websocket.close(code=4409)
            return
        await websocket.accept()
        process: asyncio.subprocess.Process | None = None
        try:
            message = await websocket.receive_json()
            if message.get("type") != "start":
                await websocket.close(code=4400)
                return
            project_root = Path(entry["repo"].root).parent.resolve()
            requested_cwd = Path(str(message.get("cwd") or project_root)).expanduser().resolve()
            allowed_roots = (project_root, project_root / ".contextgit")
            if not any(requested_cwd == root or root in requested_cwd.parents for root in allowed_roots):
                await websocket.send_json({"type": "error", "message": "Terminal directory is outside the selected project."})
                await websocket.close(code=4403)
                return
            command = str(message.get("command") or "shell")
            commands = {
                "shell": os.environ.get("SHELL", "sh"),
                "terminal": os.environ.get("SHELL", "sh"),
                "codex": "codex",
                "claude": "claude",
                "opencode": "opencode",
                "commandcode": "commandcode",
            }
            executable = commands.get(command, "")
            if not executable:
                await websocket.send_json({"type": "error", "message": "Unknown terminal command."})
                await websocket.close(code=4400)
                return
            env = os.environ.copy()
            supplied_env = message.get("env")
            if isinstance(supplied_env, dict):
                for key, value in supplied_env.items():
                    if isinstance(key, str) and key.startswith("CONTEXTGIT_") and isinstance(value, str):
                        env[key] = value
            process = await asyncio.create_subprocess_exec(
                executable,
                cwd=str(requested_cwd),
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            initial = message.get("input")
            if isinstance(initial, str) and initial and process.stdin:
                process.stdin.write(initial.encode())
                await process.stdin.drain()

            async def send_output() -> None:
                assert process and process.stdout
                while True:
                    chunk = await process.stdout.read(4096)
                    if not chunk:
                        break
                    await websocket.send_json({"type": "data", "data": chunk.decode(errors="replace")})

            output_task = asyncio.create_task(send_output())
            wait_task = asyncio.create_task(process.wait())
            try:
                while not wait_task.done():
                    receive_task = asyncio.create_task(websocket.receive_json())
                    done, _ = await asyncio.wait({receive_task, wait_task}, return_when=asyncio.FIRST_COMPLETED)
                    if wait_task in done:
                        receive_task.cancel()
                        break
                    incoming = receive_task.result()
                    kind = incoming.get("type")
                    if kind == "write" and process.stdin and isinstance(incoming.get("data"), str):
                        process.stdin.write(str(incoming["data"]).encode())
                        await process.stdin.drain()
                    elif kind == "kill":
                        process.terminate()
                        break
            except WebSocketDisconnect:
                if process.returncode is None:
                    process.terminate()
            finally:
                await output_task
            code = await wait_task
            await websocket.send_json({"type": "exit", "code": code})
        except WebSocketDisconnect:
            if process and process.returncode is None:
                process.terminate()
        except Exception as exc:
            if process and process.returncode is None:
                process.terminate()
            try:
                await websocket.send_json({"type": "error", "message": str(exc)})
            except Exception:
                pass

    class Dispatch:
        async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
            if scope["type"] != "http":
                return await root(scope, receive, send)
            headers = dict(scope.get("headers", []))
            if scope["method"] != "OPTIONS" and scope["path"] != "/api/v1/health":
                supplied = headers.get(b"authorization", b"").decode()
                if not secrets.compare_digest(supplied, f"Bearer {token}"):
                    return await JSONResponse({"error": "Unauthorized"}, 401)(scope, receive, send)
            if (
                scope["path"] in {"/api/v1/health", "/api/v1/projects/open"}
                or scope["method"] == "OPTIONS"
            ):
                return await root(scope, receive, send)
            key = headers.get(b"x-contextgit-project", b"").decode()
            entry = registry.entries.get(key)
            if entry is None:
                response = JSONResponse(
                    {
                        "error": "Project context is unavailable. Reload this project.",
                        "type": "ProjectNotOpen",
                    },
                    409,
                )
                return await response(scope, receive, send)
            entry["requests"] += 1
            registry.entries.move_to_end(key)
            try:
                await entry["app"](scope, receive, send)
            finally:
                entry["requests"] -= 1

    # Wrap dispatch errors as well as individual project routes with CORS.
    from starlette.middleware.cors import CORSMiddleware

    return CORSMiddleware(
        Dispatch(),
        allow_origins=os.getenv(
            "CONTEXTGIT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(","),
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-ContextGit-Repo",
            "X-ContextGit-Project",
        ],
    )
