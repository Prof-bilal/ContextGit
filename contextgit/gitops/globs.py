"""Path-glob overlap, used to detect two runs claiming the same files.

Deliberately conservative: two patterns are treated as overlapping when their
literal (pre-wildcard) prefixes nest, e.g. `src/**` overlaps `src/api/users.py`.
That catches the cases that matter (a whole directory vs a file inside it)
without a full glob-intersection algorithm.
"""

from __future__ import annotations

import builtins

_WILDCARDS = "*?["


def literal_prefix(pattern: str) -> str:
    """The path before the first wildcard, without a trailing slash."""
    index = len(pattern)
    for position, char in enumerate(pattern):
        if char in _WILDCARDS:
            index = position
            break
    return pattern[:index].rstrip("/")


def globs_overlap(first: str, second: str) -> bool:
    """True when two path globs could match at least one common path."""
    left = literal_prefix(first)
    right = literal_prefix(second)
    if left == right:
        return True
    return left.startswith(f"{right}/") or right.startswith(f"{left}/")


def any_overlap(first: builtins.list[str], second: builtins.list[str]) -> bool:
    """True when any glob in `first` overlaps any glob in `second`."""
    return any(globs_overlap(a, b) for a in first for b in second)
