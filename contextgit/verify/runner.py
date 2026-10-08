"""Run one project command inside a run's worktree, with bounded output.

This is the generic runner the git wrapper deliberately is not: a shell line,
a working directory, a timeout, and a result. It is only ever called with a
run's own worktree as the directory, never the shared workspace, so a gate can
never disturb files another run is editing.
"""

from __future__ import annotations

import os
import signal
import subprocess
from dataclasses import dataclass
from pathlib import Path

MAX_OUTPUT = 8000
DEFAULT_TIMEOUT = 900.0
TIMEOUT_EXIT_CODE = 124
UNAVAILABLE_EXIT_CODE = 127


@dataclass(frozen=True)
class CommandResult:
    """What a gate run produced; a failure is data, never an exception."""

    command: str
    exit_code: int
    output: str
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


def run_command(
    command: str,
    cwd: str | Path,
    *,
    env: dict[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> CommandResult:
    """Run `command` (one shell line) in `cwd` and capture bounded output.

    A missing binary, a non-zero exit and a timeout all come back as a
    `CommandResult` — the API layer never sees an exception from a gate.
    """
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            start_new_session=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as expired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
            stdout, stderr = proc.communicate()
            output = _tail(
                _text(expired.stdout)
                + _text(expired.stderr)
                + _text(stdout)
                + _text(stderr)
            )
            return CommandResult(
                command=command,
                exit_code=TIMEOUT_EXIT_CODE,
                output=output or f"timed out after {timeout:.0f}s",
                timed_out=True,
            )
    except OSError as exc:
        return CommandResult(command=command, exit_code=UNAVAILABLE_EXIT_CODE, output=str(exc))

    combined = f"{stdout}{stderr}" if stderr else stdout
    return CommandResult(command=command, exit_code=proc.returncode, output=_tail(combined))


def _text(value: object) -> str:
    """subprocess may hand back bytes when a timeout interrupts it."""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value if isinstance(value, str) else ""


def _tail(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    return "…\n" + text[-limit:]
