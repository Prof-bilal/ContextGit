"""Provider errors are surfaced readably, not as a KeyError on 'choices'.

A local HTTP server stands in for a provider, so the exact OpenRouter case
(an error body with no `choices`) is reproducible without a network or key.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from contextgit.core.models import Message
from contextgit.llm.http_error import describe_payload
from contextgit.llm.openai_compatible import OpenAICompatibleProvider


class _Handler(BaseHTTPRequestHandler):
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


def serve(status: int, payload: dict[str, Any]) -> ThreadingHTTPServer:
    handler = type("H", (_Handler,), {"status": status, "payload": payload})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def provider_for(server: ThreadingHTTPServer) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        api_key="sk-test", base_url=f"http://127.0.0.1:{server.server_port}", retries=0
    )


def test_describe_payload_prefers_the_provider_message() -> None:
    assert describe_payload({"error": {"message": "User not found.", "code": 401}}) == (
        "User not found."
    )
    assert describe_payload({"message": "bad model"}) == "bad model"
    assert "without 'choices'" in describe_payload({"foo": "bar"})


def test_openrouter_401_is_readable() -> None:
    server = serve(401, {"error": {"message": "User not found.", "code": 401}})
    try:
        with pytest.raises(RuntimeError) as excinfo:
            provider_for(server).complete([Message(role="user", content="ping")], max_tokens=1)
    finally:
        server.shutdown()
    message = str(excinfo.value)
    assert "User not found." in message
    assert "'choices'" not in message


def test_200_body_without_choices_is_readable() -> None:
    # Some gateways return an error object with a 200 status.
    server = serve(200, {"error": {"message": "No endpoints found for this model"}})
    try:
        with pytest.raises(RuntimeError) as excinfo:
            provider_for(server).complete([Message(role="user", content="ping")])
    finally:
        server.shutdown()
    message = str(excinfo.value)
    assert "No endpoints found" in message
    assert "'choices'" not in message


def test_successful_completion_still_works() -> None:
    server = serve(200, {"choices": [{"message": {"role": "assistant", "content": "pong"}}]})
    try:
        reply = provider_for(server).complete([Message(role="user", content="ping")])
    finally:
        server.shutdown()
    assert reply == "pong"
