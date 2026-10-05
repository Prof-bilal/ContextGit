"""Image-generation backends for the image mode.

Two real shapes plus an offline one: OpenAI Images (`/images/generations`) and
a local AUTOMATIC1111 server (`/sdapi/v1/txt2img`). `MockImages` returns a
deterministic SVG data URL so the mode works with no key or GPU.
"""

import base64
import hashlib
import time
from typing import Protocol

import httpx
from pydantic import BaseModel

from contextgit.llm.http_error import (
    ProviderHTTPError,
    describe_payload,
    describe_response,
    retryable,
)

# Aspect ratio -> (gpt-image-1, dall-e-3, local SD) pixel sizes.
_SIZES: dict[str, dict[str, str]] = {
    "1:1": {"gpt-image-1": "1024x1024", "dall-e-3": "1024x1024", "sd": "512x512"},
    "16:9": {"gpt-image-1": "1536x1024", "dall-e-3": "1792x1024", "sd": "768x432"},
    "9:16": {"gpt-image-1": "1024x1536", "dall-e-3": "1024x1792", "sd": "432x768"},
    "3:2": {"gpt-image-1": "1536x1024", "dall-e-3": "1792x1024", "sd": "768x512"},
}


class ImageResult(BaseModel):
    """One rendered image: a URL, an inline data URL, or both."""

    index: int
    url: str | None = None
    data_url: str | None = None
    seed: int | None = None
    model: str
    revised_prompt: str | None = None


class ImageTransport(Protocol):
    """The only interface the image mode uses to render a prompt."""

    def generate(
        self, prompt: str, *, model: str, aspect: str = "1:1", count: int = 1
    ) -> list[ImageResult]:
        """Render `count` images for a prompt."""
        ...


def size_for(aspect: str, model: str) -> str:
    """Map an aspect ratio onto a backend's pixel size."""
    family = "sd" if model.startswith("sd") else model
    table = _SIZES.get(aspect, _SIZES["1:1"])
    return table.get(family, table.get("gpt-image-1", "1024x1024"))


def _check(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise ProviderHTTPError(response.status_code, describe_response(response))


class OpenAIImages:
    """OpenAI Images API: `POST {base}/images/generations`."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "https://api.openai.com/v1",
        timeout: float = 120.0,
        retries: int = 2,
    ) -> None:
        self.api_key = api_key or ""
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = max(0, retries)

    def generate(
        self, prompt: str, *, model: str, aspect: str = "1:1", count: int = 1
    ) -> list[ImageResult]:
        body: dict[str, object] = {
            "model": model,
            "prompt": prompt,
            "n": max(1, count),
            "size": size_for(aspect, model),
        }
        if model.startswith("dall-e"):
            body["response_format"] = "b64_json"
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        f"{self.base_url}/images/generations",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    _check(response)
                    data = response.json()
                entries = data.get("data") if isinstance(data, dict) else None
                if not entries:
                    raise ProviderHTTPError(200, describe_payload(data))
                return [
                    ImageResult(
                        index=index,
                        url=entry.get("url"),
                        data_url=_data_url(entry.get("b64_json")),
                        model=model,
                        revised_prompt=entry.get("revised_prompt"),
                    )
                    for index, entry in enumerate(entries)
                ]
            except Exception as exc:
                last = exc
                if not retryable(exc) or attempt == self.retries:
                    break
                time.sleep(min(0.25 * (2**attempt), 2.0))
        raise RuntimeError(f"image generation failed: {last}") from last


class LocalSDImages:
    """AUTOMATIC1111 `POST {base}/sdapi/v1/txt2img` (no key, local)."""

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:7860",
        timeout: float = 180.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def generate(
        self, prompt: str, *, model: str, aspect: str = "1:1", count: int = 1
    ) -> list[ImageResult]:
        width, height = size_for(aspect, "sd").split("x")
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    f"{self.base_url}/sdapi/v1/txt2img",
                    json={
                        "prompt": prompt,
                        "width": int(width),
                        "height": int(height),
                        "batch_size": max(1, count),
                        "steps": 25,
                    },
                )
                _check(response)
                data = response.json()
        except Exception as exc:
            raise RuntimeError(f"local image generation failed: {exc}") from exc
        return [
            ImageResult(index=index, data_url=_data_url(image), model=model)
            for index, image in enumerate(data.get("images", []))
        ]


class MockImages:
    """Offline, deterministic SVG tiles — enough to exercise the whole flow."""

    def generate(
        self, prompt: str, *, model: str, aspect: str = "1:1", count: int = 1
    ) -> list[ImageResult]:
        return [
            ImageResult(
                index=index,
                data_url=self._svg(prompt, index),
                seed=self._seed(prompt, index),
                model=model,
            )
            for index in range(max(1, count))
        ]

    @staticmethod
    def _seed(prompt: str, index: int) -> int:
        return int(hashlib.sha1(f"{prompt}:{index}".encode()).hexdigest()[:8], 16)

    @classmethod
    def _svg(cls, prompt: str, index: int) -> str:
        digest = hashlib.sha1(f"{prompt}:{index}".encode()).hexdigest()
        hue = int(digest[:2], 16)
        label = prompt[:42].replace("&", "&amp;").replace("<", "&lt;")
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '
            f'viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="hsl({hue} 60% 22%)"/>'
            f'<stop offset="1" stop-color="hsl({(hue + 60) % 360} 55% 42%)"/></linearGradient>'
            '</defs><rect width="512" height="512" fill="url(#g)"/>'
            f'<text x="28" y="250" fill="#fff" font-family="monospace" font-size="18">'
            f'mock image {index + 1}</text>'
            f'<text x="28" y="278" fill="#fff" font-family="monospace" font-size="13">'
            f'{label}</text></svg>'
        )
        return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")

    @staticmethod
    def decode(data_url: str) -> bytes:
        """Test helper: the raw bytes behind a produced data URL."""
        if "," not in data_url:
            return b""
        payload = data_url.split(",", 1)[1]
        try:
            return base64.b64decode(payload)
        except Exception:
            return b""


def _data_url(b64: str | None) -> str | None:
    return f"data:image/png;base64,{b64}" if b64 else None
