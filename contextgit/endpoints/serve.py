"""Boot the project's own dev server so generated tests can hit it.

Detection is a guess, so the app always shows the command it is about to run and
lets the user replace it. Nothing here starts without an explicit call.
"""

from __future__ import annotations

import ast
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from contextgit.core.models import RunCommand, ServerStatus, utcnow

_LOG_LINES = 400
_SHOWN_LINES = 80
_HEALTH_TIMEOUT = 60.0
_HEALTH_INTERVAL = 0.4
_SKIP_DIRS = {
    ".git",
    ".contextgit",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".next",
}
_PORT_IN_COMMAND = re.compile(r"(?:--port[= ]|:)(\d{2,5})\b")


def free_port() -> int:
    """An unused localhost port."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def port_in_command(command: str) -> int | None:
    """The port a command names itself, if it names one."""
    match = _PORT_IN_COMMAND.search(command)
    return int(match.group(1)) if match else None


def package_manager(project: Path) -> str:
    """The package manager the lockfile implies (npm when nothing says otherwise)."""
    if (project / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (project / "yarn.lock").exists():
        return "yarn"
    if (project / "bun.lockb").exists() or (project / "bun.lock").exists():
        return "bun"
    return "npm"


def _module_name(root: Path, path: Path) -> str:
    """Import path for a file: `app/main.py` in a project → `app.main`."""
    relative = path.relative_to(root).with_suffix("")
    parts = list(relative.parts)
    if parts and parts[0] in {"src", "app"} and (root / "src").exists() and parts[0] == "src":
        parts = parts[1:]
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def python_app_target(root: Path) -> str | None:
    """`module:attr` for a FastAPI/Flask app instance, when the project has one."""
    for path in sorted(root.rglob("*.py")):
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        try:
            tree = ast.parse(path.read_text("utf-8", errors="replace"))
        except (SyntaxError, ValueError, OSError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            func = node.value.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if name not in {"FastAPI", "Flask"}:
                continue
            for target in node.targets:
                if isinstance(target, ast.Name):
                    return f"{_module_name(root, path)}:{target.id}"
    return None


def detect_run_command(project: Path | str) -> RunCommand | None:
    """The best guess at how to start this project, or None if we have nothing."""
    root = Path(project)
    override = os.environ.get("CONTEXTGIT_RUN_COMMAND")
    if override:
        return RunCommand(
            command=override, cwd=str(root), source="env", port=port_in_command(override)
        )

    package = root / "package.json"
    if package.is_file():
        try:
            data = json.loads(package.read_text("utf-8", errors="replace"))
            scripts = data.get("scripts", {}) if isinstance(data, dict) else {}
        except (OSError, ValueError):
            scripts = {}
        if isinstance(scripts, dict):
            for name in ("dev", "start", "serve"):
                if name in scripts:
                    return RunCommand(
                        command=f"{package_manager(root)} run {name}",
                        cwd=str(root),
                        source="package.json",
                    )

    makefile = root / "Makefile"
    if makefile.is_file():
        text = makefile.read_text("utf-8", errors="replace")
        for target in ("dev", "serve"):
            if re.search(rf"^{target}\s*:", text, re.MULTILINE):
                return RunCommand(command=f"make {target}", cwd=str(root), source="make")

    if (root / "manage.py").is_file():
        return RunCommand(command="python manage.py runserver", cwd=str(root), source="django")

    app_target = python_app_target(root)
    if app_target:
        return RunCommand(
            command=f"python -m uvicorn {app_target} --host 127.0.0.1",
            cwd=str(root),
            source="uvicorn",
        )

    if (root / "go.mod").is_file():
        return RunCommand(command="go run .", cwd=str(root), source="go")
    if (root / "Cargo.toml").is_file():
        return RunCommand(command="cargo run", cwd=str(root), source="rust")
    return None


class ServerSupervisor:
    """One dev server process, with a log ring buffer the UI can tail."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._log: deque[str] = deque(maxlen=_LOG_LINES)
        self._command: str | None = None
        self._cwd: str | None = None
        self._port: int | None = None
        self._started: datetime | None = None
        self._error: str | None = None
        self._healthy = False

    # -- internals ---------------------------------------------------------

    def _drain(self, process: subprocess.Popen[str]) -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            self._log.append(line.rstrip("\n"))

    def _probe(self, port: int) -> bool:
        try:
            httpx.get(
                f"http://127.0.0.1:{port}/", timeout=1.0, follow_redirects=False, trust_env=False
            )
            return True
        except httpx.HTTPError:
            return False

    def _stop_locked(self) -> None:
        process = self._process
        self._process = None
        self._healthy = False
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            process.wait(timeout=5)
        except (ProcessLookupError, PermissionError):
            return
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                return

    def _wait_healthy(self, deadline: float) -> None:
        while time.monotonic() < deadline:
            process = self._process
            if process is None or process.poll() is not None:
                return
            if self._port and self._probe(self._port):
                self._healthy = True
                return
            time.sleep(_HEALTH_INTERVAL)

    # -- public ------------------------------------------------------------

    def start(
        self, project: Path | str, command: str | None = None, port: int | None = None
    ) -> ServerStatus:
        """Start the project's server (or the given command) and wait for it to answer."""
        root = Path(project)
        deadline = 0.0
        with self._lock:
            self._stop_locked()
            self._log.clear()
            self._error = None
            detected = detect_run_command(root)
            chosen = command or (detected.command if detected else None)
            if not chosen:
                self._error = "No run command detected — set one for this project."
                self._command = None
            else:
                self._port = port or port_in_command(chosen) or free_port()
                if "manage.py runserver" in chosen and not port_in_command(chosen):
                    chosen = f"{chosen} 127.0.0.1:{self._port}"
                env = {
                    **os.environ,
                    "PORT": str(self._port),
                    "API_BASE_URL": f"http://127.0.0.1:{self._port}",
                }
                try:
                    self._process = subprocess.Popen(
                        chosen,
                        cwd=root,
                        shell=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        env=env,
                        start_new_session=True,
                    )
                except OSError as exc:
                    self._process = None
                    self._error = str(exc)
                else:
                    self._command = chosen
                    self._cwd = str(root)
                    self._started = utcnow()
                    threading.Thread(target=self._drain, args=(self._process,), daemon=True).start()
                    deadline = time.monotonic() + _HEALTH_TIMEOUT

        # Waiting happens outside the lock: `status` takes it too.
        if deadline:
            self._wait_healthy(deadline)
            with self._lock:
                if not self._healthy:
                    process = self._process
                    if process is not None and process.poll() is not None:
                        self._error = f"The server exited with code {process.returncode}."
                    elif self._error is None:
                        self._error = f"The server did not answer on port {self._port} in time."
        return self.status(root)

    def stop(self) -> ServerStatus:
        """Stop the server (whole process group) and report where it left off."""
        with self._lock:
            self._stop_locked()
            self._started = None
        return self.status()

    def status(self, project: Path | str | None = None) -> ServerStatus:
        """The current server state, with the tail of its log."""
        with self._lock:
            process = self._process
            running = process is not None and process.poll() is None
            exit_code = process.returncode if process is not None and not running else None
            detected = detect_run_command(project) if project else None
            return ServerStatus(
                running=running,
                healthy=running and self._healthy,
                command=self._command,
                cwd=self._cwd,
                port=self._port,
                url=f"http://127.0.0.1:{self._port}" if self._port else None,
                started_at=self._started,
                exit_code=exit_code,
                error=self._error,
                log=list(self._log)[-_SHOWN_LINES:],
                detected=detected,
            )


_supervisor: ServerSupervisor | None = None


def supervisor() -> ServerSupervisor:
    """The app's single dev-server supervisor."""
    global _supervisor  # noqa: PLW0603 — one server per app instance
    if _supervisor is None:
        _supervisor = ServerSupervisor()
    return _supervisor


_LIVE_SPEC_PATHS = ("/openapi.json", "/docs-json", "/swagger.json", "/v3/api-docs")


def fetch_live_openapi(base_url: str) -> dict[str, Any] | None:
    """The running server's own OpenAPI document, when it serves one."""
    for suffix in _LIVE_SPEC_PATHS:
        try:
            response = httpx.get(f"{base_url}{suffix}", timeout=3.0, trust_env=False)
        except httpx.HTTPError:
            continue
        if response.status_code != 200:
            continue
        try:
            document = response.json()
        except ValueError:
            continue
        if isinstance(document, dict) and isinstance(document.get("paths"), dict):
            return document
    return None
