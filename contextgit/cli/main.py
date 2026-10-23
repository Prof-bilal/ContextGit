"""`ctx` command line interface. Thin wrapper over core: parse, call, print.

Human-readable by default, machine-readable with --json. Domain errors are
printed as messages, never tracebacks.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

import typer

from contextgit.core import models as m
from contextgit.core.errors import ContextGitError
from contextgit.core.repo import Repo
from contextgit.core.task_service import TaskService, TaskView
from contextgit.issues import run_scan
from contextgit.llm import OpenAICompatibleProvider
from contextgit.merge.models import MergePreview

app = typer.Typer(name="ctx", help="Version control for LLM conversations.", no_args_is_help=True)
issues_app = typer.Typer(name="issues", help="Scan the repository and manage findings.")
app.add_typer(issues_app)
task_app = typer.Typer(name="task", help="Create, start and stop tasks on the team graph.")
app.add_typer(task_app)

JsonOpt = Annotated[bool, typer.Option("--json", help="Emit machine-readable JSON.")]


@app.command()
def web(
    port: Annotated[int, typer.Option(help="Browser UI port; 0 chooses a free port.")] = 0,
    api_port: Annotated[int, typer.Option(help="Local API port; 0 chooses a free port.")] = 0,
    project: Annotated[Path | None, typer.Option(help="Open this project on launch.")] = None,
) -> None:
    """Open the lightweight ContextGit workbench in the default browser."""
    from contextgit.web import run

    run(port=port, api_port=api_port, project=project)


def _repo() -> Repo:
    return Repo.open(Path.cwd())


def _print_task(view: TaskView, as_json: bool) -> None:
    if as_json:
        typer.echo(json.dumps(view.to_json()))
        return
    typer.echo(f"{view.id[:8]}  {view.phase:<14} {view.title}")
    if view.branch:
        typer.echo(f"  branch    {view.branch}")
    if view.worktree_path:
        typer.echo(f"  worktree  {view.worktree_path}")
    if view.agent_run_id:
        typer.echo(f"  run       {view.agent_run_id}")
    if view.agent:
        supported = [name for name, on in view.capabilities.items() if on]
        typer.echo(
            f"  agent     {view.agent} ({', '.join(supported) or 'no declared capabilities'})"
        )
        if view.unsupported:
            typer.echo(f"  unsupported {', '.join(view.unsupported)}")
    if view.blocked_by:
        typer.echo(f"  waiting   {', '.join(view.blocked_by)}")


def _task_service() -> TaskService:
    return TaskService(_repo())


@task_app.command("create")
def task_create(
    title: Annotated[str, typer.Argument()],
    brief: Annotated[str, typer.Option("--brief")] = "",
    done: Annotated[str, typer.Option("--done", help="Done criteria.")] = "",
    scope: Annotated[list[str] | None, typer.Option("--scope", help="File glob to claim.")] = None,
    depends_on: Annotated[list[str] | None, typer.Option("--depends-on")] = None,
    parent: Annotated[str | None, typer.Option("--parent", help="Parent task id.")] = None,
    as_json: JsonOpt = False,
) -> None:
    """Add a task to the team graph."""
    try:
        view = _task_service().create(
            title,
            brief=brief,
            done_criteria=done,
            scope=scope,
            depends_on=depends_on,
            parent_id=parent,
        )
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    _print_task(view, as_json)


@task_app.command("list")
def task_list(as_json: JsonOpt = False) -> None:
    """List the team's tasks with their lifecycle phase."""
    try:
        views = _task_service().list_tasks()
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps([view.to_json() for view in views]))
        return
    if not views:
        typer.echo("no tasks yet")
    for view in views:
        _print_task(view, as_json=False)


@task_app.command("show")
def task_show(task_id: Annotated[str, typer.Argument()], as_json: JsonOpt = False) -> None:
    """Show one task with its branch, worktree and run."""
    try:
        view = _task_service().show(task_id)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    _print_task(view, as_json)


@task_app.command("start")
def task_start(
    task_id: Annotated[str, typer.Argument()],
    agent: Annotated[
        str | None, typer.Option("--agent", help="codex, claude, opencode or terminal.")
    ] = None,
    as_json: JsonOpt = False,
) -> None:
    """Start a ready task: its own worktree, branch and session."""
    try:
        view = _task_service().start(task_id, agent=agent)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    _print_task(view, as_json)


@task_app.command("retry")
def task_retry(
    task_id: Annotated[str, typer.Argument()],
    agent: Annotated[str | None, typer.Option("--agent", help="Provider to use.")] = None,
    as_json: JsonOpt = False,
) -> None:
    """Restart a stopped task with a fresh worktree and session."""
    try:
        view = _task_service().retry(task_id, agent=agent)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    _print_task(view, as_json)


@task_app.command("stop")
def task_stop(
    task_id: Annotated[str, typer.Argument()],
    note: Annotated[str, typer.Option("--note")] = "stopped by user",
    as_json: JsonOpt = False,
) -> None:
    """Stop a running task; it is marked failed with the given note."""
    try:
        view = _task_service().stop(task_id, note)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    _print_task(view, as_json)


