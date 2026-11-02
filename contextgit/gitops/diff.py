"""Working-tree diff of one checkout: what a run changed, per file.

Pure git/filesystem reads for the Changes tab. The unified diff text is capped
so one huge file cannot swamp the response; paths and counts are still listed.
"""

from __future__ import annotations

from pathlib import Path

from .repo import Git


def _z_parts(output: str) -> list[str]:
    """Split NUL-terminated git output into non-empty fields."""
    return [part for part in output.split("\0") if part]


def _statuses(output: str) -> dict[str, str]:
    """Map path -> A/M/D from `git diff --name-status -z`.

    Renames and copies are reported as M under their new path.
    """
    parts = _z_parts(output)
    statuses: dict[str, str] = {}
    index = 0
    while index < len(parts):
        code = parts[index][:1]
        index += 1
        if code in ("R", "C"):
            index += 1  # the old path; the new path follows
        if index >= len(parts):
            break
        path = parts[index]
        index += 1
        statuses[path] = code if code in ("A", "D") else "M"
    return statuses


def _counts(output: str) -> dict[str, tuple[int, int, bool]]:
    """Map path -> (additions, deletions, binary) from `git diff --numstat -z`."""
    parts = _z_parts(output)
    counts: dict[str, tuple[int, int, bool]] = {}
    index = 0
    while index < len(parts):
        fields = parts[index].split("\t")
        index += 1
        if len(fields) < 3:
            continue
        additions, deletions = fields[0], fields[1]
        path = "\t".join(fields[2:])
        if not path:
            # Rename: "<add>\t<del>\t\0<old>\0<new>\0" — count the new path.
            if index + 1 >= len(parts):
                break
            path = parts[index + 1]
            index += 2
        binary = additions == "-" or deletions == "-"
        counts[path] = (
            0 if binary else int(additions),
            0 if binary else int(deletions),
            binary,
        )
    return counts


def _untracked_file(root: Path, path: str) -> dict[str, object]:
    """One untracked file as an added file, or binary when it is not UTF-8 text."""
    try:
        data = (root / path).read_bytes()
    except OSError:
        data = b""
    binary = b"\0" in data
    text = ""
    if not binary:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            binary = True
    if binary:
        return {
            "path": path,
            "status": "A",
            "additions": 0,
            "deletions": 0,
            "binary": True,
            "diff": "",
        }
    lines = text.splitlines()
    diff = "".join(f"+{line}\n" for line in lines)
    return {
        "path": path,
        "status": "A",
        "additions": len(lines),
        "deletions": 0,
        "binary": False,
        "diff": diff,
    }


def working_tree_diff(
    root: Path, base: str = "HEAD", max_bytes: int = 400_000
) -> dict[str, object]:
    """Diff `root`'s working tree against `base`, including untracked files.

    Diff text stops mounting once `max_bytes` is reached; the remaining files
    keep their paths, statuses and counts and `truncated` becomes true.
    """
    git = Git(root)
    if not git.is_repo():
        return {"base": base, "files": [], "truncated": False}

    statuses = _statuses(git.run("diff", "--name-status", "-z", base, check=False).stdout)
    counts = _counts(git.run("diff", "--numstat", "-z", base, check=False).stdout)
    untracked = _z_parts(
        git.run("ls-files", "--others", "--exclude-standard", "-z").stdout
    )

    files: list[dict[str, object]] = []
    for path, status in statuses.items():
        additions, deletions, binary = counts.get(path, (0, 0, False))
        diff = "" if binary else git.run("diff", base, "--", path, check=False).stdout
        files.append(
            {
                "path": path,
                "status": status,
                "additions": additions,
                "deletions": deletions,
                "binary": binary,
                "diff": diff,
            }
        )
    for path in untracked:
        files.append(_untracked_file(Path(root), path))
    files.sort(key=lambda item: str(item["path"]))

    total = 0
    truncated = False
    for item in files:
        text = str(item["diff"])
        if not text:
            continue
        if truncated:
            item["diff"] = ""
            continue
        size = len(text.encode("utf-8"))
        if total + size > max_bytes:
            truncated = True
            item["diff"] = ""
            continue
        total += size
    return {"base": base, "files": files, "truncated": truncated}
