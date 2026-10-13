from pathlib import Path
from fastapi.testclient import TestClient
from contextgit.api.projects import create_desktop_app


def test_projects_are_isolated_without_backend_restart(tmp_path: Path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    token = {"Authorization": "Bearer test-token"}
    with TestClient(create_desktop_app("test-token")) as client:
        initial = client.get("/api/v1/health").json()
        assert client.post("/api/v1/projects/open", json={"path": str(a)}).status_code == 401
        first = client.post("/api/v1/projects/open", headers=token, json={"path": str(a)}).json()
        second = client.post("/api/v1/projects/open", headers=token, json={"path": str(b)}).json()
        assert first["projectId"] != second["projectId"]
        headers_a = {**token, "X-ContextGit-Project": first["projectId"], "X-ContextGit-Repo": first["repoId"]}
        headers_b = {**token, "X-ContextGit-Project": second["projectId"], "X-ContextGit-Repo": second["repoId"]}
        created = client.post("/api/v1/sessions", headers=headers_a, json={"name": "agent A", "kind": "terminal", "project_path": str(a)} )
        assert created.status_code == 201, created.text
        sid = created.json()["id"]
        assert client.get("/api/v1/sessions", headers=headers_b).json() == []
        assert client.post(f"/api/v1/sessions/{sid}/terminal-transcript", headers=headers_a, json={"content": "background output"}).status_code == 200
        assert client.get(f"/api/v1/sessions/{sid}", headers=headers_b).status_code == 404
        assert client.get("/api/v1/sessions", headers=headers_a).json()[0]["id"] == sid
        assert client.get("/api/v1/sessions", headers={**token, "X-ContextGit-Project": "unknown"}).status_code == 409
        assert client.get("/api/v1/sessions", headers={**headers_a, "X-ContextGit-Repo": second["repoId"]}).status_code == 409
        for _ in range(30):
            assert client.post("/api/v1/projects/open", headers=token, json={"path": str(a)}).json() == first
        assert client.get("/api/v1/health").json() == initial


def test_invalid_project_and_error_cors(tmp_path: Path):
    with TestClient(create_desktop_app("test-token")) as client:
        headers = {"Authorization": "Bearer test-token", "Origin": "http://localhost:5173"}
        response = client.post("/api/v1/projects/open", headers=headers, json={"path": str(tmp_path / "missing")})
        assert response.status_code == 400
        assert response.headers["access-control-allow-origin"] == headers["Origin"]
        response = client.get("/api/v1/sessions", headers=headers)
        assert response.status_code == 409
        assert response.headers["access-control-allow-origin"] == headers["Origin"]


def test_idle_eviction_preserves_running_projects(tmp_path: Path):
    token = {"Authorization": "Bearer test-token"}
    with TestClient(create_desktop_app("test-token")) as client:
        handles = []
        for number in range(12):
            path = tmp_path / str(number)
            path.mkdir()
            opened = client.post("/api/v1/projects/open", headers=token, json={"path": str(path)})
            assert opened.status_code == 200, opened.text
            handles.append(opened.json())
            if number == 0:
                headers = {**token, "X-ContextGit-Project": handles[0]["projectId"]}
                session = client.post("/api/v1/sessions", headers=headers, json={"name": "live", "kind": "terminal", "project_path": str(path)}).json()
                assert client.patch(f"/api/v1/sessions/{session['id']}", headers=headers, json={"status": "running"}).status_code == 200
        assert client.get("/api/v1/sessions", headers={**token, "X-ContextGit-Project": handles[0]["projectId"]}).status_code == 200
        assert client.get("/api/v1/sessions", headers={**token, "X-ContextGit-Project": handles[1]["projectId"]}).status_code == 409
        reopened = client.post("/api/v1/projects/open", headers=token, json={"path": handles[1]["path"]})
        assert reopened.json() == handles[1]
