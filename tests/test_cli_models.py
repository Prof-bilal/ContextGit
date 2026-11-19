import json
import subprocess
from types import SimpleNamespace

import pytest

from contextgit.core import cli_models
from contextgit.mcp.config import ensure_mcp_config


@pytest.mark.parametrize("agent,output,expected", [
    ("codex", json.dumps({"models": [{"slug": "test-model", "display_name": "Test model", "visibility": "list"}, {"slug": "hidden", "visibility": "hide"}]}), ["test-model"]),
    ("opencode", "opencode/test\nanthropic/custom\n", ["opencode/test", "anthropic/custom"]),
    ("commandcode", "Available models · 3\n\nOpen Source\nprovider/first   description\nprovider/second   description\nclaude-test   description\nDecision models (headless only)\ntypesafe/jev  headless decision model\n", ["provider/first", "provider/second", "claude-test"]),
])
def test_catalog_uses_installed_cli(monkeypatch, agent, output, expected):
    monkeypatch.setattr(cli_models.shutil, "which", lambda _: "/test/cli")
    calls = []
    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(stdout=output)
    monkeypatch.setattr(cli_models.subprocess, "run", run)
    result = cli_models.catalog(agent)
    assert [model["id"] for model in result["models"]] == expected
    assert calls[0][1]["timeout"] == 15
    if agent == "commandcode":
        assert "--no-auto-update" in calls[0][0]


def test_missing_cli_and_invalid_ids(monkeypatch):
    monkeypatch.setattr(cli_models.shutil, "which", lambda _: None)
    assert cli_models.catalog("opencode")["models"] == []
    for value in ["--unsafe", "bad model", "x\ncommand"]:
        with pytest.raises(ValueError):
            cli_models.validate_model(value)
    with pytest.raises(ValueError):
        cli_models.catalog("arbitrary-command")


@pytest.mark.parametrize("version,v2", [("opencode v2.1.3", True), ("1.4.0", False)])
def test_opencode_private_overlay_has_identity_and_model(tmp_path, monkeypatch, version, v2):
    monkeypatch.setattr("contextgit.mcp.config.opencode_v2", lambda: v2)
    identity = {"CONTEXTGIT_REPO": "/real/state", "CONTEXTGIT_ROLE": "orchestrator", "CONTEXTGIT_TEAM": "team"}
    ensure_mcp_config(tmp_path, run_env=identity, agent="opencode", model="provider/model")
    data = json.loads((tmp_path / ".contextgit/opencode.json").read_text())
    server = (data["mcp"]["servers"] if v2 else data["mcp"])["contextgit"]
    assert server["environment"]["CONTEXTGIT_ROLE"] == "orchestrator"
    assert server["environment"]["CONTEXTGIT_REPO"] == "/real/state"
    assert data["model"] == "provider/model"


def test_catalog_failure_is_actionable(monkeypatch, tmp_path):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    monkeypatch.setattr(cli_models.shutil, "which", lambda _: "/test/cli")
    def fail(*args, **kwargs):
        raise subprocess.TimeoutExpired("cli", 15)
    monkeypatch.setattr(cli_models.subprocess, "run", fail)
    assert cli_models.catalog("codex")["source"] == "unavailable"
