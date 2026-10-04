"""The team board: a markdown file every agent can read.

Written to `.contextgit/team.md` and mirrored into a delimited block in the
project's `AGENTS.md`, so any agent CLI (Claude Code, Codex, Gemini, ...) sees
the task graph, who owns which files, and the latest messages — no extra tooling,
no per-CLI configuration. Idempotent and best-effort, exactly like the
parallel-runs context block in `gitops/context.py`.
"""

from __future__ import annotations

from pathlib import Path

from contextgit.core.models import Task, Team, TeamMessage

BEGIN = "<!-- contextgit:team:begin -->"
END = "<!-- contextgit:team:end -->"

# Board order, matching core/team.py STATUS_ORDER.
_COLUMNS: tuple[tuple[str, str], ...] = (
    ("todo", "To do"),
    ("blocked", "Blocked"),
    ("working", "In progress"),
    ("review", "Review"),
    ("done", "Done"),
    ("failed", "Failed"),
)


def _task_line(task: Task, titles: dict[str, str]) -> str:
    """One task as a single markdown bullet an agent can act on."""
    parts = [f"- **{task.title}**", f"[{task.role}]"]
    if task.agent:
        parts.append(f"({task.agent})")
    if task.scope:
        parts.append(f"— owns {', '.join(task.scope)}")
    waiting = [titles.get(dep, dep) for dep in task.blocked_by]
    if waiting:
        parts.append(f"— waiting on {', '.join(waiting)}")
    elif task.depends_on:
        parts.append(f"— after {', '.join(titles.get(dep, dep) for dep in task.depends_on)}")
    if task.done_criteria:
        parts.append(f"— done when: {task.done_criteria}")
    return " ".join(parts)


def team_document(
    team: Team, tasks: list[Task], messages: list[TeamMessage], *, limit: int = 12
) -> str:
    """The board body: the task graph grouped by status, then the latest messages."""
    titles = {task.id: task.title for task in tasks}
    lines = [
        f"## Team: {team.name} (managed by ContextGit)",
        "",
        f"Base: {team.base_ref or 'current branch'}. Work only inside the files your task",
        "owns; if you need a file another task owns, post a message instead of editing it.",
        "",
        "With MCP configured (see `.mcp.json`), the same board is available live:",
        "`team_status`, `list_tasks`, `read_board`, `claim_task`, `complete_task`,",
        "`post_update`, `check_ownership`, `publish_contract`, `peers`.",
        "",
    ]
    if team.gate_command:
        lines.append(f"Quality gate (run before you call `complete_task`): `{team.gate_command}`")
        lines.append("")
    for status, label in _COLUMNS:
        column = [task for task in tasks if task.status == status]
        if not column:
            continue
        lines.append(f"### {label}")
        lines.extend(_task_line(task, titles) for task in column)
        lines.append("")

    if messages:
        lines.append("### Latest messages")
        for message in messages[-limit:]:
            who = titles.get(message.from_task_id or message.task_id or "", "team")
            lines.append(f"- `{message.kind}` {who}: {message.body}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_team_board(project_path: str | Path, body: str) -> None:
    """Write `.contextgit/team.md` and replace the managed team block in AGENTS.md."""
    root = Path(project_path)
    try:
        mirror = root / ".contextgit" / "team.md"
        mirror.parent.mkdir(parents=True, exist_ok=True)
        mirror.write_text(body, encoding="utf-8")

        agents = root / "AGENTS.md"
        block = f"{BEGIN}\n{body.strip()}\n{END}"
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
    except OSError:
        # Best-effort: team mode still works if the project is read-only.
        return
