"""Exercise user-provided credentials through the real HTTP provider adapter."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message
from contextgit.core.repo import Repo


@pytest.fixture
def provider_server():
    state = {"requests": [], "fail": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append(
                {
                    "body": body,
                    "auth": self.headers.get("Authorization") or self.headers.get("x-api-key"),
                }
            )
            if state["fail"]:
                status, result = 401, {"error": {"message": "invalid test-credential-private"}}
            else:
                prompt = body.get("system") or body["messages"][0]["content"]
                text = (
                    json.dumps(
                        {
                            "title": "Test auth",
                            "instruction": "Run the auth tests.",
                            "rationale": "Tests failed in the earlier task.",
                            "evidence": "The authentication test failed.",
                            "confidence": "medium",
                            "kind": "validation",
                            "conflicts": [],
                        }
                    )
                    if "Extract ONE" in prompt
                    else "## Outcome\nAuthentication test failed."
                )
                result = (
                    {"content": [{"type": "text", "text": text}]}
                    if self.path.endswith("/messages")
                    else {"choices": [{"message": {"content": text}}]}
                )
                status = 200
            payload = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/v1", state
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.delenv("CTX_LLM_API_KEY", raising=False)
    root = tmp_path / "project"
    root.mkdir()
    repo = Repo.init(root / ".contextgit")
    session = repo.create_session("Auth", project_path=str(root), category="Authentication")
    repo.stage(session.id, [Message(role="assistant", content="The authentication test failed.")])
    client = TestClient(create_app(repo=repo))
    yield repo, session, client
    repo._storage.close()


def connection(base):
    return {
        "provider_id": "knowledge-custom",
        "api_key": "test-credential-private",
        "model": "example-model",
        "base_url": base,
    }


def test_setup_test_save_restart_and_use_actual_adapter(project, provider_server):
    repo, session, client = project
    base, state = provider_server
    initial = client.get("/api/v1/knowledge/provider-settings").json()
    assert initial["default_provider"] is None
    assert initial["app_default"] is False
    assert any(p["id"] == "knowledge-custom" for p in initial["providers"])
    tested = client.post("/api/v1/knowledge/provider-settings/test", json=connection(base))
    assert tested.status_code == 200
    assert repo.learning_provider() is None  # A test must not change saved settings.
    assert state["requests"][-1]["auth"] == "Bearer test-credential-private"
    assert "authentication" not in str(state["requests"][-1]["body"]).lower()
    saved = client.put("/api/v1/knowledge/provider-settings", json=connection(base))
    assert saved.status_code == 200
    assert "test-credential-private" not in saved.text
    assert saved.json()["key_hint"] == "••••"
    assert repo.learning_provider() == "knowledge-custom"
    settings = client.get("/api/v1/knowledge/provider-settings")
    assert "test-credential-private" not in settings.text

    reopened = Repo.open(repo.root)
    restarted = TestClient(create_app(repo=reopened))
    route = f"/api/v1/sessions/{session.id}"
    assert restarted.post(route + "/checkpoint").status_code == 200
    cleaned = restarted.post(route + "/checkpoint/clean", json={})
    assert cleaned.status_code == 200
    assert "Authentication test failed" in cleaned.json()["markdown"]
    draft = restarted.post(route + "/learning-draft", json={})
    assert draft.status_code == 200
    assert draft.json()["status"] == "draft"
    assert state["requests"][-1]["body"]["model"] == "example-model"
    assert state["requests"][-1]["auth"] == "Bearer test-credential-private"
    reopened._storage.close()


def test_invalid_key_can_retry_without_replacing_saved_connection(project, provider_server):
    repo, _, client = project
    base, state = provider_server
    client.put("/api/v1/knowledge/provider-settings", json=connection(base))
    state["fail"] = True
    failed = client.post("/api/v1/knowledge/provider-settings/test", json=connection(base))
    assert failed.status_code == 409
    assert "test-credential-private" not in failed.text
    assert "Check the API key" in failed.json()["detail"]
    assert repo.learning_provider() == "knowledge-custom"
    state["fail"] = False
    assert (
        client.post("/api/v1/knowledge/provider-settings/test", json=connection(base)).status_code
        == 200
    )


def test_edit_model_keeps_secret_and_defaults_stay_in_project(project, provider_server, tmp_path):
    repo, _, client = project
    base, _ = provider_server
    client.put("/api/v1/knowledge/provider-settings", json=connection(base))
    updated = {"provider_id": "knowledge-custom", "model": "new-model", "base_url": base}
    assert client.put("/api/v1/knowledge/provider-settings", json=updated).status_code == 200
    assert repo.get_provider("knowledge-custom").api_key == "test-credential-private"
    assert repo.get_provider("knowledge-custom").default_model == "new-model"
    assert client.post("/api/v1/knowledge/provider-settings/test", json=updated).status_code == 200
    other = Repo.init(tmp_path / "other" / ".contextgit")
    other_settings = (
        TestClient(create_app(repo=other)).get("/api/v1/knowledge/provider-settings").json()
    )
    assert other_settings["default_provider"] is None
    assert not any(
        p["has_key"] for p in other_settings["providers"] if p["id"] == "knowledge-custom"
    )
    other._storage.close()


def test_setup_validation_does_not_store_bad_settings(project):
    repo, _, client = project
    for body in (
        {"provider_id": "openai", "model": "example-model"},
        {**connection("https://user:password@example.com/v1")},
        {**connection("file:///tmp/provider")},
        {**connection("http://localhost:1234/v1"), "model": " "},
        {**connection("http://localhost:1234/v1"), "provider_id": "mock"},
    ):
        assert client.put("/api/v1/knowledge/provider-settings", json=body).status_code == 409
    assert repo.learning_provider() is None
    assert repo.list_providers() == []


def test_local_server_can_be_saved_without_a_key(project, provider_server):
    repo, _, client = project
    base, _ = provider_server
    body = {"provider_id": "ollama", "model": "local-model", "base_url": base}
    assert client.post("/api/v1/knowledge/provider-settings/test", json=body).status_code == 200
    assert client.put("/api/v1/knowledge/provider-settings", json=body).status_code == 200
    assert repo.learning_provider() == "ollama"


def test_validation_and_generation_errors_do_not_echo_credentials(project, provider_server):
    _, session, client = project
    base, state = provider_server
    oversized = {**connection(base), "api_key": "test-credential-private" * 500}
    invalid = client.put("/api/v1/knowledge/provider-settings", json=oversized)
    assert invalid.status_code == 422
    assert "test-credential-private" not in invalid.text
    assert (
        client.put("/api/v1/knowledge/provider-settings", json=connection(base)).status_code == 200
    )
    route = f"/api/v1/sessions/{session.id}"
    client.post(route + "/checkpoint")
    state["fail"] = True
    failed = client.post(route + "/checkpoint/clean", json={})
    assert failed.status_code == 502
    assert "test-credential-private" not in failed.text
    assert "[REDACTED]" in failed.text


def test_anthropic_key_and_model_use_native_messages_adapter(project, provider_server):
    _, session, client = project
    base, state = provider_server
    body = {**connection(base), "provider_id": "anthropic", "model": "example-claude-model"}
    assert client.post("/api/v1/knowledge/provider-settings/test", json=body).status_code == 200
    assert state["requests"][-1]["auth"] == "test-credential-private"
    assert client.put("/api/v1/knowledge/provider-settings", json=body).status_code == 200
    route = f"/api/v1/sessions/{session.id}"
    client.post(route + "/checkpoint")
    assert client.post(route + "/learning-draft", json={}).status_code == 200
    assert state["requests"][-1]["body"]["model"] == "example-claude-model"
