"""Provider-backed semantic extraction with validated graceful fallback."""

import json
from importlib import resources

from contextgit.core.models import Message
from contextgit.llm.base import LLMProvider
from contextgit.merge.models import SemanticExtraction

_PROMPT_VERSION = "v1"


def extract_semantics(
    source_messages: list[Message],
    target_messages: list[Message],
    provider: LLMProvider | None,
) -> tuple[SemanticExtraction, bool]:
    """Extract meaning/conflicts; return deterministic low-confidence fallback on failure."""
    if provider is not None:
        try:
            prompt = (
                resources.files("contextgit.merge") / "prompts" / f"{_PROMPT_VERSION}.txt"
            ).read_text("utf-8")
            payload = {
                "source_messages": [m.model_dump(mode="json") for m in source_messages],
                "target_messages": [m.model_dump(mode="json") for m in target_messages],
            }
            request_messages = [
                Message(role="system", content=prompt),
                Message(role="user", content=json.dumps(payload, ensure_ascii=False)),
            ]
            for attempt in range(2):
                result = provider.complete(
                    request_messages,
                    response_format={"type": "json_object"},
                )
                try:
                    return SemanticExtraction.model_validate_json(_strip_fence(result)), False
                except ValueError as exc:
                    if attempt == 1:
                        break
                    request_messages.append(Message(role="assistant", content=result))
                    request_messages.append(
                        Message(
                            role="user",
                            content=(
                                f"The JSON did not match the required schema: {exc}. "
                                "Return corrected JSON only."
                            ),
                        )
                    )
        except Exception:
            # Provider failures must not prevent a verbatim, low-confidence merge.
            pass
    fallback = SemanticExtraction(
        summary="Merge branch changes verbatim; semantic extraction unavailable.",
    )
    return fallback, True


def _strip_fence(text: str) -> str:
    """Accept common markdown-fenced JSON responses without relaxing validation."""
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        return "\n".join(lines[1:-1]).strip()
    return stripped
