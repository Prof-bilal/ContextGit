"""Phase B: detecting and booting the project's server, then its generated tests."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from contextgit.core.models import Endpoint, EndpointSource, Message
from contextgit.endpoints import (
    ServerSupervisor,
    detect_run_command,
    discover,
    generate_for_endpoint,
    remembered,
    run_suite,
)
from contextgit.endpoints import TestStore as Store
from contextgit.endpoints.serve import fetch_live_openapi, free_port, python_app_target
from contextgit.endpoints.tests import validate_source

FASTAPI_APP = '''\
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
'''

GENERATED = '''\
import os

import httpx


def test_health_ok() -> None:
    base = os.environ["API_BASE_URL"]
    response = httpx.get(f"{base}/health", timeout=10)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_is_json() -> None:
    base = os.environ["API_BASE_URL"]
    response = httpx.get(f"{base}/health", timeout=10)
    assert response.headers["content-type"].startswith("application/json")
'''


class StubAdapter:
    """A provider that returns whatever source we hand it."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.calls = 0

    def complete(self, messages: list[Message], **options: object) -> str:
        self.calls += 1
        return self.source


def fastapi_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text(FASTAPI_APP)
    return project


def git(project: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=project, check=True, capture_output=True)


def uvicorn_command(port: int) -> str:
    return f"{sys.executable} -m uvicorn app:app --host 127.0.0.1 --port {port}"


# ---------------------------------------------------------------- detection --


def test_package_scripts_win_and_respect_the_lockfile(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"scripts": {"dev": "vite", "test": "vitest"}}')
    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "npm run dev"
    assert detected.source == "package.json"

    (tmp_path / "pnpm-lock.yaml").write_text("")
    again = detect_run_command(tmp_path)
    assert again is not None and again.command == "pnpm run dev"


def test_makefile_target_is_used_when_there_is_no_package_json(tmp_path: Path) -> None:
    (tmp_path / "Makefile").write_text("dev:\n\tpython -m app\n")
    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "make dev"
    assert detected.source == "make"


def test_django_and_uvicorn_targets(tmp_path: Path) -> None:
    (tmp_path / "manage.py").write_text("# django\n")
    django = detect_run_command(tmp_path)
    assert django is not None and django.source == "django"

    other = tmp_path / "fast"
    other.mkdir()
    (other / "app.py").write_text(FASTAPI_APP)
    assert python_app_target(other) == "app:app"
    detected = detect_run_command(other)
    assert detected is not None
    assert detected.command == "python -m uvicorn app:app --host 127.0.0.1"


def test_env_override_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTEXTGIT_RUN_COMMAND", "docker compose up")
    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "docker compose up"
    assert detected.source == "env"


def test_unknown_project_has_no_run_command(tmp_path: Path) -> None:
    assert detect_run_command(tmp_path) is None


# ------------------------------------------------------------------ serving --


def test_supervisor_boots_a_real_server_and_stops_it(tmp_path: Path) -> None:
    project = fastapi_project(tmp_path)
    port = free_port()
    supervisor = ServerSupervisor()
    try:
        status = supervisor.start(project, command=uvicorn_command(port))
        assert status.running is True
        assert status.healthy is True
        assert status.url == f"http://127.0.0.1:{port}"
        assert status.port == port
        assert httpx.get(f"{status.url}/health", timeout=5).json() == {"status": "ok"}

        # The live spec is what the process actually serves.
        spec = fetch_live_openapi(str(status.url))
        assert spec is not None and "/health" in spec["paths"]

        assert status.log, "the process log should have been captured"
    finally:
        stopped = supervisor.stop()
    assert stopped.running is False


def test_start_without_a_runnable_project_reports_why(tmp_path: Path) -> None:
    supervisor = ServerSupervisor()
    status = supervisor.start(tmp_path)
    assert status.running is False
    assert status.error is not None


def test_exited_process_is_reported_as_an_error(tmp_path: Path) -> None:
    supervisor = ServerSupervisor()
    status = supervisor.start(tmp_path, command="exit 3")
    assert status.running is False
    assert status.error is not None


# ------------------------------------------------------------- generated tests --


