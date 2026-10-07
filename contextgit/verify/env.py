"""Capture what environment a run had, without ever storing a secret.

Names and hashes only. Comparing two runs then answers "why did this work
yesterday?" with a diff instead of a shrug — and a leaked `.contextgit/` reveals
nothing but variable names.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from contextgit.core.models import EnvDrift, EnvEntry

ENV_FILES = (
    ".env",
    ".env.local",
    ".env.development",
    ".env.dev",
    ".env.test",
    ".env.staging",
    ".env.production",
)
# Names from the real process that are worth recording (never their values).
PROCESS_KEYS = ("NODE_ENV", "PORT", "ENVIRONMENT", "APP_ENV", "LOG_LEVEL", "DEBUG")
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
_HASH_CHARS = 16


def hash_value(value: str) -> str:
    """A short, stable, non-reversible fingerprint of a value."""
    return hashlib.sha256(value.strip().encode("utf-8")).hexdigest()[:_HASH_CHARS]


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        text = path.read_text("utf-8", errors="replace")
    except OSError:
        return values
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _LINE.match(line)
        if not match:
            continue
        key, raw = match.group(1), match.group(2).strip()
        # Tolerate quotes and inline comments; never keep the raw value.
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {'"', "'"}:
            raw = raw[1:-1]
        else:
            raw = raw.split(" #", 1)[0].strip()
        values[key] = raw
    return values


def capture_env(project: Path | str, process_env: dict[str, str] | None = None) -> list[EnvEntry]:
    """Every variable the run would see, as names + hashes, newest file wins."""
    root = Path(project)
    entries: dict[str, EnvEntry] = {}
    for name in ENV_FILES:
        path = root / name
        if not path.is_file():
            continue
        for key, value in _parse_env_file(path).items():
            entries[key] = EnvEntry(key=key, hash=hash_value(value), source=name)
    for key in PROCESS_KEYS:
        env_value = (process_env or {}).get(key)
        if env_value:
            entries.setdefault(
                key, EnvEntry(key=key, hash=hash_value(env_value), source="process")
            )
    return sorted(entries.values(), key=lambda entry: entry.key)


def diff_env(before: list[EnvEntry], after: list[EnvEntry]) -> list[EnvDrift]:
    """How two runs' environments differ, by name, never by value."""
    old = {entry.key: entry for entry in before}
    new = {entry.key: entry for entry in after}
    drift: list[EnvDrift] = []
    for key in sorted(set(old) | set(new)):
        if key not in new:
            drift.append(EnvDrift(key=key, change="removed", before=old[key].hash))
        elif key not in old:
            drift.append(EnvDrift(key=key, change="added", after=new[key].hash))
        elif old[key].hash != new[key].hash:
            drift.append(
                EnvDrift(key=key, change="changed", before=old[key].hash, after=new[key].hash)
            )
    return drift
