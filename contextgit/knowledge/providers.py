"""User-owned learning connections, using the existing local provider store."""

from urllib.parse import urlsplit

from pydantic import BaseModel, Field, SecretStr

from contextgit.core.models import Message, ProviderRecord, utcnow
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider, LLMProvider, all_provider_infos, build_adapter, build_for
from contextgit.llm.anthropic import AnthropicProvider
from contextgit.llm.openai_compatible import OpenAICompatibleProvider
from contextgit.llm.registry import ProviderInfo, effective_spec, provider_info, resolve_provider
from contextgit.llm.spec import BUILTIN_BY_ID, ProviderSpec


class ConnectionRequest(BaseModel):
    provider_id: str = Field(min_length=1, max_length=100)
    api_key: SecretStr | None = Field(default=None, max_length=8192)
    model: str = Field(min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=2048)


class LearningConnections:
    def __init__(self, repo: Repo):
        self.repo = repo

    @staticmethod
    def failure(active: LLMProvider, error: Exception) -> str:
        detail = str(error)
        key = getattr(active, "api_key", "")
        if isinstance(key, str) and key and key != "local":
            detail = detail.replace(key, "[REDACTED]")
        return f"Learning provider failed: {detail[:500]}"

    def settings(self, app_default: bool) -> dict[str, object]:
        catalog = [
            info
            for info in all_provider_infos(self.repo.list_providers())
            if info.capability == "chat" and info.kind != "mock"
        ]
        if not any(info.id == "knowledge-custom" for info in catalog):
            catalog.append(
                provider_info(
                    ProviderSpec(
                        id="knowledge-custom",
                        label="Custom OpenAI-compatible",
                        vendor="Custom",
                        base_url="",
                        default_model=None,
                    ),
                    None,
                    environ={},
                    is_builtin=False,
                )
            )
        return {
            "providers": [info.model_dump(mode="json") for info in catalog],
            "default_provider": self.repo.learning_provider(),
            "app_default": app_default,
        }

    def candidate(self, body: ConnectionRequest) -> ProviderRecord:
        existing = self.repo.get_provider(body.provider_id)
        base = BUILTIN_BY_ID.get(body.provider_id)
        if body.provider_id == "knowledge-custom" and not existing:
            base = ProviderSpec(
                id=body.provider_id, label="Custom OpenAI-compatible", vendor="Custom", base_url=""
            )
        spec = effective_spec(existing) if existing else base
        if not spec or spec.kind == "mock" or spec.capability != "chat":
            raise ValueError("Choose a supported conversation provider.")
        if not spec.openai_shaped and spec.id != "anthropic":
            raise ValueError("This provider does not have a supported conversation adapter.")
        model = body.model.strip()
        if not model:
            raise ValueError("Enter a model name for this connection.")
        resolved = (
            resolve_provider(spec.id, self.repo.list_providers())
            if (existing or spec.id in BUILTIN_BY_ID)
            else None
        )
        url = (
            (
                body.base_url
                if body.base_url is not None
                else (resolved.base_url if resolved else spec.base_url)
            )
            .strip()
            .rstrip("/")
        )
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or "{" in url
            or "}" in url
        ):
            raise ValueError(
                "Enter an HTTP or HTTPS API base URL without credentials or placeholders."
            )
        supplied = body.api_key.get_secret_value().strip() if body.api_key else ""
        key = supplied or (resolved.api_key if resolved else None)
        if spec.requires_key and not key:
            raise ValueError("Enter an API key for this provider.")
        return ProviderRecord(
            id=spec.id,
            label=spec.label,
            vendor=spec.vendor,
            kind=spec.kind,
            capability="chat",
            base_url=url,
            auth_style=spec.auth,
            api_key=key,
            default_model=model,
            models=list(dict.fromkeys([model, *spec.models])),
            created_at=existing.created_at if existing else utcnow(),
            updated_at=utcnow(),
        )

    def save(self, body: ConnectionRequest) -> ProviderInfo:
        record = self.candidate(body)
        self.repo.save_provider(record)
        self.repo.set_learning_provider(record.id)
        return provider_info(effective_spec(record), record, is_builtin=record.id in BUILTIN_BY_ID)

    def test(self, body: ConnectionRequest) -> dict[str, str]:
        record = self.candidate(body)
        active = build_adapter(
            effective_spec(record),
            api_key=record.api_key,
            base_url=record.base_url,
            model=record.default_model,
        )
        if isinstance(active, (OpenAICompatibleProvider, AnthropicProvider)):
            active.timeout = 15
            active.retries = 0
        try:
            reply = active.complete(
                [Message(role="user", content="Reply with OK.")],
                model=record.default_model or "",
                max_tokens=8,
            )
            if not str(reply).strip():
                raise RuntimeError("The provider returned an empty response.")
        except Exception as error:
            # Some providers echo submitted credentials or request bodies in errors.
            # Never return those bodies to the renderer.
            raise ValueError(
                "Connection test failed. Check the API key, model name, base URL, "
                "account credits, and network connection. Your saved connection was not changed."
            ) from error
        return {"status": "ready", "message": "Connection tested successfully."}

    def resolve(
        self, requested: str | None, fallback: LLMProvider, injected: bool, model: str = ""
    ) -> tuple[LLMProvider, str]:
        selected = requested or self.repo.learning_provider()
        if selected:
            active, resolved = build_for(selected, self.repo.list_providers())
            if isinstance(active, FakeProvider) or (
                resolved.spec.requires_key and not resolved.api_key
            ):
                raise ValueError("Configure an AI connection before using cleaning or learning.")
            return active, model or resolved.model or ""
        if not injected and isinstance(fallback, FakeProvider):
            raise ValueError(
                "Set up an AI provider connection to clean conversations and generate lessons."
            )
        return fallback, model or str(getattr(fallback, "model", "") or "")
