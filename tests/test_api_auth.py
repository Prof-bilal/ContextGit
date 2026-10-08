"""Desktop launch-token authentication covers normal and streaming routes."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from contextgit.api.app import create_app


def test_launch_token_protects_api_and_streams(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTEXTGIT_API_TOKEN", "test-launch-token")
    with TestClient(create_app(repo_path=tmp_path / "repo")) as client:
        assert client.get("/api/v1/health").status_code == 200
        for method, route in [("GET", "/api/v1/repo"), ("POST", "/api/v1/chat")]:
            assert client.request(method, route).status_code == 401
            assert client.request(
                method, route, headers={"Authorization": "Bearer wrong"}
            ).status_code == 401
        assert client.get(
            "/api/v1/repo", headers={"Authorization": "Bearer test-launch-token"}
        ).status_code == 200


def test_cors_preflight_remains_available(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTEXTGIT_API_TOKEN", "test-launch-token")
    with TestClient(create_app(repo_path=tmp_path / "repo")) as client:
        response = client.options(
            "/api/v1/repo",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
