"""Launch the lightweight browser workbench."""

from __future__ import annotations

import json
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


# Fixed so the workbench always lives at the same address, which also keeps the
# browser's saved layout and project session (both origin-scoped). Both sit
# below the OS ephemeral range (49152+), so the OS never hands them out at random.
UI_PORT = 7417
API_PORT = 7418


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _require_free(port: int, flag: str) -> None:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            raise SystemExit(
                f"Port {port} is already in use. ContextGit may already be running; "
                f"otherwise choose another port with {flag}."
            ) from None


def run(*, port: int = UI_PORT, api_port: int = API_PORT, project: Path | None = None) -> None:
    """Start the local API and serve the existing renderer in a browser."""
    root = Path(__file__).resolve().parents[1]
    renderer = root / "web" / "dist"
    if not (renderer / "index.html").exists():
        renderer = Path(__file__).resolve().parent / "webui"
    if not (renderer / "index.html").exists():
        raise SystemExit(
            f"Web renderer is missing at {renderer}. Run `npm run web:build` first."
        )
    port = port or _free_port()
    api_port = api_port or _free_port()
    _require_free(port, "--port")
    _require_free(api_port, "--api-port")
    token = secrets.token_urlsafe(32)
    origin = f"http://127.0.0.1:{port}"
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    environment = os.environ.copy()
    environment.update(
        {
            "CONTEXTGIT_DESKTOP_PROJECTS": "1",
            "CONTEXTGIT_API_TOKEN": token,
            "CONTEXTGIT_PORT": str(api_port),
            "CONTEXTGIT_CORS_ORIGINS": ",".join(f"http://{host}" for host in sorted(hosts)),
        }
    )
    # The page gets this launch's API address and token in a script tag, so the
    # bare address (and bookmarks of it) always works. "<" is escaped so the
    # JSON cannot close the script element.
    bootstrap = json.dumps({"api": f"http://127.0.0.1:{api_port}", "token": token})
    bootstrap = bootstrap.replace("<", "\\u003c")
    index_html = (renderer / "index.html").read_text(encoding="utf-8").replace(
        "</head>", f"<script>window.__CONTEXTGIT__={bootstrap}</script></head>", 1
    ).encode("utf-8")
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

        def do_GET(self) -> None:
            if self.path.split("?", 1)[0].split("#", 1)[0] not in {"/", "/index.html"}:
                super().do_GET()
                return
            # Only hand the token to pages addressed as loopback. A DNS-rebinding
            # page reaches this port under its own host name and is refused.
            if self.headers.get("Host", "") not in hosts:
                self.send_error(403, "Open ContextGit at " + origin)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(index_html)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(index_html)

    server = ThreadingHTTPServer(("127.0.0.1", port), StaticHandler)
    selected = f"?project={quote(str(project.expanduser().resolve()))}" if project else ""
    url = f"{origin}/{selected}"
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
