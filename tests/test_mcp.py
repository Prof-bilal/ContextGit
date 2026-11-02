"""The MCP channel: the team tools an agent can call, and its project config."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from contextgit.core.repo import Repo
from contextgit.mcp import tools
from contextgit.mcp.config import CONFIG_NAME, ensure_mcp_config


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    ).stdout


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "Tester")
    (root / "app.py").write_text("print('hi')\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


@pytest.fixture
def team(repo: Repo, project: Path):  # noqa: ANN201 - Repo.create_team return type
    return repo.create_team("portal", project_path=str(project))


class TestTools:
    def test_status_reports_counts_and_blockers(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api", scope=["src/api/**"])
        repo.create_task(team.id, title="web", depends_on=[api.id])

        status = tools.team_status(repo)

        assert status["team"] == "portal"
        assert status["counts"] == {"todo": 2}
        assert status["gate_command"] is None

    def test_status_without_a_team_is_honest(self, repo: Repo) -> None:
        assert tools.team_status(repo)["team"] is None

    def test_list_tasks_filters_by_status(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api")
        repo.create_task(team.id, title="web")
        repo.start_task(api.id)
        repo.complete_task(api.id)

        assert len(tools.list_tasks(repo)) == 2
        assert [task["title"] for task in tools.list_tasks(repo, "review")] == ["api"]

    def test_read_board_since_only_returns_newer(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api")
        repo.post_message(team.id, "first")
        repo.post_message(team.id, "second")

        messages = tools.read_board(repo)
        assert [message["body"] for message in messages][-2:] == ["first", "second"]
        newest = messages[-1]["id"]
        assert tools.read_board(repo, since=newest) == []

    def test_start_and_finish_use_the_run_env(
        self, repo: Repo, team, monkeypatch: pytest.MonkeyPatch  # noqa: ANN001
    ) -> None:
        task = repo.create_task(team.id, title="api", agent="shell")
        monkeypatch.setenv(tools.TASK_ENV, task.id)

        started = tools.start_task(repo)
        assert started["status"] == "working"

        finished = tools.finish_task(repo, evidence="shipped the endpoint")
        assert finished["status"] == "review"
        assert any(message["body"] == "shipped the endpoint" for message in tools.read_board(repo))

    def test_finish_without_a_task_is_a_readable_error(self, repo: Repo, monkeypatch) -> None:  # noqa: ANN001
        monkeypatch.delenv(tools.TASK_ENV, raising=False)
        result = tools.finish_task(repo)
        assert result["type"] == "NoTask"

    def test_claiming_a_blocked_task_reports_the_error(self, repo: Repo, team) -> None:  # noqa: ANN001
        api = repo.create_task(team.id, title="api")
        web = repo.create_task(team.id, title="web", depends_on=[api.id])

        result = tools.start_task(repo, web.id)

        assert result["type"] == "TaskDependencyError"
        assert "api" in str(result["error"])

    def test_check_ownership_names_the_owner(self, repo: Repo, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api", scope=["src/api/**"])

        assert tools.check_ownership(repo, "src/api/users.py")["owner"] == "api"
        assert tools.check_ownership(repo, "src/web/app.tsx")["free"] is True

    def test_publish_contract_adds_it_to_the_scope(self, repo: Repo, team) -> None:  # noqa: ANN001
        task = repo.create_task(team.id, title="api", scope=["src/api/**"])

        published = tools.publish_contract(repo, "openapi.yaml", task.id)

        assert published["contract"] == "openapi.yaml"
        assert "openapi.yaml" in published["scope"]

    def test_peers_lists_the_other_runs(self, repo: Repo, team) -> None:  # noqa: ANN001
        first = repo.create_task(team.id, title="api", agent="shell", scope=["src/api/**"])
        second = repo.create_task(team.id, title="web", agent="shell", scope=["src/web/**"])
        repo.start_task(second.id)

        listed = tools.peers(repo)

        assert [peer["title"] for peer in listed] == ["web"]
        assert listed[0]["scope"] == ["src/web/**"]
        assert first.id not in {peer["id"] for peer in listed}


class TestConfig:
    def test_repairs_existing_codex_config_without_losing_user_options(self, project: Path) -> None:
        config = project / ".codex" / "config.toml"
        config.parent.mkdir()
        config.write_text('model = "custom"\n[mcp_servers.contextgit]\ncommand = "stale"\nenv_vars = [\n  "CUSTOM",\n]\nstartup_timeout_sec = 45\n[mcp_servers.contextgit.env]\nCUSTOM = "kept"\n[mcp_servers.contextgit.tools.team_status]\napproval_mode = "approve"\n[mcp_servers.other]\ncommand = "other"\n')
        identity = {"CONTEXTGIT_REPO": "/actual/app/state", "CONTEXTGIT_ROLE": "orchestrator", "CONTEXTGIT_TEAM": "team-1"}
        ensure_mcp_config(project, run_env=identity)
        first = config.read_text()
        ensure_mcp_config(project, run_env=identity)
        assert config.read_text() == first
        data = tomllib.loads(first)
        server = data["mcp_servers"]["contextgit"]
        assert server["command"] != "stale"
        assert server["env"] | identity == server["env"]
        assert server["env"]["CONTEXTGIT_TASK"] == ""
        assert server["env"]["CUSTOM"] == "kept"
        assert server["startup_timeout_sec"] == 45
        assert server["tools"]["team_status"]["approval_mode"] == "approve"
        assert "CONTEXTGIT_ROLE" in server["env_vars"] and "CUSTOM" in server["env_vars"]
        assert data["model"] == "custom"
        assert data["mcp_servers"]["other"]["command"] == "other"

    def test_shared_config_does_not_capture_the_callers_authority(self, project: Path, monkeypatch) -> None:
        monkeypatch.setenv("CONTEXTGIT_ROLE", "orchestrator")
        monkeypatch.setenv("CONTEXTGIT_TEAM", "unrelated")
        ensure_mcp_config(project)
        data = json.loads((project / CONFIG_NAME).read_text())
        assert "CONTEXTGIT_ROLE" not in data["mcpServers"]["contextgit"]["env"]

    def test_creates_the_file_with_our_server(self, project: Path) -> None:
        path = ensure_mcp_config(project)
        assert path is not None
        data = json.loads((project / CONFIG_NAME).read_text())
        assert "contextgit" in data["mcpServers"]
        assert data["mcpServers"]["contextgit"]["command"]

    def test_keeps_other_servers_and_is_idempotent(self, project: Path) -> None:
        (project / CONFIG_NAME).write_text(
            json.dumps({"mcpServers": {"other": {"command": "other-mcp"}}})
        )
        ensure_mcp_config(project)
        ensure_mcp_config(project)

        data = json.loads((project / CONFIG_NAME).read_text())
        assert set(data["mcpServers"]) == {"other", "contextgit"}
        assert data["mcpServers"]["other"]["command"] == "other-mcp"

    def test_launching_a_team_writes_the_config(self, repo: Repo, project: Path, team) -> None:  # noqa: ANN001
        repo.create_task(team.id, title="api", agent="shell")
        repo.launch_team()
        assert (project / CONFIG_NAME).is_file()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["orchestrator", "worker"])
async def test_configured_stdio_identity_survives_filtered_client_env(repo: Repo, project: Path, team, role: str) -> None:
    """Use just generated MCP env, not the parent CLI's full environment."""
    pytest.importorskip("mcp")
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    ensure_mcp_config(project, run_env={
        "CONTEXTGIT_REPO": str(repo.root.resolve()),
        "CONTEXTGIT_TEAM": team.id, "CONTEXTGIT_ROLE": role,
    })
    server = tomllib.loads((project / ".codex" / "config.toml").read_text())["mcp_servers"]["contextgit"]
    params = StdioServerParameters(command=server["command"], args=server["args"], env=server["env"], cwd=str(project))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            status = await session.call_tool("team_status", {})
            result = await session.call_tool("propose_team_plan", {"goal": "Audit", "tasks": [{"title": "Read-only audit", "agent": "codex"}]})
    status_data = json.loads(status.content[0].text)
    result_data = json.loads(result.content[0].text)
    assert status_data["team"] == team.name
    if role == "orchestrator":
        assert "error" not in result_data
        assert result_data["status"] == "draft"
    else:
        assert result_data["type"] == "Forbidden"
    assert not repo.list_tasks(team.id)  # Proposals never launch workers.


