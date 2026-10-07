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
# While the process lives we keep probing, so a watcher's restart is noticed.
_WATCH_INTERVAL = 2.0
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
# Fatal startup failures worth reporting instead of waiting out the timeout.
_FATAL_SIGNATURES = (
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "EADDRINUSE",
    "SyntaxError",
    "app crashed",
    "Traceback (most recent call last)",
    "MissingModuleException",
    "Cannot find package",
)
# A server that ignores PORT usually says which one it bound.
_ANNOUNCED_PORT = re.compile(
    r"(?:listening|running|started|ready|serving|url)[^\n]{0,60}?"
    r"(?:port\s*[:=]?\s*|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{2,5})\b",
    re.IGNORECASE,
)
_DATABASE_HINTS = ("database", "mongo", "redis", "postgres", "mysql", "sqlite", "kafka", "amqp")


def _is_database_line(line: str) -> bool:
    """Don't mistake a database port for the app's own listening port."""
    lowered = line.lower()
    return any(hint in lowered for hint in _DATABASE_HINTS)


def _explain_failure(line: str) -> str:
    """One plain sentence a user can act on, keeping the app's own words."""
    missing = re.search(r"Cannot find (?:module|package) ['\"]([^'\"]+)['\"]", line)
    if missing or "MODULE_NOT_FOUND" in line:
        what = f" It could not find {missing.group(1)}." if missing else ""
        return (
            f"Your server crashed on startup.{what} Check that the file exists and "
            "that the capitalisation matches."
        )
    if "EADDRINUSE" in line:
        port = re.search(r":(\d{2,5})", line)
        where = (
            f" Port {port.group(1)} is already in use."
            if port
            else " A port it needs is already in use."
        )
        return (
            f"Your server crashed on startup.{where} Stop whatever is using it, "
            "then start again."
        )
    if "SyntaxError" in line:
        return f"Your server has a syntax error, so it could not start: {line}"
    return f"Your server crashed on startup: {line}"


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


_SCRIPT_ORDER = ("dev", "start", "serve", "server", "api", "backend", "watch", "develop")
_SUBDIR_NAMES = ("backend", "server", "api", "web", "frontend", "service")
_NODE_ENTRIES = ("server.js", "index.js", "app.js", "server.mjs", "index.mjs", "server.ts")


def candidate_dirs(root: Path) -> list[Path]:
    """The project root first, then one level down where a server usually lives."""
    dirs = [root]
    for pattern in ("apps/*", "packages/*", "services/*"):
        dirs.extend(sorted(path for path in root.glob(pattern) if path.is_dir()))
    for name in _SUBDIR_NAMES:
        candidate = root / name
        if candidate.is_dir() and candidate not in dirs:
            dirs.append(candidate)
    return dirs


def _package_command(directory: Path) -> RunCommand | None:
    package = directory / "package.json"
    if not package.is_file():
        return None
    try:
        data = json.loads(package.read_text("utf-8", errors="replace"))
        scripts = data.get("scripts", {}) if isinstance(data, dict) else {}
    except (OSError, ValueError):
        scripts = {}
    if isinstance(scripts, dict):
        for name in _SCRIPT_ORDER:
            if name in scripts:
                return RunCommand(
                    command=f"{package_manager(directory)} run {name}",
                    cwd=str(directory),
                    source="package.json",
                )
    # No conventional script: a plain node server is still startable.
    for entry in _NODE_ENTRIES:
        candidate = directory / entry
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text("utf-8", errors="replace")
        except OSError:
            continue
        if ".listen(" in text:
            return RunCommand(
                command=f"node {entry}", cwd=str(directory), source="package.json"
            )
    return None


def _make_command(directory: Path) -> RunCommand | None:
    makefile = directory / "Makefile"
    if not makefile.is_file():
        return None
    text = makefile.read_text("utf-8", errors="replace")
    for target in ("dev", "serve", "start", "run"):
        if re.search(rf"^{target}\s*:", text, re.MULTILINE):
            return RunCommand(command=f"make {target}", cwd=str(directory), source="make")
    return None


