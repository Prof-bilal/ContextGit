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
from contextgit.llm import OpenAICompatibleProvider
from contextgit.merge.models import MergePreview

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
