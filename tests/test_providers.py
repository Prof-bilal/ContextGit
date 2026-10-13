"""The provider registry, the add-a-provider flow, and per-request chat providers.

Everything here is offline: the `mock` provider and env fallbacks mean the whole
flow is exercisable without a network or a real key.
"""

import pytest

from contextgit.core.models import Message, ProviderRecord
from contextgit.llm.registry import (
    all_provider_infos,
    build_for,
    key_hint,
    resolve_provider,
)

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
    assert infos["groq"].key_hint == "••••"


def test_key_hint_shapes() -> None:
    assert key_hint(None) is None
    assert key_hint("tiny") == "••••"
    assert key_hint("sk-abcdefghijklmnop") == "••••"


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


def test_agnes_always_uses_bearer_auth_even_for_a_stale_saved_row() -> None:
    record = ProviderRecord(
        id="agnes",
        label="Agnes AI",
        base_url="https://apihub.agnes-ai.com/v1",
        auth_style="x-api-key",
        api_key="agnes-secret",
    )
    resolved = resolve_provider("agnes", [record])
    assert resolved.spec.auth == "bearer"


def test_mock_provider_needs_no_key_or_network() -> None:
    adapter, resolved = build_for("mock", [])
    assert resolved.model == "mock-1"
    text = adapter.complete([Message(role="user", content="hi")], model="mock-1")
    assert "mock" in text.lower()