def detect_run_command(project: Path | str) -> RunCommand | None:
    """The best guess at how to start this project, or None if we have nothing."""
    root = Path(project)
    override = os.environ.get("CONTEXTGIT_RUN_COMMAND")
    if override:
        return RunCommand(
            command=override, cwd=str(root), source="env", port=port_in_command(override)
        )

    for directory in candidate_dirs(root):
        if (directory / "manage.py").is_file():
            return RunCommand(
                command="python manage.py runserver", cwd=str(directory), source="django"
            )
        found = _package_command(directory) or _make_command(directory)
        if found:
            return found
        app_target = python_app_target(directory)
        if app_target:
            return RunCommand(
                command=f"python -m uvicorn {app_target} --host 127.0.0.1",
                cwd=str(directory),
                source="uvicorn",
            )
        if (directory / "go.mod").is_file():
            return RunCommand(command="go run .", cwd=str(directory), source="go")
        if (directory / "Cargo.toml").is_file():
            return RunCommand(command="cargo run", cwd=str(directory), source="rust")
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
        self._fatal: str | None = None
        self._announced_port: int | None = None

    # -- internals ---------------------------------------------------------

    def _note(self, line: str) -> None:
        """Watch the process log for a crash, or for the port it really bound."""
        if self._fatal is None:
            for signature in _FATAL_SIGNATURES:
                if signature in line:
                    self._fatal = line.strip()[:240]
                    break
        if self._announced_port is None and not _is_database_line(line):
            match = _ANNOUNCED_PORT.search(line)
            if match:
                self._announced_port = int(match.group(1))

    def _drain(self, process: subprocess.Popen[str]) -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            text = line.rstrip("\n")
            self._log.append(text)
            self._note(text)

    def _watch(self, process: subprocess.Popen[str]) -> None:
        """Keep probing while this process lives.

        Dev servers under a watcher (nodemon, uvicorn --reload) crash on start and
        then start for real once the code is fixed. Without this, a crash would
        leave the UI stuck on "crashed" forever.
        """
        while True:
            time.sleep(_WATCH_INTERVAL)
            if self._process is not process:
                return
            if process.poll() is not None:
                with self._lock:
                    self._healthy = False
                return
            if self._announced_port and self._announced_port != self._port:
                self._port = self._announced_port
            if self._port and self._probe(self._port):
                with self._lock:
                    if self._process is process:
                        self._healthy = True
                        self._error = None

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
            if self._fatal is not None:
                # It crashed; waiting out the timeout would only hide the reason.
                return
            # A server that ignored PORT tells us where it really is.
            if self._announced_port and self._announced_port != self._port:
                self._port = self._announced_port
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
                self._error = (
                    "No run command detected — type the command that starts this "
                    "project and ContextGit will remember it."
                )
                self._command = None
            else:
                # Detection knows which directory the server lives in (monorepos
                # often keep it one level down); run it there.
                run_cwd = Path(detected.cwd) if detected else root
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
                        cwd=run_cwd,
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
                    self._cwd = str(run_cwd)
                    self._started = utcnow()
                    threading.Thread(
                        target=self._drain, args=(self._process,), daemon=True
                    ).start()
                    threading.Thread(
                        target=self._watch, args=(self._process,), daemon=True
                    ).start()
                    deadline = time.monotonic() + _HEALTH_TIMEOUT

        # Waiting happens outside the lock: `status` takes it too.
        if deadline:
            self._wait_healthy(deadline)
            with self._lock:
                if not self._healthy:
                    process = self._process
                    if self._fatal is not None:
                        # The app's own error, said plainly.
                        self._error = _explain_failure(self._fatal)
                    elif process is not None and process.poll() is not None:
                        self._error = f"The server exited with code {process.returncode}."
                    else:
                        self._error = (
                            f"The server never answered on port {self._port}. "
                            "Check the log below for the reason."
                        )
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
