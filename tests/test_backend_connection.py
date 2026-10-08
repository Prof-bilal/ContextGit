import hashlib

from fastapi.testclient import TestClient

from contextgit.api.app import create_app

ORIGIN = "http://127.0.0.1:5173"


def test_backend_identity_and_cors_errors(tmp_path):
    app = create_app(tmp_path / "repo")

    @app.get("/test-crash")
    def crash():
        raise RuntimeError("test failure")

    with TestClient(app, raise_server_exceptions=False) as client:
        health = client.get("/api/v1/health", headers={"Origin": ORIGIN})
        assert health.headers["access-control-allow-origin"] == ORIGIN
        identity = health.json()
        assert identity["service"] == "contextgit"
        assert (
            identity["repo_id"]
            == hashlib.sha256(str((tmp_path / "repo").resolve()).encode()).hexdigest()
        )
        assert identity["instance_id"]
        for route, status in [
            ("/missing", 404),
            ("/test-crash", 500),
            ("/api/v1/sessions/missing", 404),
        ]:
            response = client.get(route, headers={"Origin": ORIGIN})
            assert response.status_code == status
            assert response.headers["access-control-allow-origin"] == ORIGIN
        preflight = client.options(
            "/api/v1/sessions",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-contextgit-repo",
            },
        )
        assert preflight.status_code == 200
        assert (
            client.options(
                "/api/v1/sessions",
                headers={
                    "Origin": "https://untrusted.example",
                    "Access-Control-Request-Method": "POST",
                },
            ).status_code
            == 400
        )
        mismatch = client.post(
            "/api/v1/sessions",
            json={"name": "must not create"},
            headers={
                "Origin": ORIGIN,
                "X-ContextGit-Repo": "wrong",
            },
        )
        assert mismatch.status_code == 409
        assert mismatch.json()["type"] == "RepositoryMismatch"
        assert mismatch.headers["access-control-allow-origin"] == ORIGIN
        assert client.get("/api/v1/sessions").json() == []
