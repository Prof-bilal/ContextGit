"""Authenticated desktop project routing with isolated repository applications."""
from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
import subprocess
import sys
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


class CreateProject(BaseModel):
    parent: str
    name: str


def terminal_arguments(command: str, message: dict) -> list[str]:
    """Supply the initial task through the CLI, before its interactive UI starts."""
    args: list[str] = []
    model = message.get("model")
    if isinstance(model, str) and model and command in {"codex", "claude", "commandcode"}:
        args.extend(["--model", model])
    initial = message.get("input")
    if isinstance(initial, str) and initial and command in {"codex", "claude", "opencode", "commandcode"}:
        if command == "opencode":
            args.extend(["--prompt", initial])
        else:
            args.extend(["--", initial])
    return args


def choose_folder() -> str | None:
    """Open the host OS folder picker for the localhost browser app."""
    commands: list[list[str]] = []
    if os.name == "nt":
        commands.append([
            "powershell", "-NoProfile", "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){ $d.SelectedPath }",
        ])
    elif sys.platform == "darwin":
        commands.append(["osascript", "-e", "POSIX path of (choose folder with prompt \"Choose a ContextGit project folder\")"])
    else:
        commands.extend([
            ["zenity", "--file-selection", "--directory", "--title=Choose a ContextGit project folder"],
            ["kdialog", "--getexistingdirectory", str(Path.home())],
        ])
    for command in commands:
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=300)
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0 and result.stdout.strip():
            return str(Path(result.stdout.strip()).expanduser().resolve())
    # Keep Tk out of the API process. On Linux, creating a Tk root from a
    # worker thread can take over the interpreter's event loop and make the
    # browser appear frozen. Running it as a short-lived child also gives the
    # dialog a real GUI main thread and lets cancellation return cleanly.
    tkinter_script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk()\n"
        "root.withdraw()\n"
        "root.attributes('-topmost', True)\n"
        "selected = filedialog.askdirectory(title='Choose a ContextGit project folder')\n"
        "root.destroy()\n"
        "print(selected, flush=True)\n"
    )
    try:
        result = subprocess.run(
            [sys.executable, "-c", tkinter_script],
            capture_output=True,
            text=True,
            check=False,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode == 0 and result.stdout.strip():
        return str(Path(result.stdout.strip()).expanduser().resolve())
    return None


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
        # Project opens can arrive concurrently while the browser restores
        # its saved project and canvas state. Iterate over a stable snapshot
        # so trimming cannot fail if another lifecycle operation reorders the
        # registry during the checks below.
        for key, entry in list(self.entries.items()):
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

    @root.post("/api/v1/projects/choose")
    async def choose_project() -> dict[str, str | None]:
        return {"path": await asyncio.to_thread(choose_folder)}

    @root.post("/api/v1/projects/create")
    async def create_project(body: CreateProject) -> dict[str, str]:
        parent = Path(body.parent).expanduser().resolve()
        name = body.name.strip()
        if not parent.is_dir() or not name or Path(name).name != name or name in {".", ".."}:
            raise HTTPException(400, "Choose a valid parent folder and project name.")
        path = parent / name
        try:
            path.mkdir()
        except FileExistsError as exc:
            raise HTTPException(409, "That project folder already exists.") from exc
        return await registry.open(str(path))

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
        master: int | None = None
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
            # The desktop PTY is a real interactive terminal. Some launchers
            # inherit TERM=dumb, which makes Codex refuse to start its TUI
            # even though the browser terminal supports cursor control.
            if env.get("TERM", "").lower() in {"", "dumb"}:
                env["TERM"] = "xterm-256color"
            # The host may set NO_COLOR for its own command output, but that
            # would also disable ANSI styling inside the interactive browser
            # terminal. Advertise the capabilities of the PTY instead.
            env.pop("NO_COLOR", None)
            if not env.get("COLORTERM"):
                env["COLORTERM"] = "truecolor"
            slave: int | None = None
            if os.name != "nt":
                import pty
                master, slave = pty.openpty()
                import fcntl
                import struct
                import termios
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", int(message.get("rows", 30)), int(message.get("cols", 100)), 0, 0))
            try:
                arguments = terminal_arguments(command, message)
                launch = [executable, *arguments]
                if slave is not None:
                    # A session alone does not give the child a controlling
                    # terminal. TUIs need its foreground process group to
                    # receive SIGWINCH and redraw after resizing.
                    launch = [sys.executable, "-c",
                              "import os,sys,fcntl,termios; fcntl.ioctl(0,termios.TIOCSCTTY,0); os.execvpe(sys.argv[1],sys.argv[1:],os.environ)",
                              executable, *arguments]
                process = await asyncio.create_subprocess_exec(
                    *launch,
                    cwd=str(requested_cwd),
                    env=env,
                    stdin=slave if slave is not None else asyncio.subprocess.PIPE,
                    stdout=slave if slave is not None else asyncio.subprocess.PIPE,
                    stderr=slave if slave is not None else asyncio.subprocess.STDOUT,
                    start_new_session=os.name != "nt",
                )
            finally:
                if slave is not None:
                    os.close(slave)
            await websocket.send_json({"type": "ready"})
            initial = message.get("input")
            if command in {"shell", "terminal"} and isinstance(initial, str) and initial:
                if master is not None:
                    os.write(master, (initial + "\n").encode())
                elif process.stdin:
                    process.stdin.write((initial + "\n").encode())
                    await process.stdin.drain()

            async def send_output() -> None:
                assert process
                while True:
                    if master is not None:
                        loop = asyncio.get_running_loop()
                        available = loop.create_future()
                        def readable() -> None:
                            if not available.done():
                                available.set_result(None)
                        loop.add_reader(master, readable)
                        try:
                            await available
                            try:
                                chunk = os.read(master, 4096)
                            except OSError:
                                break
                        finally:
                            loop.remove_reader(master)
                    else:
                        assert process.stdout
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
                    if kind == "write" and isinstance(incoming.get("data"), str):
                        if master is not None:
                            os.write(master, incoming["data"].encode())
                        elif process.stdin:
                            process.stdin.write(incoming["data"].encode())
                            await process.stdin.drain()
                    elif kind == "resize" and master is not None:
                        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", max(1, min(500, int(incoming["rows"]))), max(1, min(500, int(incoming["cols"]))), 0, 0))
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
        finally:
            if master is not None:
                os.close(master)

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
                scope["path"] in {"/api/v1/health", "/api/v1/projects/open", "/api/v1/projects/choose", "/api/v1/projects/create"}
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
