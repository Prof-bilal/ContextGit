"""Structured CLI review. Models return data; only the application edits Git.

No tools, project hooks, MCP servers, or permission bypass are enabled. The
prompt carries the relevant versions so inference runs in an empty directory.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["approve", "uncertain", "reject"]},
        "feedback": {"type": "string"},
        "patch": {"type": "string"},
    },
    "required": ["verdict", "feedback", "patch"],
    "additionalProperties": False,
}


class Cancelled(RuntimeError):
    pass


class InvocationFailed(RuntimeError):
    def __init__(self, output: str, exit_code: int) -> None:
        super().__init__(output[-32000:] or f"CLI/check exited with {exit_code}")
        self.exit_code = exit_code


def terminate(child: subprocess.Popen[str]) -> None:
    if os.name == "posix":
        # Descendants can outlive their parent and still hold the output pipe.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif child.poll() is None:
        child.kill()
    child.wait()


def execute(
    args: list[str],
    cwd: Path,
    cancel: threading.Event,
    timeout: int = 900,
    input_text: str | None = None,
    env: dict[str, str] | None = None,
    on_output: Callable[[str], object] | None = None,
) -> str:
    child = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        text=True,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=os.name == "posix",
    )
    deadline = time.monotonic() + timeout
    pending_input = input_text
    try:
        if on_output:
            assert child.stdin and child.stdout
            child.stdin.close()
            lines: queue.Queue[str | None] = queue.Queue()

            def stream() -> None:
                assert child.stdout
                for line in child.stdout:
                    lines.put(line)
                lines.put(None)

            threading.Thread(target=stream, daemon=True).start()
            output = ""
            while True:
                if cancel.is_set():
                    raise Cancelled("Integration cancelled")
                if time.monotonic() >= deadline:
                    raise RuntimeError("Invocation exceeded its 15-minute timeout")
                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    continue
                if line is None:
                    code = child.wait(timeout=5)
                    if code:
                        raise InvocationFailed(output, code)
                    return output
                output = (output + line)[-64000:]
                on_output(output)

        while True:
            if cancel.is_set():
                raise Cancelled("Integration cancelled")
            if time.monotonic() >= deadline:
                raise RuntimeError("Invocation exceeded its 15-minute timeout")
            try:
                output, _ = child.communicate(input=pending_input, timeout=0.1)
                if child.returncode:
                    raise InvocationFailed(output, child.returncode)
                return output
            except subprocess.TimeoutExpired:
                pending_input = None
    finally:
        terminate(child)


class CLIRunner:
    def capability(self, harness: str) -> str:
        if harness not in {"codex", "claude"}:
            raise ValueError("Select Codex or Claude Code")
        binary = shutil.which(harness)
        if not binary:
            raise ValueError(f"{harness} CLI is not installed on the backend PATH")
        args = [binary, "app-server", "--help"] if harness == "codex" else [binary, "--help"]
        help_text = execute(args, Path(tempfile.gettempdir()), threading.Event(), timeout=15)
        required = (
            ["--listen"]
            if harness == "codex"
            else [
                "--json-schema",
                "--tools",
                "--strict-mcp-config",
                "--setting-sources",
            ]
        )
        if any(flag not in help_text for flag in required):
            raise ValueError(f"Update {harness}: required structured/safety flags are unavailable")
        return binary

    def review(
        self, harness: str, prompt: str, cancel: threading.Event, usage: Any
    ) -> dict[str, Any]:
        binary = self.capability(harness)
        with tempfile.TemporaryDirectory(prefix="contextgit-review-") as folder:
            cwd = Path(folder)
            if harness == "claude":
                output = execute(
                    [
                        binary,
                        "-p",
                        "--output-format",
                        "json",
                        "--json-schema",
                        json.dumps(SCHEMA),
                        "--tools",
                        "",
                        "--permission-mode",
                        "default",
                        "--setting-sources",
                        "",
                        "--strict-mcp-config",
                        "--mcp-config",
                        '{"mcpServers":{}}',
                        "--disable-slash-commands",
                        "--settings",
                        '{"disableAllHooks":true}',
                    ],
                    cwd,
                    cancel,
                    input_text=prompt,
                )
                result = json.loads(output)
                usage(
                    {
                        **result.get("usage", {}),
                        **(
                            {"total_cost_usd": result["total_cost_usd"]}
                            if "total_cost_usd" in result
                            else {}
                        ),
                    }
                )
                if result.get("is_error"):
                    raise RuntimeError(result.get("result", "Claude review failed"))
                verdict = result.get("structured_output")
            else:
                # Retain credentials, but never inherit user hooks or tool integrations.
                home = cwd / "codex-home"
                home.mkdir(mode=0o700)
                auth = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "auth.json"
                if auth.exists():
                    shutil.copyfile(auth, home / "auth.json")
                    (home / "auth.json").chmod(0o600)
                verdict = self._codex(
                    binary, cwd, prompt, cancel, usage, {**os.environ, "CODEX_HOME": str(home)}
                )
        if (
            not isinstance(verdict, dict)
            or verdict.get("verdict")
            not in {
                "approve",
                "uncertain",
                "reject",
            }
            or not all(isinstance(verdict.get(key), str) for key in ("feedback", "patch"))
        ):
            raise RuntimeError("CLI returned an invalid review result")
        return verdict

    def _codex(
        self,
        binary: str,
        cwd: Path,
        prompt: str,
        cancel: threading.Event,
        usage: Any,
        env: dict[str, str],
    ) -> dict[str, Any]:
        child = subprocess.Popen(
            [binary, "app-server", "--listen", "stdio://"],
            cwd=cwd,
            env=env,
            text=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=os.name == "posix",
        )
        messages: queue.Queue[str | None] = queue.Queue()

        def read() -> None:
            assert child.stdout
            for line in child.stdout:
                messages.put(line)
            messages.put(None)

        threading.Thread(target=read, daemon=True).start()

        def send(value: dict[str, Any]) -> None:
            assert child.stdin
            child.stdin.write(json.dumps(value) + "\n")
            child.stdin.flush()

        deadline = time.monotonic() + 900
        text = ""
        try:
            send(
                {
                    "id": 1,
                    "method": "initialize",
                    "params": {"clientInfo": {"name": "contextgit_merge", "version": "0.1.0"}},
                }
            )
            while time.monotonic() < deadline:
                if cancel.is_set():
                    raise Cancelled("Integration cancelled")
                try:
                    line = messages.get(timeout=0.1)
                except queue.Empty:
                    continue
                if line is None:
                    raise RuntimeError("Codex app-server exited before completing review")
                record = json.loads(line)
                if record.get("error"):
                    raise RuntimeError(str(record["error"]))
                if record.get("id") == 1:
                    send({"method": "initialized"})
                    send(
                        {
                            "id": 2,
                            "method": "thread/start",
                            "params": {
                                "cwd": str(cwd),
                                "approvalPolicy": "unlessTrusted",
                                "sandbox": "readOnly",
                                "ephemeral": True,
                            },
                        }
                    )
                elif record.get("id") == 2:
                    send(
                        {
                            "id": 3,
                            "method": "turn/start",
                            "params": {
                                "threadId": record["result"]["thread"]["id"],
                                "input": [{"type": "text", "text": prompt}],
                                "outputSchema": SCHEMA,
                            },
                        }
                    )
                elif record.get("method") == "item/completed":
                    item = record.get("params", {}).get("item", {})
                    if item.get("type") == "agentMessage":
                        text = item.get("text", "")
                elif record.get("method") == "thread/tokenUsage/updated":
                    usage(record.get("params", {}).get("tokenUsage", {}))
                elif record.get("method") == "turn/completed":
                    turn = record["params"]["turn"]
                    if turn.get("status") != "completed":
                        raise RuntimeError(str(turn.get("error") or turn.get("status")))
                    return cast(dict[str, Any], json.loads(text))
                elif "id" in record and "method" in record:
                    # Deny all server tool/approval requests, including future integrations.
                    send(
                        {
                            "id": record["id"],
                            "error": {
                                "code": -32601,
                                "message": "Merge review cannot execute tools",
                            },
                        }
                    )
            raise RuntimeError("Codex review exceeded its 15-minute timeout")
        finally:
            terminate(child)