def test_validate_source_rejects_tests_that_do_not_assert() -> None:
    from contextgit.core.errors import ProviderConfigError

    with pytest.raises(ProviderConfigError):
        validate_source("import httpx\n\ndef test_nothing() -> None:\n    pass\n")
    with pytest.raises(ProviderConfigError):
        validate_source("import subprocess\nimport httpx\n\ndef test_x() -> None:\n    assert True\n")
    assert validate_source(GENERATED)


def test_generate_run_and_remember_endpoint_tests(tmp_path: Path) -> None:
    project = fastapi_project(tmp_path)
    git(project, "init", "-q", "-b", "main")
    git(project, "config", "user.email", "t@example.com")
    git(project, "config", "user.name", "t")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "add health")

    port = free_port()
    supervisor = ServerSupervisor()
    supervisor.start(project, command=uvicorn_command(port))
    base_url = f"http://127.0.0.1:{port}"
    try:
        graph = discover(project)
        endpoint = graph.endpoints[0]
        assert endpoint.id == "get /health"

        adapter = StubAdapter(GENERATED)
        entry, overwrote, failure = generate_for_endpoint(
            project, endpoint, adapter=adapter, model="stub", base_url=base_url, validate=True
        )
        assert failure is None
        assert entry.status == "pass"
        assert entry.verified_at_commit is not None
        assert overwrote is False
        assert (project / entry.file).is_file()
        assert entry.tests == ["test_health_ok", "test_health_is_json"]

        # The manifest is the cache; the file is the source of truth.
        suite = remembered(project)
        assert [item.status for item in suite.files] == ["pass"]

        rerun = run_suite(project, base_url)
        assert rerun.passed == 2
        assert rerun.failed == 0

        # Regenerating replaces the file and says so.
        again, overwrote_again, _ = generate_for_endpoint(
            project, endpoint, adapter=adapter, model="stub", base_url=base_url, validate=True
        )
        assert overwrote_again is True
        assert Store(project).load().files[0].endpoint_id == endpoint.id
        assert again.file == entry.file
    finally:
        supervisor.stop()


def test_manifest_lists_test_files_added_outside_the_app(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "tests" / "api").mkdir(parents=True)
    (project / "tests" / "api" / "test_handmade.py").write_text("def test_ok():\n    assert True\n")
    suite = remembered(project)
    assert [item.file for item in suite.files] == ["tests/api/test_handmade.py"]
    assert suite.files[0].status == "untested"


def test_endpoint_without_a_handler_has_no_excerpt(tmp_path: Path) -> None:
    from contextgit.endpoints.tests import handler_excerpt

    endpoint = Endpoint(id="get /x", method="GET", path="/x", source=EndpointSource(kind="manual"))
    assert "not available" in handler_excerpt(tmp_path, endpoint)


def test_validate_source_refuses_hardcoded_hosts_and_missing_env() -> None:
    from contextgit.core.errors import ProviderConfigError

    # A fixed host can silently point at somebody else's service.
    hardcoded = (
        "import os\n\nimport httpx\n\n\n"
        'BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000")\n\n\n'
        "def test_x() -> None:\n"
        '    assert httpx.get(f"{BASE}/x").status_code == 200\n'
    )
    with pytest.raises(ProviderConfigError, match="hard-code"):
        validate_source(hardcoded)

    with pytest.raises(ProviderConfigError, match="API_BASE_URL"):
        validate_source("import httpx\n\n\ndef test_x() -> None:\n    assert True\n")


def test_generate_without_a_server_writes_the_file_but_skips_validation(
    tmp_path: Path,
) -> None:
    project = fastapi_project(tmp_path)
    endpoint = discover(project).endpoints[0]
    entry, _, failure = generate_for_endpoint(
        project,
        endpoint,
        adapter=StubAdapter(GENERATED),
        model="stub",
        base_url=None,
        validate=True,
    )
    assert failure is None
    # Nothing was run, and we say so rather than inventing a result.
    assert entry.status == "untested"
    assert entry.ran_at is None
    assert (project / entry.file).is_file()


