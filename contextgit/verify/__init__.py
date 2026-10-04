"""Quality gate: run a project's own checks inside a run's worktree.

Two pieces, both small and pure enough to test in isolation:

- `detect_gate` — find the command a project already declares (package.json /
  pyproject / Makefile / Cargo / go.mod); the user can always override it.
- `run_command` — execute one shell line in a worktree with a timeout and
  bounded output, returning a result instead of raising.
"""

from contextgit.verify.detect import detect_gate
from contextgit.verify.runner import CommandResult, run_command

__all__ = ["CommandResult", "detect_gate", "run_command"]
