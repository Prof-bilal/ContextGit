"""`ctx` command line interface. Thin wrapper over core: parse, call, print.

Human-readable by default, machine-readable with --json. Domain errors are
printed as messages, never tracebacks.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from contextgit.core import models as m
from contextgit.core.errors import ContextGitError
from contextgit.core.repo import Repo

app = typer.Typer(name="ctx", help="Version control for LLM conversations.", no_args_is_help=True)

JsonOpt = Annotated[bool, typer.Option("--json", help="Emit machine-readable JSON.")]


def _repo() -> Repo:
    return Repo.open(Path.cwd())


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
