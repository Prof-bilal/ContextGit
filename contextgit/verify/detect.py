"""Find the quality gate a project already declares.

Deterministic and offline: we only read files that are already there and map
them to the command their ecosystem uses. Nothing is inferred at run time, and
every result can be overridden per team or per task.
"""

from __future__ import annotations

import json
import tomllib
from collections.abc import Callable
from pathlib import Path

PYTEST = "python -m pytest -q"


def _package_json_gate(root: Path) -> str | None:
    """Node projects: prefer a test script, then typecheck, then lint."""
    path = root / "package.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    scripts = data.get("scripts") if isinstance(data, dict) else None
    if not isinstance(scripts, dict):
        return None
    if "test" in scripts:
        return "npm test"
    if "typecheck" in scripts:
        return "npm run typecheck"
    if "lint" in scripts:
        return "npm run lint"
    return None


def _makefile_gate(root: Path) -> str | None:
    """A Makefile with a `test:` target beats ecosystem guessing."""
    path = root / "Makefile"
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("test:") or line.startswith("test :"):
            return "make test"
    return None


def _python_gate(root: Path) -> str | None:
    """A tests/ directory or a pytest config in pyproject.toml."""
    if (root / "tests").is_dir():
        return PYTEST
    path = root / "pyproject.toml"
    if not path.is_file():
        return None
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None
    tool = data.get("tool")
    if isinstance(tool, dict) and "pytest" in tool:
        return PYTEST
    return None


def _rust_gate(root: Path) -> str | None:
    return "cargo test" if (root / "Cargo.toml").is_file() else None


def _go_gate(root: Path) -> str | None:
    return "go test ./..." if (root / "go.mod").is_file() else None


# First match wins: a project rarely is two of these at once.
PROBES: tuple[Callable[[Path], str | None], ...] = (
    _package_json_gate,
    _makefile_gate,
    _python_gate,
    _rust_gate,
    _go_gate,
)


def detect_gate(project_path: str | Path) -> str | None:
    """The gate command this project declares, or None when there is none."""
    root = Path(project_path)
    if not root.is_dir():
        return None
    for probe in PROBES:
        command = probe(root)
        if command:
            return command
    return None