@app.command()
def init(
    path: Annotated[Path, typer.Argument()] = Path("."),
    author: Annotated[str | None, typer.Option()] = None,
) -> None:
    """Create a new repository with a root commit on branch `main`."""
    try:
        repo = Repo.init(path, author=author)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    typer.echo(f"initialized repository in {repo.root} (branch main)")


@app.command()
def commit(
    message: Annotated[str, typer.Argument(help="User message content for this commit.")],
    model: Annotated[str, typer.Option("--model")],
    summary: Annotated[str | None, typer.Option()] = None,
    author: Annotated[str | None, typer.Option()] = None,
    as_json: JsonOpt = False,
) -> None:
    """Record a commit with one user message on the current branch."""
    try:
        commit_obj = _repo().commit(
            [MessageIn(message)], model=model, summary=summary, author=author
        )
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps(_commit_json(commit_obj)))
    else:
        typer.echo(f"[{commit_obj.id[:7]}] {summary or message}")
        typer.echo(f"  1 message, model {commit_obj.model}")


@app.command()
def log(
    branch: Annotated[str | None, typer.Option()] = None,
    as_json: JsonOpt = False,
) -> None:
    """Show commits on a branch, newest first."""
    try:
        commits = _repo().log(branch)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps([_commit_json(c) for c in commits]))
        return
    for c in commits:
        parents = ", ".join(p[:7] for p in c.parent_ids) or "-"
        label = " (merge)" if c.kind == "merge" else ""
        typer.echo(f"{c.id[:7]} {c.kind}{label} parents: {parents}  {c.summary or ''}")


@app.command()
def branch(
    name: Annotated[str | None, typer.Argument()] = None,
    from_commit: Annotated[str | None, typer.Option("--from")] = None,
    as_json: JsonOpt = False,
) -> None:
    """Create a branch (or list branches when no name is given)."""
    try:
        repo = _repo()
        if name is None:
            branches = repo.list_branches()
            if as_json:
                typer.echo(json.dumps([b.model_dump() for b in branches]))
            else:
                current = repo.current_branch()
                for b in branches:
                    marker = "* " if b.name == current else "  "
                    typer.echo(f"{marker}{b.name} -> {b.head_commit_id[:7]}")
            return
        created = repo.branch(name, from_commit=from_commit)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps(created.model_dump()))
    else:
        typer.echo(f"branch '{created.name}' at {created.head_commit_id[:7]}")


@app.command()
def checkout(
    ref: Annotated[str, typer.Argument(help="Branch name.")],
) -> None:
    """Switch to a branch."""
    try:
        resolved = _repo().checkout(ref)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    typer.echo(f"on branch '{resolved}'")


@app.command()
def context(
    commit_id: Annotated[str | None, typer.Argument()] = None,
    as_json: JsonOpt = False,
) -> None:
    """Print the reconstructed context at a commit (default: current head)."""
    try:
        repo = _repo()
        cid = commit_id or repo.log()[0].id
        messages = repo.build_context(cid)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps([{"role": msg.role, "content": msg.content} for msg in messages]))
        return
    for msg in messages:
        typer.echo(f"--- {msg.role} ---")
        typer.echo(msg.content)


@app.command()
def tag(
    name: Annotated[str, typer.Argument()],
    commit_id: Annotated[str | None, typer.Argument()] = None,
    label: Annotated[str | None, typer.Option()] = None,
    as_json: JsonOpt = False,
) -> None:
    """Label a commit (e.g. a known-good state)."""
    try:
        created = _repo().tag(name, commit_id=commit_id, label=label)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps(created.model_dump()))
    else:
        typer.echo(f"tag '{created.name}' -> {created.commit_id[:7]}")


@app.command()
def diff(
    a: Annotated[str, typer.Argument(help="First branch or commit id.")],
    b: Annotated[str, typer.Argument(help="Second branch or commit id.")],
    as_json: JsonOpt = False,
) -> None:
    """Show message and token differences since the common ancestor."""
    try:
        result = _repo().diff(a, b)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(result.model_dump_json())
        return
    typer.echo(f"common ancestor {result.ancestor_id[:7]}")
    typer.echo(f"A: {len(result.a_messages)} messages, {result.a_token_count} estimated tokens")
    for message in result.a_messages:
        typer.echo(f"  + [{message.role}] {message.content}")
    typer.echo(f"B: {len(result.b_messages)} messages, {result.b_token_count} estimated tokens")
    for message in result.b_messages:
        typer.echo(f"  + [{message.role}] {message.content}")
    typer.echo(f"token delta (B - A): {result.token_delta}")


