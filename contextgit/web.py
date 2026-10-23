"""Launch the lightweight browser workbench."""

from __future__ import annotations

import os
import secrets
import socket
import subprocess
import sys
import threading
from urllib.parse import quote
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run(*, port: int = 0, api_port: int = 0, project: Path | None = None) -> None:
    """Start the local API and serve the existing renderer in a browser."""
    root = Path(__file__).resolve().parents[1]
    renderer = root / "desktop" / "dist"
    if not (renderer / "index.html").exists():
        raise SystemExit(
            f"Web renderer is missing at {renderer}. Run `npm run desktop:web:build` first."
        )
    port = port or _free_port()
    api_port = api_port or _free_port()
    token = secrets.token_urlsafe(32)
    origin = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    environment.update(
        {
            "CONTEXTGIT_DESKTOP_PROJECTS": "1",
            "CONTEXTGIT_API_TOKEN": token,
            "CONTEXTGIT_PORT": str(api_port),
            "CONTEXTGIT_CORS_ORIGINS": origin,
        }
    )
    if project is not None:
        environment["CONTEXTGIT_WEB_PROJECT"] = str(project.expanduser().resolve())
    api = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "contextgit.api.main:app", "--host", "127.0.0.1", "--port", str(api_port)],
        cwd=root,
        env=environment,
    )

    class StaticHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=str(renderer), **kwargs)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), StaticHandler)
    selected = f"&project={quote(str(project.expanduser().resolve()))}" if project else ""
    url = f"{origin}/?api=http://127.0.0.1:{api_port}&token={token}{selected}"
    print(f"ContextGit web UI: {url}", flush=True)
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        api.terminate()
        try:
            api.wait(timeout=3)
        except subprocess.TimeoutExpired:
            api.kill()
