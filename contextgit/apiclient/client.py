"""Execute one composed HTTP request via httpx, for the API tab.

Errors (bad URL, connection failure, invalid JSON body) become
`HttpRequestError` so the API maps them to a single, readable status.
"""

from __future__ import annotations

import base64
import json
import time

import httpx

from contextgit.core.errors import HttpRequestError
from contextgit.core.models import HttpRequestSpec, HttpResponseResult

# Cap the body we hand to the renderer; the full size is still reported.
MAX_BODY = 512 * 1024


def send_request(
    spec: HttpRequestSpec, transport: httpx.BaseTransport | None = None
) -> HttpResponseResult:
    """Perform the request; `transport` is only used by tests."""
    url = spec.url.strip()
    if not url:
        raise HttpRequestError("a request needs a URL")

    headers = {kv.name: kv.value for kv in spec.headers if kv.enabled and kv.name}
    if spec.auth_value:
        if spec.auth_kind == "bearer":
            headers.setdefault("Authorization", f"Bearer {spec.auth_value}")
        elif spec.auth_kind == "basic":
            token = base64.b64encode(spec.auth_value.encode()).decode()
            headers.setdefault("Authorization", f"Basic {token}")
        elif spec.auth_kind == "api-key":
            headers.setdefault("X-API-Key", spec.auth_value)
        elif spec.auth_kind == "cookie":
            headers.setdefault("Cookie", spec.auth_value)
    params = {kv.name: kv.value for kv in spec.params if kv.enabled and kv.name}

    json_body: object | None = None
    raw_body: bytes | None = None
    if spec.body_kind == "json" and spec.body.strip():
        try:
            json_body = json.loads(spec.body)
        except json.JSONDecodeError as exc:
            raise HttpRequestError(f"body is not valid JSON: {exc}") from exc
    elif spec.body_kind == "form" and spec.body.strip():
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        raw_body = spec.body.encode()
    elif spec.body_kind == "text" and spec.body:
        raw_body = spec.body.encode()

    started = time.perf_counter()
    try:
        with httpx.Client(
            timeout=spec.timeout_s,
            verify=spec.verify_tls,
            follow_redirects=spec.follow_redirects,
            transport=transport,
        ) as client:
            response = client.request(
                spec.method.upper() or "GET",
                url,
                params=params,
                headers=headers,
                json=json_body,
                content=raw_body,
            )
    except httpx.HTTPError as exc:
        raise HttpRequestError(str(exc)) from exc
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    raw = response.content
    return HttpResponseResult(
        status=response.status_code,
        reason=response.reason_phrase,
        headers={key: value for key, value in response.headers.items()},
        body=raw[:MAX_BODY].decode("utf-8", errors="replace"),
        truncated=len(raw) > MAX_BODY,
        elapsed_ms=elapsed_ms,
        size=len(raw),
        url=str(response.url),
    )
