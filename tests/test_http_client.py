"""The API tab: request building, collections on disk and request history."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from contextgit.api import app as app_module
from contextgit.api.app import create_app
from contextgit.apiclient.client import send_request
from contextgit.apiclient.store import CollectionStore
from contextgit.core.errors import CollectionNotFound, HttpRequestError
from contextgit.core.models import (
    HttpCollection,
    HttpKeyValue,
    HttpRequestSpec,
    HttpResponseResult,
    HttpSavedRequest,
)
from contextgit.core.repo import Repo
from contextgit.llm.fake import FakeProvider


def test_send_request_builds_method_params_headers_and_json_body() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        seen["content-type"] = request.headers.get("content-type")
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"ok": True})

    spec = HttpRequestSpec(
        method="post",
        url="https://api.example.com/things",
        params=[
            HttpKeyValue(name="page", value="2"),
            HttpKeyValue(name="off", value="x", enabled=False),
        ],
        headers=[HttpKeyValue(name="X-Trace", value="abc")],
        body_kind="json",
        body='{"name": "widget"}',
        auth_kind="bearer",
        auth_value="secret",
    )
    result = send_request(spec, transport=httpx.MockTransport(handler))

    assert seen["method"] == "POST"
    assert seen["url"] == "https://api.example.com/things?page=2"
    assert seen["authorization"] == "Bearer secret"
    assert seen["content-type"] == "application/json"
    assert seen["body"] == json.dumps({"name": "widget"}, separators=(",", ":"))
    assert result.status == 200
    assert '"ok"' in result.body
    assert result.size > 0
    assert result.elapsed_ms >= 0


def test_auth_basic_and_api_key_variants() -> None:
    captured: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append({key.lower(): value for key, value in request.headers.items()})
        return httpx.Response(204)

    send_request(
        HttpRequestSpec(url="https://api.example.com/x", auth_kind="basic", auth_value="u:p"),
        transport=httpx.MockTransport(handler),
    )
    send_request(
        HttpRequestSpec(url="https://api.example.com/x", auth_kind="api-key", auth_value="k"),
        transport=httpx.MockTransport(handler),
    )

    expected = base64.b64encode(b"u:p").decode()
    assert captured[0]["authorization"] == f"Basic {expected}"
    assert captured[1]["x-api-key"] == "k"


def test_invalid_json_body_is_rejected() -> None:
    with pytest.raises(HttpRequestError, match="not valid JSON"):
        send_request(HttpRequestSpec(url="https://x.test", body_kind="json", body="{oops"))


def test_missing_url_is_rejected() -> None:
    with pytest.raises(HttpRequestError, match="needs a URL"):
        send_request(HttpRequestSpec())


def test_transport_failure_becomes_a_domain_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(HttpRequestError, match="connection refused"):
        send_request(HttpRequestSpec(url="https://x.test"), transport=httpx.MockTransport(handler))


def test_collection_store_round_trip(tmp_path: Path) -> None:
    store = CollectionStore(tmp_path)
    collection = HttpCollection(
        name="Local",
        requests=[
            HttpSavedRequest(
                name="health",
                spec=HttpRequestSpec(url="http://127.0.0.1:8756/api/v1/health"),
            )
        ],
    )
    store.save(collection)

    assert (tmp_path / "api" / "Local.json").exists()
    assert store.list() == ["Local"]
    assert store.get("Local").requests[0].spec.url.endswith("/health")

    assert store.delete("Local") is True
    assert store.list() == []
    with pytest.raises(CollectionNotFound):
        store.get("Local")


def test_collection_names_cannot_escape_the_repo(tmp_path: Path) -> None:
    store = CollectionStore(tmp_path)
    with pytest.raises(HttpRequestError, match="invalid collection name"):
        store.get("../escape")
    with pytest.raises(HttpRequestError, match="invalid collection name"):
        store.save(HttpCollection(name="boot/strategy"))


def test_http_routes_send_save_and_list_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider()))

    def fake_send(spec: HttpRequestSpec) -> HttpResponseResult:
        return HttpResponseResult(
            status=201,
            reason="Created",
            headers={"x-test": "y"},
            body="hi",
            elapsed_ms=5,
            size=2,
            url=spec.url,
        )

    monkeypatch.setattr(app_module, "send_request", fake_send)

    result = client.post(
        "/api/v1/http/request", json={"method": "post", "url": "https://api.example.com/x"}
    )
    assert result.status_code == 200
    assert result.json()["status"] == 201
    assert result.json()["headers"]["x-test"] == "y"

    assert client.get("/api/v1/http/collections").json() == []
    saved = client.put(
        "/api/v1/http/collections/Local",
        json={
            "name": "ignored",
            "requests": [{"name": "ping", "spec": {"url": "https://api.example.com/ping"}}],
        },
    )
    assert saved.status_code == 200
    assert saved.json()["name"] == "Local"
    assert client.get("/api/v1/http/collections").json() == ["Local"]
    assert client.get("/api/v1/http/collections/Local").json()["requests"][0]["name"] == "ping"

    history = client.get("/api/v1/http/history").json()
    assert history[0]["method"] == "POST"
    assert history[0]["url"] == "https://api.example.com/x"
    assert history[0]["status"] == 201

    assert client.delete("/api/v1/http/collections/Local").status_code == 204
    assert client.get("/api/v1/http/collections/Local").status_code == 404
