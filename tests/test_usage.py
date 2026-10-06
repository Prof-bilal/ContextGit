"""Token usage: the event log, aggregation, and real provider usage capture.

Usage is real when the provider returns a `usage` frame (parsed here against a
local HTTP server), and an estimate everywhere else (research, CLI/PTY turns,
and providers that don't report usage).
"""

import json
import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from contextgit.api.app import create_app
from contextgit.core.models import Message, utcnow
from contextgit.core.repo import Repo, _streak_from_dates
from contextgit.llm import FakeProvider
from contextgit.llm.openai_compatible import OpenAICompatibleProvider


class _JsonHandler(BaseHTTPRequestHandler):
    status = 200
    payload: dict[str, Any] = {}

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        self.rfile.read(int(self.headers.get("content-length", 0)))
        body = json.dumps(self.payload).encode("utf-8")
        self.send_response(self.status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


class _SseHandler(BaseHTTPRequestHandler):
    lines: list[str] = []

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        self.rfile.read(int(self.headers.get("content-length", 0)))
        body = "".join(self.lines).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


def _serve(handler: type[BaseHTTPRequestHandler], **attrs: object) -> ThreadingHTTPServer:
    cls = type("H", (handler,), attrs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _provider(server: ThreadingHTTPServer) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        api_key="sk-test", base_url=f"http://127.0.0.1:{server.server_port}", retries=0
    )


def test_complete_reports_real_usage() -> None:
    server = _serve(
        _JsonHandler,
        payload={
            "choices": [{"message": {"role": "assistant", "content": "pong"}}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 3},
        },
    )
    seen: list[tuple[int, int]] = []
    try:
        reply = _provider(server).complete(
            [Message(role="user", content="ping")],
            usage_sink=lambda prompt, completion: seen.append((prompt, completion)),
        )
    finally:
        server.shutdown()
    assert reply == "pong"
    assert seen == [(7, 3)]


def test_stream_reports_real_usage() -> None:
    server = _serve(
        _SseHandler,
        lines=[
            'data: {"choices":[{"delta":{"content":"po"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"ng"}}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
            "data: [DONE]\n\n",
        ],
    )
    seen: list[tuple[int, int]] = []
    try:
        text = "".join(
            _provider(server).stream(
                [Message(role="user", content="ping")],
                usage_sink=lambda prompt, completion: seen.append((prompt, completion)),
            )
        )
    finally:
        server.shutdown()
    assert text == "pong"
    assert seen == [(5, 2)]


def test_repo_usage_aggregation(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo.record_usage(
        "openrouter", "claude", "chat", source="provider", prompt_tokens=100, completion_tokens=50
    )
    repo.record_usage(
        "openrouter", "claude", "council", source="provider", prompt_tokens=10, completion_tokens=5
    )
    repo.record_usage("claude", "claude", "code", source="estimate", prompt_tokens=40)

    summary = repo.usage_summary()
    assert summary.totals.total_tokens == 205
    assert summary.totals.calls == 3
    assert summary.totals.estimated_tokens == 40
    top = summary.by_provider[0]
    assert (top.provider, top.model) == ("openrouter", "claude")
    assert top.totals.total_tokens == 165
    assert {row.surface for row in summary.by_surface} == {"chat", "council", "code"}


def test_localhost_origin_is_allowed(tmp_path: Path) -> None:
    # The desktop dev server (Vite :5173) and a manually-started backend must
    # agree on CORS, or every fetch fails.
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo))
    response = client.get("/api/v1/usage", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_backfill_seeds_history_once(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo.commit(
        [
            Message(role="user", content="x" * 40),
            Message(role="assistant", content="y" * 20),
        ],
        model="gpt-4o-mini",
        branch="main",
    )

    # The first summary reconstructs past work from the commits (estimated).
    first = repo.usage_summary()
    assert first.totals.calls == 1
    assert first.by_provider[0].provider == "gpt-4o-mini"
    assert first.totals.total_tokens == 15  # (40+3)//4 + (20+3)//4
    assert first.totals.estimated_tokens == first.totals.total_tokens

    # Idempotent: a second call does not duplicate the history.
    assert repo.usage_summary().totals.calls == 1


def test_usage_endpoint(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    repo.record_usage(
        "groq", "llama", "chat", source="provider", prompt_tokens=20, completion_tokens=10
    )
    client = TestClient(create_app(repo=repo))
    payload = client.get("/api/v1/usage").json()
    assert payload["totals"]["total_tokens"] == 30
    assert payload["by_provider"][0]["provider"] == "groq"
    # The daily series and the streak join the response.
    today = utcnow().date().isoformat()
    assert len(payload["by_day"]) == 1
    assert payload["by_day"][0]["date"] == today
    assert payload["by_day"][0]["totals"]["total_tokens"] == 30
    # The contribution graph's year-long series rides along, unfiltered.
    assert payload["activity"][0]["date"] == today
    assert payload["activity"][0]["totals"]["total_tokens"] == 30
    assert payload["streak"]["current"] == 1
    assert payload["streak"]["longest"] == 1
    assert payload["streak"]["active_days"] == 1
    assert payload["streak"]["last_active"] == today


def test_streak_counts_consecutive_days() -> None:
    today = date(2026, 10, 6)
    dates = {today - timedelta(days=offset) for offset in range(4)}  # 3rd–6th
    streak = _streak_from_dates(dates, today)
    assert (streak.current, streak.longest, streak.active_days) == (4, 4, 4)
    assert streak.last_active == "2026-10-06"


def test_streak_keeps_the_longest_run_across_a_gap() -> None:
    today = date(2026, 10, 6)
    old = {date(2026, 9, 1) + timedelta(days=offset) for offset in range(5)}  # 1st–5th
    streak = _streak_from_dates(old | {today}, today)
    assert streak.current == 1
    assert streak.longest == 5
    assert streak.active_days == 6


def test_streak_grace_when_today_is_idle() -> None:
    today = date(2026, 10, 6)
    dates = {today - timedelta(days=1), today - timedelta(days=2)}
    streak = _streak_from_dates(dates, today)
    assert streak.current == 2
    assert streak.last_active == "2026-10-05"


def test_streak_breaks_after_a_missed_day() -> None:
    streaks = _streak_from_dates({date(2026, 10, 4)}, date(2026, 10, 6))
    assert streaks.current == 0
    assert streaks.longest == 1


def test_streak_is_empty_with_no_events() -> None:
    streak = _streak_from_dates(set(), date(2026, 10, 6))
    assert (streak.current, streak.longest, streak.active_days, streak.last_active) == (
        0,
        0,
        0,
        None,
    )


def test_chat_turn_records_an_estimate(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    client = TestClient(create_app(repo=repo, provider=FakeProvider(default="hello world")))
    client.post(
        "/api/v1/chat/stream",
        json={"prompt": "hi", "branch": "main", "commit_id": repo.log()[0].id, "model": "fake"},
    )
    payload = client.get("/api/v1/usage").json()
    assert payload["totals"]["calls"] == 1
    assert payload["by_surface"][0]["surface"] == "chat"
    # FakeProvider never reports usage, so the row is an estimate.
    assert payload["totals"]["estimated_tokens"] == payload["totals"]["total_tokens"]


def test_terminal_commit_records_code_usage(tmp_path: Path) -> None:
    repo = Repo.init(tmp_path / "repo")
    session = repo.create_session("claude run", kind="terminal", agent="claude")
    repo.stage(session.id, [Message(role="tool", content="x" * 40)])
    repo.commit_staged(session.id)

    summary = repo.usage_summary()
    assert summary.by_surface[0].surface == "code"
    assert summary.by_provider[0].provider == "claude"
    assert summary.totals.estimated_tokens == 10