@pytest.mark.anyio
async def test_stdio_handshake_exposes_the_team_tools(repo: Repo, project: Path, team) -> None:  # noqa: ANN001
    """The real protocol: launch the server and list its tools over stdio."""
    pytest.importorskip("mcp")
    from mcp import ClientSession  # noqa: PLC0415
    from mcp.client.stdio import StdioServerParameters, stdio_client  # noqa: PLC0415

    repo.create_task(team.id, title="api")
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "contextgit.mcp.main", "--repo", str(repo.root)],
        env={**os.environ, "CONTEXTGIT_REPO": str(repo.root)},
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listing = await session.list_tools()
            names = {tool.name for tool in listing.tools}
            status = await session.call_tool("team_status", {})

    assert {
        "team_status",
        "list_tasks",
        "read_board",
        "claim_task",
        "complete_task",
        "post_update",
        "check_ownership",
        "peers",
        "publish_contract",
    } <= names
    assert status is not None


def test_memory_tools_are_registered_and_described() -> None:
    """The memory surface has to be reachable, or no agent will ever use it."""
    import asyncio

    from contextgit.mcp.server import build_server

    server = build_server("/tmp/contextgit-mcp-tools-check")
    registered = {tool.name: tool for tool in asyncio.run(server.list_tools())}

    expected = {"memory", "dead_ends", "decisions", "why", "endpoints", "endpoint_tests"}
    assert expected <= set(registered)
    # `dead_ends` is the differentiator: its description must tell the agent to use it.
    description = registered["dead_ends"].description or ""
    assert "rejected" in description.lower()
