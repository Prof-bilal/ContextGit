"""Execute one composed HTTP request via httpx, for the API tab.

Errors (bad URL, connection failure, invalid JSON body) become
`HttpRequestError` so the API maps them to a single, readable status.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import socket
import time
from urllib.parse import urljoin, urlparse

import httpx

from contextgit.core.errors import HttpRequestError
from contextgit.core.models import HttpRequestSpec, HttpResponseResult

# Cap the body we hand to the renderer; the full size is still reported.
MAX_BODY = 512 * 1024
MAX_REDIRECTS = 5


def _validate_destination(url: str, *, resolve: bool) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HttpRequestError("only http and https URLs are allowed")
    host = parsed.hostname
    addresses: list[str] = []
    try:
        addresses.append(str(ipaddress.ip_address(host)))
    except ValueError:
        if resolve:
            try:
                addresses = [
                    info[4][0]
                    for info in socket.getaddrinfo(
                        host, parsed.port or 80, type=socket.SOCK_STREAM
                    )
                ]
            except OSError as exc:
                raise HttpRequestError(f"could not resolve request host: {host}") from exc
    for value in addresses:
        address = ipaddress.ip_address(value)
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_unspecified
            or address.is_multicast
        ):
            raise HttpRequestError("requests to local or private network addresses are blocked")


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

    # Mock transports are deliberately exempt from DNS checks: they never open
    # a socket and are used by deterministic unit tests.
    _validate_destination(url, resolve=transport is None)

    started = time.perf_counter()
    try:
        with httpx.Client(
            timeout=spec.timeout_s,
            verify=spec.verify_tls,
            follow_redirects=False,
            transport=transport,
        ) as client:
            current_url = url
            response: httpx.Response
            for _ in range(MAX_REDIRECTS + 1):
                _validate_destination(current_url, resolve=transport is None)
                request_headers = headers
                if current_url != url and urlparse(current_url).netloc != urlparse(url).netloc:
                    request_headers = {
                        key: value
                        for key, value in headers.items()
                        if key.lower() not in {"authorization", "cookie", "x-api-key"}
                    }
                response = client.request(
                    spec.method.upper() or "GET",
                    current_url,
                    params=params if current_url == url else None,
                    headers=request_headers,
                    json=json_body,
                    content=raw_body,
                )
                if not spec.follow_redirects or response.status_code not in {
                    301,
                    302,
                    303,
                    307,
                    308,
                }:
                    break
                location = response.headers.get("location")
                if not location:
                    break
                current_url = urljoin(current_url, location)
            else:
                raise HttpRequestError("too many redirects")
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
