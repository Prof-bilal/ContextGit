"""Read account limits through Codex's documented app-server protocol."""
import json
import queue
import shutil
import subprocess
import threading
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from contextgit.limits.models import HarnessLimits, LimitWindow


def normalize_limits(result: dict[str, Any]) -> HarnessLimits:
    buckets = result.get("rateLimitsByLimitId")
    if not isinstance(buckets, dict) or not buckets:
        buckets = {"codex": result.get("rateLimits") or {}}
    windows: list[LimitWindow] = []
    plan: str | None = None
    for name, bucket in buckets.items():
        if not isinstance(bucket, dict):
            continue
        plan = plan or bucket.get("planType")
        for key in ("primary", "secondary"):
            window = bucket.get(key)
            if not isinstance(window, dict) or not isinstance(
                window.get("usedPercent"), (int, float)
            ):
                continue
            minutes = window.get("windowDurationMins")
            label = (
                "Weekly"
                if minutes == 10080
                else "5-hour"
                if minutes == 300
                else f"{minutes}-minute"
                if minutes
                else key.title()
            )
            if len(buckets) > 1:
                label = f"{bucket.get('limitName') or name} · {label}"
            reset = window.get("resetsAt")
            windows.append(
                LimitWindow(
                    label=label,
                    used=max(0, min(100, window["usedPercent"])),
                    cap=100,
                    unit="%",
                    reset_at=(
                        datetime.fromtimestamp(reset, UTC)
                        if isinstance(reset, (int, float))
                        else None
                    ),
                )
            )
    return HarnessLimits(
        harness="codex",
        label="Codex",
        state="available",
        signed_in=True,
        plan=plan,
        source="Codex account",
        windows=windows,
        message=None if windows else "The account did not return any rate-limit windows.",
    )


def codex_executable() -> str | None:
    executable = shutil.which("codex")
    if executable:
        path = Path(executable)
        try:
            if path.stat().st_size < 4096 and "mise use -g" in path.read_text():
                resolved = subprocess.run(
                    ["mise", "which", "codex"], capture_output=True, text=True, timeout=3
                )
                if resolved.returncode == 0 and Path(resolved.stdout.strip()).is_file():
                    executable = resolved.stdout.strip()
        except (OSError, UnicodeError, subprocess.TimeoutExpired):
            pass
    return executable


def fetch_limits() -> HarnessLimits:
    executable = codex_executable()
    if not executable:
        return HarnessLimits(
            harness="codex",
            label="Codex",
            state="unsupported",
            message="Codex CLI is not installed or is not on PATH.",
        )
    process: subprocess.Popen[str] | None = None
    try:
        process = subprocess.Popen(
            [executable, "app-server", "--stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        messages: queue.Queue[dict[str, Any] | None] = queue.Queue()
        stdout = process.stdout
        stdin = process.stdin
        assert stdout is not None
        assert stdin is not None

        def receive() -> None:
            for line in stdout:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    messages.put(value)
            messages.put(None)
        reader = threading.Thread(target=receive, daemon=True)
        reader.start()
        deadline = time.monotonic() + 12
        def send(value: Mapping[str, Any]) -> None:
            stdin.write(json.dumps(value) + "\n")
            stdin.flush()

        def response(identifier: int) -> dict[str, Any]:
            while time.monotonic() < deadline:
                value = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if value is None:
                    raise OSError("Codex app-server exited")
                if value.get("id") == identifier:
                    return value
            raise queue.Empty
        send(
            {
                "id": 1,
                "method": "initialize",
                "params": {"clientInfo": {"name": "contextgit", "version": "0.2.0"}},
            }
        )
        if "error" in response(1):
            raise OSError("Initialization failed")
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "account/rateLimits/read"})
        value = response(2)
        if "error" in value:
            message = str(value["error"].get("message", "")).lower()
            needs_login = any(word in message for word in ("auth", "login", "sign", "chatgpt"))
            return HarnessLimits(
                harness="codex",
                label="Codex",
                state="not_signed_in" if needs_login else "error",
                message=(
                    "Sign in to Codex CLI with ChatGPT to read account limits."
                    if needs_login
                    else "Codex could not return account limits. Try refreshing."
                ),
            )
        return normalize_limits(value.get("result") or {})
    except (OSError, queue.Empty, ValueError):
        return HarnessLimits(
            harness="codex",
            label="Codex",
            state="error",
            message="Codex account limits could not be read within 12 seconds. Try refreshing.",
        )
    finally:
        if process:
            process.kill()
            process.wait(timeout=3)
            if "reader" in locals():
                reader.join(timeout=1)
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
