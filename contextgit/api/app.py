"""FastAPI routes are thin validation and serialization wrappers around Repo."""

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from contextgit.api.schemas import (
    BranchRequest,
    ChatRequest,
    CheckoutRequest,
    CommitRequest,
    CommitResponse,
    CommitStagedRequest,
    CompareRequest,
    CompareResult,
    InitRequest,
    MergeApplyRequest,
    MergePreviewRequest,
    RepoSnapshot,
    SessionRequest,
    SessionUpdateRequest,
    StageRequest,
)
from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    ContextGitError,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    RepoAlreadyExists,
    RepoNotFound,
    SessionNotFound,
    StagingEmpty,
    StaleMergePreview,
)
from contextgit.core.models import Message
from contextgit.core.repo import Repo
from contextgit.llm import FakeProvider, LLMProvider, OpenAICompatibleProvider


def create_app(
    repo_path: Path | str | None = None,
    *,
    repo: Repo | None = None,
    provider: LLMProvider | None = None,
) -> FastAPI:
    """Create the local API, optionally injecting a repo and deterministic provider."""
    env_repo = os.getenv("CONTEXTGIT_REPO")
    path = Path(repo_path if repo_path is not None else env_repo or ".contextgit").expanduser()
    llm = provider or (
        OpenAICompatibleProvider() if os.getenv("CTX_LLM_API_KEY") else FakeProvider()
    )
    app = FastAPI(title="ContextGit API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv(
            "CONTEXTGIT_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(","),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    state: dict[str, Repo] = {"repo": repo} if repo is not None else {}

    def get_repo() -> Repo:
        if "repo" not in state:
            try:
                state["repo"] = Repo.open(path)
            except RepoNotFound:
                state["repo"] = Repo.init(path)
        return state["repo"]

    repo_dep = Depends(get_repo)

    @app.exception_handler(ContextGitError)
    async def contextgit_error_handler(request: Request, exc: ContextGitError) -> JSONResponse:
        if isinstance(exc, (BranchNotFound, CommitNotFound, RepoNotFound, SessionNotFound)):
            status = 404
        elif isinstance(exc, (MergeConflict, StaleMergePreview, RepoAlreadyExists, StagingEmpty)):
            status = 409
        elif isinstance(exc, (InvalidRefName, InvalidMergeResolution)):
            status = 422
        else:
            status = 400
        return JSONResponse(
            status_code=status, content={"error": str(exc), "type": type(exc).__name__}
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/repo/init", response_model=RepoSnapshot)
    def init_repo(body: InitRequest) -> RepoSnapshot:
        nonlocal path
        if "repo" in state:
            raise RepoAlreadyExists(f"repository already open at {path}")
        path = Path(body.path).expanduser()
        state["repo"] = Repo.init(path, author=body.author)
        return snapshot(state["repo"])

    @app.get("/api/v1/repo", response_model=RepoSnapshot)
    def get_snapshot(current: Repo = repo_dep) -> RepoSnapshot:
        return snapshot(current)

    @app.get("/api/v1/branches")
    def branches(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [branch.model_dump(mode="json") for branch in current.list_branches()]

    @app.post("/api/v1/branches")
    def create_branch(body: BranchRequest, current: Repo = repo_dep) -> dict[str, object]:
        return current.branch(body.name, body.from_commit).model_dump(mode="json")

    @app.delete("/api/v1/branches", status_code=204)
    def delete_branch(name: str, current: Repo = repo_dep) -> None:
        """Delete a branch pointer. Commits survive; the current branch is refused.

        `name` is a query param because branch names contain '/'.
        """
        current.delete_branch(name)

    @app.post("/api/v1/checkout")
    def checkout(body: CheckoutRequest, current: Repo = repo_dep) -> dict[str, str]:
        return {"ref": current.checkout(body.ref), "current_branch": current.current_branch()}

    @app.get("/api/v1/commits", response_model=list[CommitResponse])
    def commits(
        branch: str | None = None,
        current: Repo = repo_dep,
    ) -> list[CommitResponse]:
        results = []
        for commit in current.log(branch):
            context = current.build_context(commit.id)
            results.append(
                CommitResponse(
                    commit=commit,
                    token_count=current.count_tokens(commit.id, commit.model),
                    context_message_count=len(context),
                )
            )
        return results

    @app.get("/api/v1/commits/{commit_id}", response_model=CommitResponse)
    def commit(commit_id: str, current: Repo = repo_dep) -> CommitResponse:
        item = current.get_commit(commit_id)
        return CommitResponse(
            commit=item,
            token_count=current.count_tokens(item.id, item.model),
            context_message_count=len(current.build_context(item.id)),
        )

    @app.get("/api/v1/context")
    def context(
        branch: str | None = None,
        commit_id: str | None = None,
        current: Repo = repo_dep,
    ) -> list[dict[str, str]]:
        head = commit_id or current.log(branch)[0].id
        return [
            {"role": item.role, "content": item.content}
            for item in current.build_context(head)
        ]

    @app.post("/api/v1/commits", response_model=CommitResponse)
    def create_commit(body: CommitRequest, current: Repo = repo_dep) -> CommitResponse:
        commit = current.commit(
            body.messages,
            model=body.model,
            summary=body.summary,
            branch=body.branch,
            author=body.author,
        )
        return CommitResponse(
            commit=commit,
            token_count=current.count_tokens(commit.id, commit.model),
            context_message_count=len(current.build_context(commit.id)),
        )

    @app.get("/api/v1/diff")
    def diff(a: str, b: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.diff(a, b).model_dump(mode="json")

    @app.post("/api/v1/merge/preview")
    def merge_preview(body: MergePreviewRequest, current: Repo = repo_dep) -> dict[str, object]:
        return current.preview_merge(body.source, body.into, provider=llm).model_dump(mode="json")

    @app.post("/api/v1/merge/apply", response_model=CommitResponse)
    def merge_apply(body: MergeApplyRequest, current: Repo = repo_dep) -> CommitResponse:
        commit = current.apply_merge(
            body.preview,
            resolutions=body.resolutions,
            summary=body.summary,
            author=body.author,
        )
        return CommitResponse(
            commit=commit,
            token_count=current.count_tokens(commit.id, commit.model),
            context_message_count=len(current.build_context(commit.id)),
        )

    # ---------- sessions (parallel AI runs) ----------

    @app.get("/api/v1/sessions")
    def sessions(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [session.model_dump(mode="json") for session in current.list_sessions()]

    @app.post("/api/v1/sessions", status_code=201)
    def create_session(body: SessionRequest, current: Repo = repo_dep) -> dict[str, object]:
        session = current.create_session(
            body.name,
            kind=body.kind,
            branch=body.branch,
            agent=body.agent,
            auto_commit=body.auto_commit,
            from_commit=body.from_commit,
        )
        return session.model_dump(mode="json")

    @app.get("/api/v1/sessions/{session_id}")
    def get_session(session_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.get_session(session_id).model_dump(mode="json")

    @app.patch("/api/v1/sessions/{session_id}")
    def update_session(
        session_id: str,
        body: SessionUpdateRequest,
        current: Repo = repo_dep,
    ) -> dict[str, object]:
        session = current.get_session(session_id)
        if body.name is not None:
            session = current.rename_session(session_id, body.name)
        if body.status is not None:
            session = current.set_session_status(session_id, body.status)
        if body.auto_commit is not None:
            session = current.set_session_auto_commit(session_id, body.auto_commit)
        return session.model_dump(mode="json")

    @app.delete("/api/v1/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str, current: Repo = repo_dep) -> None:
        current.delete_session(session_id)

    @app.get("/api/v1/sessions/{session_id}/staging")
    def get_staging(session_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        return [message.model_dump(mode="json") for message in current.staged(session_id)]

    @app.post("/api/v1/sessions/{session_id}/staging")
    def stage_messages(
        session_id: str,
        body: StageRequest,
        current: Repo = repo_dep,
    ) -> list[dict[str, object]]:
        staged = current.stage(session_id, body.messages)
        return [message.model_dump(mode="json") for message in staged]

    @app.delete("/api/v1/sessions/{session_id}/staging")
    def clear_staging(
        session_id: str,
        last: bool = False,
        current: Repo = repo_dep,
    ) -> list[dict[str, object]]:
        remaining = current.unstage(session_id, last_only=last)
        return [message.model_dump(mode="json") for message in remaining]

    @app.post("/api/v1/sessions/{session_id}/commit", response_model=CommitResponse)
    def commit_staged(
        session_id: str,
        body: CommitStagedRequest,
        current: Repo = repo_dep,
    ) -> CommitResponse:
        commit = current.commit_staged(
            session_id,
            summary=body.summary,
            model=body.model,
            author=body.author,
        )
        return CommitResponse(
            commit=commit,
            token_count=current.count_tokens(commit.id, commit.model),
            context_message_count=len(current.build_context(commit.id)),
        )

    # ---------- chat ----------

    @app.post("/api/v1/chat/stream")
    def chat_stream(body: ChatRequest, current: Repo = repo_dep) -> StreamingResponse:
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        head = body.commit_id or current.log(branch)[0].id
        context_messages = current.build_context(head)
        request_messages = [*context_messages, Message(role="user", content=body.prompt)]
        auto_commit = (
            body.auto_commit
            if body.auto_commit is not None
            else (session.auto_commit if session else True)
        )

        async def events() -> AsyncIterator[str]:
            parts: list[str] = []
            try:
                for chunk in llm.stream(request_messages, model=body.model):
                    parts.append(chunk)
                    yield _sse("token", {"text": chunk})
                turn = [
                    Message(role="user", content=body.prompt),
                    Message(role="assistant", content="".join(parts)),
                ]
                if session is not None and not auto_commit:
                    staged = current.stage(session.id, turn)
                    yield _sse(
                        "done",
                        {
                            "commit_id": None,
                            "branch": branch,
                            "staged": True,
                            "staged_count": len(staged),
                        },
                    )
                    return
                commit = current.commit(
                    turn,
                    model=body.model,
                    summary=body.prompt[:120],
                    branch=branch,
                )
                if session is not None:
                    current.set_session_status(session.id, "done")
                yield _sse("done", {"commit_id": commit.id, "branch": branch, "staged": False})
            except Exception as exc:
                yield _sse("error", {"error": str(exc)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/v1/compare", response_model=CompareResult)
    def compare(body: CompareRequest, current: Repo = repo_dep) -> CompareResult:
        a_context = current.build_context(current.log(body.branch_a)[0].id)
        b_context = current.build_context(current.log(body.branch_b)[0].id)
        a_messages = [*a_context, Message(role="user", content=body.prompt)]
        b_messages = [*b_context, Message(role="user", content=body.prompt)]
        return CompareResult(
            branch_a=body.branch_a,
            branch_b=body.branch_b,
            answer_a=llm.complete(a_messages, model=body.model),
            answer_b=llm.complete(b_messages, model=body.model),
            model=body.model,
            diff=current.diff(body.branch_a, body.branch_b),
        )

    return app


def snapshot(repo: Repo) -> RepoSnapshot:
    """Return every stored commit so merge-parent edges appear in the graph."""
    return RepoSnapshot(
        current_branch=repo.current_branch(),
        branches=repo.list_branches(),
        commits=repo.all_commits(),
        tags=repo.list_tags(),
    )


def _sse(event: str, data: object) -> str:
    """Serialize one server-sent event safely."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


app = create_app()