@app.command()
def merge(
    source: Annotated[str, typer.Argument(help="Source branch to merge.")],
    into: Annotated[str | None, typer.Option(help="Target branch.")] = None,
    apply: Annotated[bool, typer.Option("--apply", help="Apply the current preview.")] = False,
    resolve: Annotated[
        list[str] | None, typer.Option(help="Resolution id=source|target|text.")
    ] = None,
    summary: Annotated[str | None, typer.Option(help="Edit the proposed merge summary.")] = None,
    preview_file: Annotated[
        Path | None, typer.Option(help="Read/write a saved preview JSON file.")
    ] = None,
    as_json: JsonOpt = False,
) -> None:
    """Preview a merge; pass --apply to write the approved summary commit."""
    try:
        repo = _repo()
        if apply and preview_file is None:
            raise typer.BadParameter("--apply requires --preview-file from a reviewed preview")
        if apply:
            if preview_file is None:
                raise typer.BadParameter("--apply requires --preview-file")
            try:
                preview = MergePreview.model_validate_json(preview_file.read_text("utf-8"))
            except (OSError, ValueError) as e:
                raise typer.BadParameter(f"cannot read a valid preview file: {e}") from e
        else:
            provider = OpenAICompatibleProvider() if os.getenv("CTX_LLM_API_KEY") else None
            preview = repo.preview_merge(source, into, provider=provider)
            if summary is not None:
                preview.summary = summary
                preview.messages = [m.Message(role="assistant", content=summary)]
            if preview_file is not None:
                try:
                    preview_file.write_text(
                        preview.model_dump_json(indent=2) + chr(10), encoding="utf-8"
                    )
                except OSError as e:
                    raise typer.BadParameter(f"cannot write preview file: {e}") from e
        if preview.source_branch != source or (into is not None and preview.target_branch != into):
            raise typer.BadParameter(
                "saved preview does not match the requested source/target branches"
            )
        resolutions: dict[str, str] = {}
        for item in resolve or []:
            conflict_id, separator, choice = item.partition("=")
            if not separator or not conflict_id or not choice:
                raise typer.BadParameter("--resolve must use id=source|target|edited text")
            resolutions[conflict_id] = choice
        if apply:
            result = repo.apply_merge(preview, resolutions=resolutions, summary=summary)
            if as_json:
                typer.echo(result.model_dump_json())
            else:
                typer.echo(f"[{result.id[:7]}] merge commit created on {preview.target_branch}")
                typer.echo(result.summary or "")
            return
        if as_json:
            typer.echo(preview.model_dump_json())
            return
        typer.echo(f"common ancestor  {preview.ancestor_id[:7]}")
        typer.echo("extracting decisions, facts, dead ends, open questions")
        if preview.conflicts:
            typer.echo(f"{len(preview.conflicts)} conflict(s)")
            for conflict in preview.conflicts:
                typer.echo(
                    f"  {conflict.id}: {conflict.topic} "
                    f"(target: {conflict.target}; source: {conflict.source})"
                )
        if preview.fallback:
            typer.echo("semantic extraction unavailable; using verbatim messages (low confidence)")
        typer.echo(f"\nPreview for {preview.target_branch} <- {preview.source_branch}:")
        typer.echo(preview.summary)
        typer.echo("\nNothing is applied until you approve with --apply.")
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e


@app.command()
def note(
    content: Annotated[str, typer.Argument(help="Dead-end note or observation.")],
    summary: Annotated[str | None, typer.Option()] = None,
    author: Annotated[str | None, typer.Option()] = None,
    as_json: JsonOpt = False,
) -> None:
    """Record a dead end without discarding what the branch learned."""
    try:
        created = _repo().note(content, summary=summary, author=author)
    except ContextGitError as e:
        typer.echo(f"error: {e}", err=True)
        raise typer.Exit(1) from e
    if as_json:
        typer.echo(json.dumps(_commit_json(created)))
    else:
        typer.echo(f"[{created.id[:7]}] note: {created.summary}")


@issues_app.command("scan")
def issues_scan(
    github_issues: Annotated[
        bool, typer.Option("--github-issues", help="Create eligible GitHub issues.")
    ] = False,
    as_json: JsonOpt = False,
) -> None:
    """Run a safe repository scan."""
    repo = _repo()
    config = repo.issue_config()
    if github_issues:
        config.auto_create = True
        repo.save_issue_config(config)
    result = run_scan(repo, "github_actions" if github_issues else "manual")
    if as_json:
        typer.echo(result.model_dump_json())
    else:
        typer.echo(f"scan {result.status}: {sum(result.counts.values())} finding(s)")


# ---------- helpers ----------


def MessageIn(content: str) -> m.Message:
    """Build a user Message from CLI input."""
    return m.Message(role="user", content=content)


def _commit_json(c: m.Commit) -> dict[str, object]:
    return {
        "id": c.id,
        "parents": c.parent_ids,
        "kind": c.kind,
        "model": c.model,
        "summary": c.summary,
        "messages": [{"role": msg.role, "content": msg.content} for msg in c.messages],
    }


def main() -> None:  # entry point: ctx = contextgit.cli.main:main
    app()


if __name__ == "__main__":
    main()
