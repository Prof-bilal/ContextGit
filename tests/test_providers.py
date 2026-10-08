"""The provider registry, the add-a-provider flow, and per-request chat providers.

Everything here is offline: the `mock` provider and env fallbacks mean the whole
flow is exercisable without a network or a real key.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message, ProviderRecord
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider
from contextgit.llm.registry import (
    all_provider_infos,
    build_for,
    key_hint,
    resolve_provider,
)


def client_for(repo: Repo) -> TestClient:
    return TestClient(create_app(repo=repo, provider=FakeProvider(default="injected")))


# ---------- registry (pure, no HTTP) ----------


def test_builtin_catalog_states() -> None:
    infos = {info.id: info for info in all_provider_infos([])}
    assert infos["mock"].configured  # needs no key, so always ready
    assert not infos["anthropic"].configured  # requires a key
    assert infos["ollama"].configured  # local, keyless
    assert infos["anthropic"].openai_shaped is False
    assert infos["groq"].kind == "cloud"
    assert infos["openrouter"].kind == "gateway"


def test_chat_catalog_is_exactly_the_ten_presets() -> None:
    from contextgit.llm.spec import CHAT_PRESET_IDS

    fresh = all_provider_infos([], environ={}, capability="chat")
    assert [info.id for info in fresh if info.kind != "mock"] == list(CHAT_PRESET_IDS)
    assert len(CHAT_PRESET_IDS) == 10
    # The ten the product asks for, by id.
    assert set(CHAT_PRESET_IDS) == {
        "openrouter", "omniroute", "agnes", "openai", "anthropic",
        "gemini", "groq", "freellm", "ollama", "mistral",
    }

    # A saved connection or an env key must not smuggle another built-in back
    # into the chat catalog — the list is closed.
    saved = ProviderRecord(id="together", label="Together", base_url="https://api.together.xyz/v1")
    connected = all_provider_infos([saved], environ={"CTX_LLM_FIREWORKS_API_KEY": "test-key"}, capability="chat")
    ids = {info.id for info in connected}
    assert {"mock", *CHAT_PRESET_IDS} <= ids
    assert "together" not in ids
    assert "fireworks" not in ids
    assert "hyperbolic" not in ids
    # Hidden is not deleted: a provider id still resolves, so an old model
    # selection keeps working.
    assert resolve_provider("hyperbolic", [], {}).spec.id == "hyperbolic"


def test_env_fallback_configures_a_provider() -> None:
    infos = {info.id: info for info in all_provider_infos([], {"CTX_LLM_GROQ_API_KEY": "sk-live"})}
    assert infos["groq"].configured
    assert infos["groq"].has_key
    # The env key is never echoed back — not even as a hint.
    assert infos["groq"].key_hint is None


def test_stored_key_wins_over_env_and_is_hinted() -> None:
    record = ProviderRecord(id="groq", label="Groq", base_url="https://api.groq.com/openai/v1")
    record.api_key = "sk-row-secret-1234"
    resolved = resolve_provider("groq", [record], {"CTX_LLM_GROQ_API_KEY": "sk-env"})
    assert resolved.api_key == "sk-row-secret-1234"
    infos = {info.id: info for info in all_provider_infos([record])}
    assert infos["groq"].key_hint == "sk-…1234"


def test_key_hint_shapes() -> None:
    assert key_hint(None) is None
    assert key_hint("tiny") == "••••"
    assert key_hint("sk-abcdefghijklmnop") == "sk-…mnop"


def test_keyless_provider_does_not_inherit_the_global_env_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CTX_LLM_API_KEY", "sk-global")
    adapter, resolved = build_for("groq", [])
    assert resolved.api_key is None
    # The adapter must not silently borrow the global key for a different vendor.
    assert getattr(adapter, "api_key", None) == ""


def test_per_provider_env_key_is_used() -> None:
    _, resolved = build_for("groq", [], {"CTX_LLM_GROQ_API_KEY": "sk-groq"})
    assert resolved.api_key == "sk-groq"


def test_mock_provider_needs_no_key_or_network() -> None:
    adapter, resolved = build_for("mock", [])
    assert resolved.model == "mock-1"
    text = adapter.complete([Message(role="user", content="hi")], model="mock-1")
    assert "mock" in text.lower()


# ---------- the HTTP flow: add → test → models → chat ----------


def test_provider_flow_add_test_models_delete(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)

    listed = client.get("/api/v1/providers")
    assert listed.status_code == 200
    ids = [item["id"] for item in listed.json()]
    assert "mock" in ids and "anthropic" in ids

    added = client.post(
        "/api/v1/providers",
        json={"id": "groq", "api_key": "sk-secret-value-9"},
    )
    assert added.status_code == 201
    body = added.json()
    assert body["has_key"] is True
    assert body["key_hint"] == "sk-…ue-9"
    assert "sk-secret-value-9" not in added.text  # the key never comes back

    tested = client.post("/api/v1/providers/mock/test")
    assert tested.status_code == 200
    assert tested.json()["ok"] is True
    assert tested.json()["latency_ms"] >= 0

    models = client.post("/api/v1/providers/mock/models")
    assert models.status_code == 200
    assert models.json() == {"models": ["mock-1", "mock-2"], "source": "static"}

    assert client.delete("/api/v1/providers/groq").status_code == 204
    after = {item["id"]: item for item in client.get("/api/v1/providers").json()}
    assert after["groq"]["has_key"] is False


def test_custom_provider_is_added_and_listed(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    created = client.post(
        "/api/v1/providers",
        json={
            "label": "My Gateway",
            "kind": "gateway",
            "base_url": "http://localhost:9999/v1",
            "auth_style": "bearer",
            "default_model": "my-model",
        },
    )
    assert created.status_code == 201
    assert created.json()["id"] == "my-gateway"
    assert created.json()["is_builtin"] is False
    listed = {item["id"]: item for item in client.get("/api/v1/providers").json()}
    assert listed["my-gateway"]["base_url"] == "http://localhost:9999/v1"
    assert listed["my-gateway"]["default_model"] == "my-model"


def test_custom_provider_without_base_url_is_rejected(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post("/api/v1/providers", json={"label": "Nowhere"})
    assert response.status_code == 422


def test_failed_connection_is_reported_and_key_is_redacted(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    client.post(
        "/api/v1/providers",
        json={
            "label": "Dead End",
            "base_url": "http://127.0.0.1:1/v1",
            "api_key": "sk-should-never-leak",
        },
    )
    result = client.post("/api/v1/providers/dead-end/test")
    assert result.status_code == 200
    assert result.json()["ok"] is False
    assert "sk-should-never-leak" not in result.text


def test_chat_stream_uses_the_selected_provider(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/chat/stream",
        json={
            "prompt": "hello there",
            "provider": "mock",
            "model": "mock-2",
            "commit_id": repo.log()[0].id,
        },
    )
    assert response.status_code == 200
    assert "event: token" in response.text
    assert "event: done" in response.text
    # The turn was committed with the resolved provider model.
    assert repo.log()[0].model == "mock-2"
    assert [m.content for m in repo.log()[0].messages][0] == "hello there"


def test_chat_stream_unknown_provider_is_404(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/chat/stream",
        json={"prompt": "hi", "provider": "nope", "commit_id": repo.log()[0].id},
    )
    assert response.status_code == 404


def test_capabilities_filter_the_catalog() -> None:
    infos = {info.id: info for info in all_provider_infos([])}
    assert infos["tavily"].capability == "search"
    assert infos["openai-images"].capability == "image"
    assert infos["local-sd"].requires_key is False
    search_only = all_provider_infos([], capability="search")
    assert {info.id for info in search_only} == {"tavily", "mock-search"}
    image_only = all_provider_infos([], capability="image")
    assert {info.id for info in image_only} == {"openai-images", "local-sd", "mock-image"}
    # Chat is the default and never leaks search/image rows.
    assert all(info.capability == "chat" for info in all_provider_infos([], capability="chat"))


def test_tavily_reads_its_env_key() -> None:
    infos = {info.id: info for info in all_provider_infos([], {"CTX_LLM_TAVILY_API_KEY": "tvly-x"})}
    assert infos["tavily"].configured
    assert infos["tavily"].key_hint is None


def test_mock_search_and_images_work_offline() -> None:
    from contextgit.llm.registry import build_images_for, build_search_for

    search, _ = build_search_for("mock-search", [])
    hits = search.search("token bucket", max_results=3)
    assert len(hits) == 3
    assert all("token bucket" in hit.title for hit in hits)

    images, resolved = build_images_for("mock-image", [])
    tiles = images.generate("a token bucket", model=resolved.model or "mock-image-1", count=2)
    assert len(tiles) == 2
    assert tiles[0].data_url is not None
    assert tiles[0].data_url.startswith("data:image/svg+xml;base64,")


def test_user_configured_tracks_stored_rows(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    before = {item["id"]: item for item in client.get("/api/v1/providers").json()}
    # Bare catalog rows are not "set up": not even the keyless local ones.
    assert before["groq"]["user_configured"] is False
    assert before["ollama"]["user_configured"] is False
    assert before["tavily"]["user_configured"] is False

    client.post("/api/v1/providers", json={"id": "groq", "api_key": "sk-x"})
    client.post("/api/v1/providers", json={"id": "ollama"})

    after = {item["id"]: item for item in client.get("/api/v1/providers").json()}
    assert after["groq"]["user_configured"] is True
    assert after["ollama"]["user_configured"] is True


def test_provider_capability_filter_route(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    ids = {item["id"] for item in client.get("/api/v1/providers?capability=image").json()}
    assert ids == {"openai-images", "local-sd", "mock-image"}
    tested = client.post("/api/v1/providers/mock-search/test")
    assert tested.status_code == 200 and tested.json()["ok"] is True


def test_chat_stream_defaults_to_injected_provider(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/chat/stream",
        json={"prompt": "hi", "model": "fake", "commit_id": repo.log()[0].id},
    )
    assert response.status_code == 200
    chunks = [
        json.loads(line[6:])["text"]
        for line in response.text.splitlines()
        if line.startswith("data: ") and '"text"' in line
    ]
    assert "".join(chunks) == "injected"


# ---------- asset agent (its own isolated provider store) ----------


def test_agent_providers_are_isolated_from_chat(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)

    created = client.post(
        "/api/v1/agent-providers",
        json={"id": "mock", "label": "Mock", "capability": "chat"},
    )
    assert created.status_code == 201
    # The row lands in the agent's store, never in Chat's.
    assert repo.get_agent_provider("mock") is not None
    assert repo.get_provider("mock") is None

    # Removing it from the agent store leaves Chat untouched.
    assert client.delete("/api/v1/agent-providers/mock").status_code == 204
    assert repo.get_agent_provider("mock") is None


def test_asset_agent_returns_a_validated_plan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from contextgit.api import app as app_module

    repo = Repo.init(tmp_path / "repo")
    plan = '{"actions":[{"type":"create_folder","path":"Logos"},{"type":"nope"}]}'
    fake = FakeProvider(default=plan)
    resolved = resolve_provider("mock", [])
    monkeypatch.setattr(app_module, "build_for", lambda *_a, **_k: (fake, resolved))
    client = TestClient(create_app(repo=repo))

    response = client.post(
        "/api/v1/assets/agent",
        json={
            "provider_id": "mock",
            "instruction": "make a Logos folder",
            "catalog": {
                "assets": [{"id": "a1", "name": "logo.png", "kind": "image"}],
                "folders": [],
            },
        },
    )
    assert response.status_code == 200
    # The unknown action is dropped; the valid one survives.
    assert response.json()["actions"] == [{"type": "create_folder", "path": "Logos"}]


def test_asset_agent_reports_a_non_json_reply(tmp_path: Path) -> None:
    """The offline mock replies with prose, so the agent must say so, not crash."""
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo)
    response = client.post(
        "/api/v1/assets/agent",
        json={"provider_id": "mock", "instruction": "tidy up"},
    )
    assert response.status_code == 422
    assert "valid JSON" in response.json()["error"]


def test_asset_agent_parser_drops_unknown_actions() -> None:
    from contextgit.agents.asset_agent import parse_actions

    text = '```json\n{"actions":[{"type":"rename","id":"a","name":"x"},{"type":"bogus"}]}\n```'
    assert parse_actions(text) == [{"type": "rename", "id": "a", "name": "x"}]