def test_run_without_a_server_is_refused(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from contextgit.api.app import create_app
    from contextgit.core.repo import Repo
    from contextgit.llm.fake import FakeProvider

    repo = Repo.init(tmp_path / "repo")
    (tmp_path / "tests" / "api").mkdir(parents=True)
    (tmp_path / "tests" / "api" / "test_x.py").write_text(
        "def test_ok():\n    assert True\n"
    )
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))
    response = client.post(
        "/api/v1/endpoints/tests/run", json={"project_path": str(tmp_path)}
    )
    assert response.status_code == 409
    assert "no server is running" in response.json()["error"]


def test_monorepo_server_is_found_one_level_down_with_its_own_cwd(
    tmp_path: Path,
) -> None:
    # A workspace root whose scripts say nothing about running a server.
    (tmp_path / "package.json").write_text('{"scripts": {"build": "turbo build"}}')
    api = tmp_path / "apps" / "api"
    api.mkdir(parents=True)
    (api / "package.json").write_text('{"scripts": {"dev": "tsx src/server.ts"}}')

    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "npm run dev"
    # The command has to run where the server lives, not at the workspace root.
    assert detected.cwd == str(api)


def test_unconventional_script_names_are_still_startable(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        '{"scripts": {"server": "tsx src/main.ts"}}'
    )
    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "npm run server"


def test_plain_node_server_without_scripts_is_startable(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"name": "x"}')
    (tmp_path / "server.js").write_text(
        "const express = require('express');\nconst app = express();\napp.listen(3000);\n"
    )
    detected = detect_run_command(tmp_path)
    assert detected is not None
    assert detected.command == "node server.js"


def test_crash_on_startup_reports_the_apps_own_error(tmp_path: Path) -> None:
    import time

    # nodemon-style: the wrapper process stays alive while the app inside dies.
    (tmp_path / "crash.py").write_text(
        "import time\n"
        "print(\"Error: Cannot find module '../controllers/userController'\")\n"
        "time.sleep(30)\n"
    )
    supervisor = ServerSupervisor()
    started = time.monotonic()
    try:
        status = supervisor.start(tmp_path, command=f"{sys.executable} -u crash.py")
        elapsed = time.monotonic() - started
    finally:
        supervisor.stop()

    assert status.healthy is False
    assert status.error is not None
    assert "crashed on startup" in status.error
    assert "../controllers/userController" in status.error
    assert "capitalisation" in status.error
    assert any("Cannot find module" in line for line in status.log)
    # The crash is reported at once, not after the full health timeout.
    assert elapsed < 20


def test_a_server_that_ignores_port_is_found_from_its_log(tmp_path: Path) -> None:
    real = free_port()
    guessed = free_port()
    assert real != guessed

    supervisor = ServerSupervisor()
    try:
        # http.server only ever binds the port given on the command line, so the
        # PORT we pass is a decoy — the log is the only way to find the truth.
        status = supervisor.start(
            tmp_path, command=f"{sys.executable} -u -m http.server {real}", port=guessed
        )
    finally:
        supervisor.stop()

    assert status.healthy is True
    assert status.port == real
    assert status.url == f"http://127.0.0.1:{real}"


def test_a_watched_server_that_recovers_turns_healthy(tmp_path: Path) -> None:
    import time

    # nodemon-style: die on start, then serve for real once the code is fixed.
    (tmp_path / "recover.py").write_text(
        "import http.server, os, socketserver, time\n"
        "print(\"Error: Cannot find module 'x'\", flush=True)\n"
        "time.sleep(2.5)\n"
        "port = int(os.environ['PORT'])\n"
        "with socketserver.TCPServer(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler) as httpd:\n"
        "    print(f'listening on port {port}', flush=True)\n"
        "    httpd.serve_forever()\n"
    )
    port = free_port()
    supervisor = ServerSupervisor()
    try:
        first = supervisor.start(
            tmp_path, command=f"{sys.executable} -u recover.py", port=port
        )
        assert first.healthy is False
        assert first.error is not None and "crashed" in first.error

        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and not supervisor.status().healthy:
            time.sleep(0.5)

        recovered = supervisor.status()
        assert recovered.healthy is True
        assert recovered.error is None
    finally:
        supervisor.stop()
