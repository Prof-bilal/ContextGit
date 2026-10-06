"""Managed context block: tell each agent which files the other runs own.

A delimited block in the project's `AGENTS.md` (plus `.contextgit/context.md`)
so parallel runs self-limit instead of editing the same files. Rewritten
whenever a run starts; anything inside the markers is ours.
"""

from __future__ import annotations

from pathlib import Path

BEGIN = "<!-- contextgit:begin -->"
END = "<!-- contextgit:end -->"


def context_document(runs: list[dict[str, str]], digest: str | None = None) -> str:
    """The body of the managed block for the given runs, plus an optional digest."""
    lines = [
        "## Parallel runs (managed by ContextGit)",
        "",
        "Each run works in its own git worktree. Stay inside the files you own;",
        "if you must touch a file owned by another run, say so before editing.",
        "",
    ]
    for run in runs:
        scope = run.get("scope") or "(no scope claimed)"
        line = f"- {run.get('name', 'run')} [{run.get('agent') or 'shell'}] - {scope}"
        if run.get("role"):
            line += f" · role: {run['role']}"
        if run.get("skills"):
            line += f" · skills: {run['skills']}"
        lines.append(line)
    if digest and digest.strip():
        lines.extend(["", digest.strip()])
    return "\n".join(lines)


def write_context_block(project_path: str | Path, body: str) -> None:
    """Write or replace the managed block in AGENTS.md; idempotent."""
    root = Path(project_path)
    block = f"{BEGIN}\n{body}\n{END}"
    agents = root / "AGENTS.md"
    try:
        existing = agents.read_text(encoding="utf-8") if agents.exists() else ""
        if BEGIN in existing and END in existing:
            start = existing.index(BEGIN)
            end = existing.index(END) + len(END)
            updated = f"{existing[:start]}{block}{existing[end:]}"
        elif existing.strip():
            updated = f"{existing.rstrip()}\n\n{block}\n"
        else:
            updated = f"{block}\n"
        agents.write_text(updated, encoding="utf-8")
        mirror = root / ".contextgit" / "context.md"
        mirror.parent.mkdir(parents=True, exist_ok=True)
        mirror.write_text(f"{body}\n", encoding="utf-8")
    except OSError:
        # Best-effort: the run still works if the project is read-only.
        return
