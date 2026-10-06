"""The research engine: deep, competitive, lead and verify, all offline.

The LLM is a scripted FakeProvider and the search backend is the deterministic
MockSearch, so the whole loop runs without a network or a key.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider


def parse(response_text: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    for block in response_text.strip().split("\n\n"):
        name: str | None = None
        data: dict[str, object] | None = None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name is not None and data is not None:
            events.append((name, data))
    return events


def deep_provider() -> FakeProvider:
    return FakeProvider(
        {
            '"task": "plan"': json.dumps({"sub_questions": ["what is a token bucket"]}),
            '"task": "extract"': json.dumps(
                {"learnings": ["a token bucket refills over time"], "follow_up_questions": []}
            ),
            '"task": "report"': "# Token buckets\n\nA bucket refills over time [1].\n",
        }
    )


def client_for(repo: Repo, provider: FakeProvider) -> TestClient:
    return TestClient(create_app(repo=repo, provider=provider))


def test_deep_research_streams_steps_and_commits(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo, deep_provider())
    response = client.post(
        "/api/v1/research/stream",
        json={"mode": "deep", "prompt": "how do token buckets work", "depth": 1},
    )
    assert response.status_code == 200
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert "step" in kinds
    assert "source" in kinds
    assert "report" in kinds
    assert kinds[-1] == "done"

    report = "".join(str(data["text"]) for name, data in events if name == "report")
    assert "Token buckets" in report

    done = next(data for name, data in events if name == "done")
    assert done["commit_id"]
    commit = repo.log()[0]
    assert commit.summary is not None and "deep research" in commit.summary
    assert "# Token buckets" in commit.messages[1].content

    # The citation snapshot is written for auditing.
    run_id = str(done["run_id"])
    assert (repo.root / "research" / run_id / "run.json").exists()


def test_research_stream_with_session_stages(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo, deep_provider())
    session = client.post(
        "/api/v1/sessions", json={"name": "research session", "auto_commit": False}
    ).json()
    response = client.post(
        "/api/v1/research/stream",
        json={
            "mode": "deep",
            "prompt": "how do token buckets work",
            "depth": 1,
            "session_id": session["id"],
        },
    )
    events = parse(response.text)
    done = next(data for name, data in events if name == "done")
    assert done["staged"] is True
    assert done["commit_id"] is None
    staged = client.get(f"/api/v1/sessions/{session['id']}/staging").json()
    assert [message["content"] for message in staged][0] == "how do token buckets work"
    assert len(repo.log(session["branch"])) == 1  # root only — nothing committed


def test_competitive_returns_a_matrix(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    provider = FakeProvider(
        {
            '"task": "plan"': json.dumps({"sub_questions": ["competitors"]}),
            '"task": "compare"': json.dumps(
                {
                    "rows": [
                        {
                            "competitor": "Acme",
                            "pricing": "freemium",
                            "positioning": "cheap",
                            "features": ["fast"],
                            "target": "startups",
                            "weaknesses": ["no SSO"],
                            "sources": [1],
                        }
                    ],
                    "how_we_differ": "we keep history",
                }
            ),
        }
    )
    client = client_for(repo, provider)
    response = client.post(
        "/api/v1/research/stream",
        json={"mode": "competitive", "prompt": "the widget market", "depth": 1},
    )
    events = parse(response.text)
    kinds = [name for name, _ in events]
    assert "result" in kinds
    result = next(data for name, data in events if name == "result")
    assert result["mode"] == "competitive"
    assert result["rows"][0]["competitor"] == "Acme"  # type: ignore[index]
    assert "| Competitor |" in repo.log()[0].messages[1].content


def test_lead_sources_only(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    provider = FakeProvider(
        {
            '"task": "plan"': json.dumps({"sub_questions": ["Acme company"]}),
            '"task": "lead"': json.dumps(
                {
                    "name": "Acme",
                    "website": "https://acme.example",
                    "description": "makes widgets",
                    "signals": [{"kind": "press", "detail": "raised a round", "source_id": 1}],
                }
            ),
        }
    )
    client = client_for(repo, provider)
    response = client.post(
        "/api/v1/research/stream",
        json={"mode": "lead", "prompt": "Acme", "depth": 1},
    )
    events = parse(response.text)
    result = next(data for name, data in events if name == "result")
    assert result["name"] == "Acme"
    assert result["signals"][0]["kind"] == "press"  # type: ignore[index]
    assert "no contacts" not in repo.log()[0].messages[1].content.lower()


def test_verify_marks_claims(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo.commit([Message(role="user", content="we cache in-process")], model="test")
    provider = FakeProvider(
        {
            '"task": "claims"': json.dumps({"claims": ["caching is in-process"]}),
            '"task": "verify"': json.dumps(
                {
                    "verdicts": [
                        {
                            "claim": "caching is in-process",
                            "verdict": "contradicted",
                            "evidence": "the docs say shared Redis",
                            "source_id": 1,
                        }
                    ]
                }
            ),
        }
    )
    client = client_for(repo, provider)
    response = client.post(
        "/api/v1/research/stream",
        json={"mode": "verify", "prompt": "check our caching claim", "depth": 1},
    )
    events = parse(response.text)
    result = next(data for name, data in events if name == "result")
    assert result["verdicts"][0]["verdict"] == "contradicted"  # type: ignore[index]
    assert "contradicted" in repo.log()[0].messages[1].content


def test_research_unknown_provider_is_404(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = client_for(repo, deep_provider())
    response = client.post(
        "/api/v1/research/stream",
        json={"mode": "deep", "prompt": "x", "provider": "nope"},
    )
    assert response.status_code == 404
