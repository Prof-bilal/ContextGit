"""FastAPI routes are thin validation and serialization wrappers around Repo."""

import asyncio
import hashlib
import importlib
import json
import os
import secrets
import threading
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

import anyio
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from contextgit.agents.asset_agent import (
    SYSTEM_PROMPT as ASSET_AGENT_SYSTEM,
)
from contextgit.agents.asset_agent import (
    build_prompt as build_asset_prompt,
)
from contextgit.agents.asset_agent import (
    parse_actions as parse_asset_actions,
)
from contextgit.api.cors import LocalAPI
from contextgit.api.schemas import (
    AssetAgentRequest,
    AssetAgentResponse,
    BranchRequest,
    ChatRequest,
    CheckoutRequest,
    ClaimCheckRequest,
    ClaimCheckResult,
    CommitRequest,
    CommitResponse,
    CommitStagedRequest,
    CompareRequest,
    CompareResult,
    CouncilRequest,
    DbOpenRequest,
    DbQueryRequest,
    DocumentRequest,
    EndpointBisectRequest,
    EndpointGenerateRequest,
    EndpointGenerateResponse,
    EndpointRunRequest,
    EndpointServeRequest,
    EnqueueMergeRequest,
    ImageRequest,
    InitRequest,
    IntegrateRequest,
    MergeApplyRequest,
    MergePreviewRequest,
    PreflightRequest,
    ProviderModelsResult,
    ProviderTestResult,
    ProviderUpsertRequest,
    RepoSnapshot,
    ResearchRequest,
    RunMergeQueueRequest,
    SessionRequest,
    SessionUpdateRequest,
    StageRequest,
    TaskCreateRequest,
    TaskRejectRequest,
    TaskUpdateRequest,
    TaskVerifyRequest,
    TeamCreateRequest,
    TeamGateRequest,
    TeamMessageRequest,
)
from contextgit.apiclient.client import send_request
from contextgit.apiclient.store import CollectionStore
from contextgit.core.errors import (
    BranchNotFound,
    CollectionNotFound,
    CommitNotFound,
    ContextGitError,
    DbConnectionNotFound,
    DbError,
    EndpointNotFound,
    GateNotConfigured,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    MergeQueueEntryNotFound,
    ProviderConfigError,
    ProviderNotFound,
    RepoAlreadyExists,
    RepoNotFound,
    ScopeConflict,
    ServerNotRunning,
    SessionNotFound,
    StagingEmpty,
    StaleMergePreview,
    TaskCycleError,
    TaskDependencyError,
    TaskNotFound,
    TaskNotReviewable,
    TeamNotFound,
    WorkInProgressLimit,
)
from contextgit.core.models import (
    BisectResult,
    DbConnectionInfo,
    DbConnectionSpec,
    DbQueryResult,
    DbTable,
    EndpointGraph,
    EndpointTestSuite,
    HttpCollection,
    HttpHistoryEntry,
    HttpRequestSpec,
    HttpResponseResult,
    Message,
    ProviderCapability,
    ProviderRecord,
    ServerStatus,
    UsageSummary,
    WhyAnswer,
    WhyFinding,
    utcnow,
)
from contextgit.core.repo import Repo
from contextgit.dbclient.store import ConnectionStore, registry
from contextgit.documents import (
    DocumentFormat,
    DocumentInfo,
    MissingRenderer,
    RenderedDocument,
    build_document,
    document_prompt,
    filename_for,
    list_documents,
    metadata_for,
    path_for,
    render,
    save,
)
from contextgit.endpoints.provenance import graph_with_provenance
from contextgit.endpoints.serve import detect_run_command, fetch_live_openapi, supervisor
from contextgit.endpoints.staleness import annotate
from contextgit.endpoints.tests import (
    generate_for_endpoint,
    remembered,
    run_suite,
)
from contextgit.endpoints.why import why_for, why_history
from contextgit.limits.models import HarnessLimits
from contextgit.limits.registry import all_limits
from contextgit.llm import (
    BUILTIN_BY_ID,
    AsyncLLMProvider,
    FakeProvider,
    ImageResult,
    LLMProvider,
    OpenAICompatibleProvider,
    ProviderInfo,
    ProviderSpec,
    all_provider_infos,
    build_for,
    build_images_for,
    build_search_for,
    effective_spec,
    provider_info,
    resolve_provider,
)
from contextgit.llm.base import UsageSink
from contextgit.research import Fetcher, ResearchStore, extract_claims, run_research
from contextgit.verify.bisect import bisect_gate, oldest_commit
from contextgit.verify.detect import detect_gate

# Content types for a rendered document download.
_DOCUMENT_MEDIA: dict[str, str] = {
    "md": "text/markdown; charset=utf-8",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def create_app(
    repo_path: Path | str | None = None,
    *,
    repo: Repo | None = None,
    provider: LLMProvider | None = None,
    api_token: str | None = None,
) -> FastAPI:
    """Create the local API, optionally injecting a repo and deterministic provider."""
    env_repo = os.getenv("CONTEXTGIT_REPO")
    path = Path(
        repo.root
        if repo is not None
        else repo_path
        if repo_path is not None
        else env_repo or ".contextgit"
    ).expanduser()
    llm = provider or (
        OpenAICompatibleProvider() if os.getenv("CTX_LLM_API_KEY") else FakeProvider()
    )
    app = LocalAPI(title="ContextGit API", version="1.0.0")
    instance_id = uuid4().hex

    @app.middleware("http")
    async def require_repository(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        expected = request.headers.get("x-contextgit-repo")
        actual = hashlib.sha256(str(path.resolve()).encode()).hexdigest()
        if expected and expected != actual:
            return JSONResponse(
                status_code=409,
                content={
                    "error": "Backend repository changed. Reopen the workspace to continue.",
                    "type": "RepositoryMismatch",
                },
            )
        return await call_next(request)

    # Electron supplies a fresh token on each launch. Standalone API deployments
    # may opt in with the same environment variable; tests remain injectable.
    launch_token = api_token if api_token is not None else os.getenv("CONTEXTGIT_API_TOKEN")

    @app.middleware("http")
    async def require_launch_token(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if launch_token and request.method != "OPTIONS" and request.url.path != "/api/v1/health":
            supplied = request.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied, f"Bearer {launch_token}"):
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    state: dict[str, Repo] = {"repo": repo} if repo is not None else {}
    # The first render fires several requests at once; without this lock two of
    # them can race open/init and the loser opens a half-written database.
    repo_lock = threading.Lock()

    def get_repo() -> Repo:
        existing = state.get("repo")
        if existing is not None:
            return existing
        with repo_lock:
            if "repo" not in state:
                try:
                    state["repo"] = Repo.open(path)
                except RepoNotFound:
                    state["repo"] = Repo.init(path)
            return state["repo"]

    repo_dep = Depends(get_repo)

    from contextgit.integration.api import router as integration_router

    app.include_router(integration_router(get_repo))

    @asynccontextmanager
    async def integration_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        get_repo().integration.start()
        try:
            yield
        finally:
            get_repo().integration.stop()

    app.router.lifespan_context = integration_lifespan

    def _live_openapi(root: Path) -> dict[str, object] | None:
        """The running server's own spec — only when it is this project's server."""
        status = supervisor().status()
        if not status.healthy or not status.url or status.cwd != str(root):
            return None
        return fetch_live_openapi(status.url)

    @app.exception_handler(ContextGitError)
    async def contextgit_error_handler(request: Request, exc: ContextGitError) -> JSONResponse:
        if isinstance(
            exc,
            (
                BranchNotFound,
                CommitNotFound,
                MergeQueueEntryNotFound,
                ProviderNotFound,
                RepoNotFound,
                SessionNotFound,
                TaskNotFound,
                TeamNotFound,
                CollectionNotFound,
                DbConnectionNotFound,
                EndpointNotFound,
            ),
        ):
            status = 404
        elif isinstance(
            exc,
            (
                MergeConflict,
                StaleMergePreview,
                RepoAlreadyExists,
                ScopeConflict,
                StagingEmpty,
                TaskDependencyError,
                TaskNotReviewable,
                WorkInProgressLimit,
                ServerNotRunning,
                DbError,
            ),
        ):
            status = 409
        elif isinstance(
            exc,
            (
                GateNotConfigured,
                InvalidRefName,
                InvalidMergeResolution,
                ProviderConfigError,
                TaskCycleError,
            ),
        ):
            status = 422
        else:
            status = 400
        return JSONResponse(
            status_code=status, content={"error": str(exc), "type": type(exc).__name__}
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "contextgit",
            "api_version": "1",
            "instance_id": instance_id,
            "repo_id": hashlib.sha256(str(path.resolve()).encode()).hexdigest(),
        }

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
    def delete_branch(name: str, permanent: bool = False, current: Repo = repo_dep) -> None:
        """Move a branch pointer to Storage. Commits survive; the current branch is refused.

        `name` is a query param because branch names contain '/'. Pass
        `permanent=true` to drop the pointer instead of trashing it.
        """
        if permanent:
            current.purge_branch(name)
        else:
            current.delete_branch(name)

    @app.post("/api/v1/branches/restore")
    def restore_branch(name: str, current: Repo = repo_dep) -> dict[str, object]:
        """Bring a branch back from Storage. `name` is a query param."""
        return current.restore_branch(name).model_dump(mode="json")

    @app.post("/api/v1/checkout")
    def checkout(body: CheckoutRequest, current: Repo = repo_dep) -> dict[str, str]:
        return {"ref": current.checkout(body.ref), "current_branch": current.current_branch()}

    @app.get("/api/v1/branches/{name}/budget")
    def branch_budget(name: str, current: Repo = repo_dep) -> dict[str, object]:
        """Real context size for the inspector: head, token estimate, message count."""
        return current.branch_metrics(name)

    @app.get("/api/v1/branches/{name}/blame")
    def branch_blame(name: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        """Provenance for every message on a branch, in context order."""
        return [entry.model_dump(mode="json") for entry in current.blame(name)]

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
            {"role": item.role, "content": item.content} for item in current.build_context(head)
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
            project_path=body.project_path,
            worktree=body.worktree,
            base_ref=body.base_ref,
            task=body.task,
            scope=body.scope,
            role=body.role,
            skills=body.skills,
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
    def delete_session(session_id: str, permanent: bool = False, current: Repo = repo_dep) -> None:
        """Move a run to Storage. Pass `permanent=true` to delete it for good."""
        if permanent:
            current.delete_session(session_id)
        else:
            current.trash_session(session_id)

    @app.post("/api/v1/sessions/{session_id}/restore")
    def restore_session(session_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """Bring a run back from Storage."""
        return current.restore_session(session_id).model_dump(mode="json")

    @app.get("/api/v1/trash")
    def trash(current: Repo = repo_dep) -> dict[str, object]:
        """The Storage view: trashed runs/conversations and trashed branches."""
        return {
            "sessions": [
                session.model_dump(mode="json") for session in current.list_trashed_sessions()
            ],
            "branches": [
                branch.model_dump(mode="json") for branch in current.list_trashed_branches()
            ],
        }

    @app.get("/api/v1/sessions/{session_id}/workspace")
    def session_workspace(session_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.session_workspace(session_id).model_dump(mode="json")

    @app.get("/api/v1/fleet")
    def fleet(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [entry.model_dump(mode="json") for entry in current.fleet()]

    @app.post("/api/v1/sessions/{session_id}/preflight")
    def preflight_session(
        session_id: str, body: PreflightRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return current.session_workspace(session_id, target=body.target).model_dump(mode="json")

    @app.post("/api/v1/fleet/claims/check")
    def check_claims(body: ClaimCheckRequest, current: Repo = repo_dep) -> dict[str, object]:
        conflicts = current.claim_conflicts(body.scope, exclude_session_id=body.session_id)
        return ClaimCheckResult(conflicts=conflicts).model_dump(mode="json")

    # ---------- team mode (a task graph over parallel runs) ----------

    @app.get("/api/v1/team")
    def get_team(current: Repo = repo_dep) -> dict[str, object] | None:
        """The current board, or null when no team exists yet."""
        board = current.team_board()
        return board.model_dump(mode="json") if board else None

    @app.post("/api/v1/team", status_code=201)
    def create_team(body: TeamCreateRequest, current: Repo = repo_dep) -> dict[str, object]:
        if body.gate_command is not None:
            detected_gate = detect_gate(Path(body.project_path).expanduser())
            if body.gate_command != detected_gate:
                raise HTTPException(
                    status_code=400,
                    detail="gate_command must match the project's detected quality gate",
                )
        team = current.create_team(
            body.name, project_path=body.project_path, base_ref=body.base_ref
        )
        if body.gate_command is not None:
            team = current.set_team_gate(team.id, body.gate_command)
        board = current.team_board(team.id)
        if board is None:  # pragma: no cover - just created, cannot be missing
            raise TeamNotFound("team disappeared right after creation")
        return board.model_dump(mode="json")

    @app.patch("/api/v1/team")
    def set_team_gate(body: TeamGateRequest, current: Repo = repo_dep) -> dict[str, object]:
        """Set the team's default quality gate command."""
        team = current.current_team()
        if team is None:
            raise TeamNotFound("no team yet")
        detected_gate = detect_gate(Path(team.project_path).expanduser())
        if body.gate_command != detected_gate:
            raise HTTPException(
                status_code=400,
                detail="gate_command must match the project's detected quality gate",
            )
        return current.set_team_gate(team.id, body.gate_command).model_dump(mode="json")

    @app.post("/api/v1/team/tasks", status_code=201)
    def create_task(body: TaskCreateRequest, current: Repo = repo_dep) -> dict[str, object]:
        team = current.current_team()
        if team is None:
            raise TeamNotFound("create a team first")
        if body.gate_command is not None:
            detected_gate = detect_gate(Path(team.project_path).expanduser())
            if body.gate_command != detected_gate:
                raise HTTPException(
                    status_code=400,
                    detail="gate_command must match the project's detected quality gate",
                )
        task = current.create_task(
            team.id,
            title=body.title,
            brief=body.brief,
            done_criteria=body.done_criteria,
            role=body.role,
            agent=body.agent,
            scope=body.scope,
            contract=body.contract,
            depends_on=body.depends_on,
            gate_command=body.gate_command,
        )
        return task.model_dump(mode="json")

    @app.patch("/api/v1/team/tasks/{task_id}")
    def update_task(
        task_id: str, body: TaskUpdateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        if body.gate_command is not None:
            existing = current.get_task(task_id)
            team = current.get_team(existing.team_id)
            detected_gate = detect_gate(Path(team.project_path).expanduser())
            if body.gate_command != detected_gate:
                raise HTTPException(
                    status_code=400,
                    detail="gate_command must match the project's detected quality gate",
                )
        task = current.update_task(
            task_id,
            title=body.title,
            brief=body.brief,
            done_criteria=body.done_criteria,
            role=body.role,
            agent=body.agent,
            scope=body.scope,
            contract=body.contract,
            status=body.status,
            gate_command=body.gate_command,
        )
        if body.depends_on is not None:
            task = current.set_task_deps(task_id, body.depends_on)
        return task.model_dump(mode="json")

    @app.delete("/api/v1/team/tasks/{task_id}", status_code=204)
    def delete_task(task_id: str, current: Repo = repo_dep) -> None:
        current.delete_task(task_id)

    @app.post("/api/v1/team/launch")
    def launch_team(current: Repo = repo_dep) -> list[dict[str, object]]:
        """Start every ready task; blocked tasks stay blocked."""
        return [task.model_dump(mode="json") for task in current.launch_team()]

    @app.post("/api/v1/team/tasks/{task_id}/start")
    def start_task(task_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.start_task(task_id).model_dump(mode="json")

    @app.post("/api/v1/team/tasks/{task_id}/complete")
    def complete_task(task_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """Mark a task done and auto-start the dependents it unblocks."""
        return current.complete_task(task_id).model_dump(mode="json")

    @app.get("/api/v1/team/messages")
    def team_messages(limit: int = 50, current: Repo = repo_dep) -> list[dict[str, object]]:
        team = current.current_team()
        if team is None:
            raise TeamNotFound("no team yet")
        return [m.model_dump(mode="json") for m in current.team_messages(team.id, limit=limit)]

    @app.post("/api/v1/team/messages", status_code=201)
    def post_team_message(body: TeamMessageRequest, current: Repo = repo_dep) -> dict[str, object]:
        team = current.current_team()
        if team is None:
            raise TeamNotFound("no team yet")
        message = current.post_message(
            team.id,
            body.body,
            kind=body.kind,
            task_id=body.task_id,
            from_task_id=body.from_task_id,
        )
        return message.model_dump(mode="json")

    @app.post("/api/v1/team/merge")
    def merge_team(current: Repo = repo_dep) -> list[dict[str, object]]:
        """Queue every done task, in dependency order, for the merge queue."""
        return [entry.model_dump(mode="json") for entry in current.queue_done_tasks()]

    @app.post("/api/v1/team/tasks/{task_id}/gate")
    def run_task_gate(task_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """Run the project's quality gate in this task's worktree."""
        return current.run_task_gate(task_id).model_dump(mode="json")

    @app.post("/api/v1/team/tasks/{task_id}/approve")
    def approve_task(task_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """Accept reviewed work: done, then unblock and start dependents."""
        return current.approve_task(task_id).model_dump(mode="json")

    @app.post("/api/v1/team/tasks/{task_id}/reject")
    def reject_task(
        task_id: str, body: TaskRejectRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        """Send reviewed work back with the changes the implementer must make."""
        return current.reject_task(task_id, body.note).model_dump(mode="json")

    @app.post("/api/v1/team/tasks/{task_id}/verify")
    def verify_task(
        task_id: str, body: TaskVerifyRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        """Start a read-only run that reviews this task's diff."""
        return current.verify_task(task_id, agent=body.agent).model_dump(mode="json")

    @app.get("/api/v1/merge-queue")
    def merge_queue(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [entry.model_dump(mode="json") for entry in current.merge_queue()]

    @app.post("/api/v1/merge-queue", status_code=201)
    def enqueue_merge(body: EnqueueMergeRequest, current: Repo = repo_dep) -> dict[str, object]:
        return current.enqueue_merge(body.session_id, body.target).model_dump(mode="json")

    @app.delete("/api/v1/merge-queue/{entry_id}", status_code=204)
    def dequeue_merge(entry_id: int, current: Repo = repo_dep) -> None:
        current.dequeue_merge(entry_id)

    @app.post("/api/v1/merge-queue/run")
    def run_merge_queue(
        body: RunMergeQueueRequest, current: Repo = repo_dep
    ) -> list[dict[str, object]]:
        return [entry.model_dump(mode="json") for entry in current.run_merge_queue(body.target)]

    @app.post("/api/v1/sessions/{session_id}/integrate")
    def integrate_run(
        session_id: str, body: IntegrateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        """Merge a run's code and context together."""
        merged = current.integrate_run(
            session_id, target=body.target, git_target=body.git_target, provider=llm
        )
        return merged.model_dump(mode="json")

    @app.get("/api/v1/sessions/{session_id}/context")
    def session_context(session_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """The shared-context digest this run would receive from the others."""
        return {"text": current.shared_context(session_id)}

    @app.post("/api/v1/sessions/{session_id}/cross-conflicts")
    def cross_run_conflicts(session_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        """Semantic conflicts between this run's context and every other run's."""
        return [
            entry.model_dump(mode="json")
            for entry in current.cross_run_conflicts(session_id, provider=llm)
        ]

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

    # ---------- providers (the add-a-provider flow) ----------

    @app.get("/api/v1/providers", response_model=list[ProviderInfo])
    def providers(
        capability: ProviderCapability | None = None,
        current: Repo = repo_dep,
    ) -> list[ProviderInfo]:
        """The catalog, optionally filtered to one capability (chat/search/image)."""
        return all_provider_infos(current.list_providers(), capability=capability)

    @app.post("/api/v1/providers", status_code=201, response_model=ProviderInfo)
    def add_provider(body: ProviderUpsertRequest, current: Repo = repo_dep) -> ProviderInfo:
        """Add or enable a provider: a built-in by id, or a custom endpoint."""
        provider_id = body.id or _slug(body.label or "")
        if not provider_id:
            raise ProviderConfigError("a provider needs an id or a label")
        existing = current.get_provider(provider_id)
        saved = current.save_provider(_provider_record(body, provider_id, existing))
        return provider_info(effective_spec(saved), saved, is_builtin=saved.id in BUILTIN_BY_ID)

    @app.delete("/api/v1/providers/{provider_id}", status_code=204)
    def remove_provider(provider_id: str, current: Repo = repo_dep) -> None:
        """Forget a stored provider; a built-in reverts to unconfigured."""
        current.delete_provider(provider_id)

    @app.post("/api/v1/providers/{provider_id}/test", response_model=ProviderTestResult)
    def test_provider(provider_id: str, current: Repo = repo_dep) -> ProviderTestResult:
        """A tiny capability-appropriate call — a bad URL/key fails here, not mid-task."""
        records = current.list_providers()
        resolved = resolve_provider(provider_id, records)
        started = time.perf_counter()
        try:
            if resolved.spec.capability == "search":
                search, _ = build_search_for(provider_id, records)
                hits = search.search("ping", max_results=1)
                if not hits:
                    raise ProviderConfigError("search returned no results")
            elif resolved.spec.capability == "image":
                if resolved.spec.kind != "mock" and not resolved.api_key:
                    raise ProviderConfigError("image provider needs a key")
            else:
                adapter, _ = build_for(provider_id, records)
                adapter.complete(
                    [Message(role="user", content="ping")],
                    model=resolved.model or "default",
                    max_tokens=1,
                )
        except Exception as exc:
            latency = int((time.perf_counter() - started) * 1000)
            return ProviderTestResult(
                ok=False,
                latency_ms=latency,
                model=resolved.model,
                error=_redact(str(exc), resolved.api_key),
            )
        latency = int((time.perf_counter() - started) * 1000)
        return ProviderTestResult(ok=True, latency_ms=latency, model=resolved.model)

    @app.post("/api/v1/providers/{provider_id}/models", response_model=ProviderModelsResult)
    def fetch_provider_models(provider_id: str, current: Repo = repo_dep) -> ProviderModelsResult:
        """`GET {base}/models` when supported, else the static list; persists it."""
        adapter, resolved = build_for(provider_id, current.list_providers())
        models = resolved.spec.models
        source: Literal["live", "static"] = "static"
        lister = getattr(adapter, "list_models", None)
        if resolved.spec.models_endpoint and callable(lister):
            try:
                models = list(lister())
                source = "live"
            except Exception:
                models = resolved.spec.models
                source = "static"
        record = current.get_provider(provider_id) or _record_from_spec(resolved.spec)
        record.models = models
        record.updated_at = utcnow()
        current.save_provider(record)
        return ProviderModelsResult(models=models, source=source)

    # ---------- agent providers (the asset agent's isolated credential store) ----------

    @app.get("/api/v1/agent-providers", response_model=list[ProviderInfo])
    def agent_providers(
        capability: ProviderCapability | None = None, current: Repo = repo_dep
    ) -> list[ProviderInfo]:
        """The asset agent's own provider catalog, separate from Chat's."""
        return all_provider_infos(current.list_agent_providers(), capability=capability)

    @app.post("/api/v1/agent-providers", status_code=201, response_model=ProviderInfo)
    def add_agent_provider(body: ProviderUpsertRequest, current: Repo = repo_dep) -> ProviderInfo:
        """Add or enable an asset-agent provider; stored apart from Chat's."""
        provider_id = body.id or _slug(body.label or "")
        if not provider_id:
            raise ProviderConfigError("a provider needs an id or a label")
        existing = current.get_agent_provider(provider_id)
        saved = current.save_agent_provider(_provider_record(body, provider_id, existing))
        return provider_info(effective_spec(saved), saved, is_builtin=saved.id in BUILTIN_BY_ID)

    @app.delete("/api/v1/agent-providers/{provider_id}", status_code=204)
    def remove_agent_provider(provider_id: str, current: Repo = repo_dep) -> None:
        """Forget a stored agent provider; a built-in reverts to unconfigured."""
        current.delete_agent_provider(provider_id)

    @app.post("/api/v1/agent-providers/{provider_id}/test", response_model=ProviderTestResult)
    def test_agent_provider(provider_id: str, current: Repo = repo_dep) -> ProviderTestResult:
        """A tiny completion against the agent's provider — a bad key fails here."""
        records = current.list_agent_providers()
        resolved = resolve_provider(provider_id, records)
        started = time.perf_counter()
        try:
            adapter, _ = build_for(provider_id, records)
            adapter.complete(
                [Message(role="user", content="ping")],
                model=resolved.model or "default",
                max_tokens=1,
            )
        except Exception as exc:
            latency = int((time.perf_counter() - started) * 1000)
            return ProviderTestResult(
                ok=False,
                latency_ms=latency,
                model=resolved.model,
                error=_redact(str(exc), resolved.api_key),
            )
        latency = int((time.perf_counter() - started) * 1000)
        return ProviderTestResult(ok=True, latency_ms=latency, model=resolved.model)

    @app.post("/api/v1/agent-providers/{provider_id}/models", response_model=ProviderModelsResult)
    def fetch_agent_provider_models(
        provider_id: str, current: Repo = repo_dep
    ) -> ProviderModelsResult:
        """`GET {base}/models` when supported, else the static list; persists it."""
        adapter, resolved = build_for(provider_id, current.list_agent_providers())
        models = resolved.spec.models
        source: Literal["live", "static"] = "static"
        lister = getattr(adapter, "list_models", None)
        if resolved.spec.models_endpoint and callable(lister):
            try:
                models = list(lister())
                source = "live"
            except Exception:
                models = resolved.spec.models
                source = "static"
        record = current.get_agent_provider(provider_id) or _record_from_spec(resolved.spec)
        record.models = models
        record.updated_at = utcnow()
        current.save_agent_provider(record)
        return ProviderModelsResult(models=models, source=source)

    # ---------- assets agent (plan actions over the asset library) ----------

    @app.post("/api/v1/assets/agent", response_model=AssetAgentResponse)
    def assets_agent(body: AssetAgentRequest, current: Repo = repo_dep) -> AssetAgentResponse:
        """Plan asset actions from an instruction, using the agent's own provider."""
        records = current.list_agent_providers()
        adapter, resolved = build_for(body.provider_id, records)
        model = body.model or resolved.model or "gpt-4o-mini"
        messages = [
            Message(role="system", content=ASSET_AGENT_SYSTEM),
            Message(
                role="user",
                content=build_asset_prompt(
                    [asset.model_dump() for asset in body.catalog.assets],
                    body.catalog.folders,
                    body.instruction,
                ),
            ),
        ]
        try:
            text = adapter.complete(messages, model=model, temperature=0)
        except Exception as exc:
            raise ProviderConfigError(_redact(str(exc), resolved.api_key)) from exc
        try:
            actions = parse_asset_actions(text)
        except ValueError as exc:
            raise ProviderConfigError(str(exc)) from exc
        return AssetAgentResponse(actions=actions)

    # ---------- endpoint graph (the Endpoints tab) ----------

    @app.get("/api/v1/endpoints", response_model=EndpointGraph)
    def endpoints(project_path: str | None = None, current: Repo = repo_dep) -> EndpointGraph:
        """Every endpoint of the project, with the change that produced each one."""
        root = Path(project_path).expanduser() if project_path else current.root
        return graph_with_provenance(current, root, openapi=_live_openapi(root))

    @app.post("/api/v1/endpoints/refresh", response_model=EndpointGraph)
    def endpoints_refresh(
        project_path: str | None = None, current: Repo = repo_dep
    ) -> EndpointGraph:
        """Re-scan the project (the graph is always read fresh, so this is a re-read)."""
        root = Path(project_path).expanduser() if project_path else current.root
        return graph_with_provenance(current, root, openapi=_live_openapi(root))

    # ---------- the project's server + generated endpoint tests ----------

    @app.get("/api/v1/endpoints/serve", response_model=ServerStatus)
    def endpoints_serve(project_path: str | None = None) -> ServerStatus:
        """The project's server, with the tail of its log."""
        root = Path(project_path).expanduser() if project_path else None
        return supervisor().status(root)

    @app.post("/api/v1/endpoints/serve", response_model=ServerStatus)
    def endpoints_serve_start(body: EndpointServeRequest) -> ServerStatus:
        """Start the project's server. Never automatic: the UI clicks this."""
        root = Path(body.project_path).expanduser()
        detected = detect_run_command(root)
        if body.command and (detected is None or body.command != detected.command):
            raise HTTPException(
                status_code=400,
                detail="command must match the project's detected server command",
            )
        return supervisor().start(root, detected.command if detected else None, body.port)

    @app.delete("/api/v1/endpoints/serve", response_model=ServerStatus)
    def endpoints_serve_stop() -> ServerStatus:
        """Stop the server and its whole process group."""
        return supervisor().stop()

    @app.get("/api/v1/endpoints/tests", response_model=EndpointTestSuite)
    def endpoints_tests(project_path: str) -> EndpointTestSuite:
        """The generated test files for a project, with their last outcome."""
        return remembered(Path(project_path).expanduser())

    @app.post("/api/v1/endpoints/tests/generate", response_model=EndpointGenerateResponse)
    def endpoints_generate(
        body: EndpointGenerateRequest, current: Repo = repo_dep
    ) -> EndpointGenerateResponse:
        """Author tests for one endpoint, run them, and keep the file."""
        root = Path(body.project_path).expanduser()
        status = supervisor().status(root)
        graph = graph_with_provenance(current, root, openapi=_live_openapi(root))
        endpoint = next((item for item in graph.endpoints if item.id == body.endpoint_id), None)
        if endpoint is None:
            raise EndpointNotFound(body.endpoint_id)
        adapter, resolved = build_for(body.provider_id, current.list_providers())
        model = body.model or resolved.model or "gpt-4o-mini"
        # Only validate against a server we actually started and know is answering;
        # guessing a URL would test somebody else's service.
        live = status.url if status.healthy else None
        entry, overwrote, failure = generate_for_endpoint(
            root,
            endpoint,
            adapter=adapter,
            model=model,
            base_url=live,
            validate=live is not None,
        )
        return EndpointGenerateResponse(
            file=entry, suite=remembered(root), overwrote=overwrote, failure=failure
        )

    @app.post("/api/v1/endpoints/tests/reconcile", response_model=EndpointTestSuite)
    def endpoints_reconcile(
        body: EndpointRunRequest, current: Repo = repo_dep
    ) -> EndpointTestSuite:
        """Check every generated test against the handler it was written for."""
        root = Path(body.project_path).expanduser()
        graph = graph_with_provenance(current, root, openapi=_live_openapi(root))
        return annotate(root, remembered(root), graph)

    @app.get("/api/v1/endpoints/tests/staleness", response_model=EndpointTestSuite)
    def endpoints_staleness(
        project_path: str, endpoint_id: str, current: Repo = repo_dep
    ) -> EndpointTestSuite:
        """The same check, narrowed to one endpoint's tests."""
        root = Path(project_path).expanduser()
        graph = graph_with_provenance(current, root, openapi=_live_openapi(root))
        suite = annotate(root, remembered(root), graph)
        suite.files = [item for item in suite.files if item.endpoint_id == endpoint_id]
        return suite

    @app.post("/api/v1/endpoints/tests/run", response_model=EndpointTestSuite)
    def endpoints_run(body: EndpointRunRequest) -> EndpointTestSuite:
        """Run every generated test file against the running server."""
        root = Path(body.project_path).expanduser()
        current = supervisor().status(root)
        base_url = body.base_url or (current.url if current.healthy else None)
        if not base_url:
            raise ServerNotRunning(
                "no server is running for this project — start it first, "
                "or pass the URL you want the tests to hit"
            )
        return run_suite(root, base_url)

    @app.post("/api/v1/endpoints/tests/bisect", response_model=BisectResult)
    def endpoints_bisect(body: EndpointBisectRequest, current: Repo = repo_dep) -> BisectResult:
        """Binary-search the history for the change that broke the gate."""
        root = Path(body.project_path).expanduser()
        provider = None
        if body.provider_id:
            provider, _ = build_for(body.provider_id, current.list_providers())

        good = body.good
        if not good and body.endpoint_id:
            entry = next(
                (item for item in remembered(root).files if item.endpoint_id == body.endpoint_id),
                None,
            )
            good = entry.verified_at_commit if entry else None
        good = good or oldest_commit(root)
        bad = body.bad or "HEAD"
        if not good:
            return BisectResult(
                project_path=str(root),
                command=body.command or "",
                good="",
                bad=bad,
                note="This project has no history to walk yet.",
            )
        if good == bad:
            return BisectResult(
                project_path=str(root),
                command=body.command or "",
                good=good,
                bad=bad,
                note="Nothing has changed since those tests last passed.",
            )
        return bisect_gate(
            current, root, good=good, bad=bad, command=body.command, provider=provider
        )

    # ---------- database client (the DB tab) ----------

    @app.get("/api/v1/db/drivers", response_model=dict[str, bool])
    def db_drivers() -> dict[str, bool]:
        """Which engines this install can actually use."""
        available = {"sqlite": True}
        for engine, module in (("postgres", "psycopg"), ("sqlserver", "pymssql")):
            try:
                importlib.import_module(module)
            except ImportError:
                available[engine] = False
            else:
                available[engine] = True
        return available

    @app.get("/api/v1/db/connections", response_model=list[str])
    def db_connections(current: Repo = repo_dep) -> list[str]:
        """The saved connection names in this repository."""
        return ConnectionStore(current.root).list()

    @app.get("/api/v1/db/connections/{name}", response_model=DbConnectionSpec)
    def db_connection(name: str, current: Repo = repo_dep) -> DbConnectionSpec:
        """One saved connection (never its password)."""
        return ConnectionStore(current.root).get(name)

    @app.put("/api/v1/db/connections/{name}", response_model=DbConnectionSpec)
    def db_save_connection(
        name: str, body: DbConnectionSpec, current: Repo = repo_dep
    ) -> DbConnectionSpec:
        """Create or replace a connection spec (a file, and no secrets)."""
        return ConnectionStore(current.root).save(body.model_copy(update={"name": name}))

    @app.delete("/api/v1/db/connections/{name}", status_code=204)
    def db_delete_connection(name: str, current: Repo = repo_dep) -> None:
        ConnectionStore(current.root).delete(name)

    @app.post("/api/v1/db/open", response_model=DbConnectionInfo)
    def db_open(body: DbOpenRequest) -> DbConnectionInfo:
        """Open a live connection; the password is used and forgotten."""
        return registry().open(body.spec, body.password)

    @app.delete("/api/v1/db/open/{connection_id}", response_model=bool)
    def db_close(connection_id: str) -> bool:
        """Close one live connection."""
        return registry().close(connection_id)

    @app.get("/api/v1/db/schema", response_model=list[DbTable])
    def db_schema(connection_id: str) -> list[DbTable]:
        """Every table and view with its columns."""
        return registry().get(connection_id).tables()

    @app.post("/api/v1/db/query", response_model=DbQueryResult)
    def db_query(body: DbQueryRequest) -> DbQueryResult:
        """Run one statement, capped, against an open connection."""
        return registry().get(body.connection_id).query(body.sql, body.limit)

    # ---------- rationale blame (the Why lens) ----------

    @app.get("/api/v1/why", response_model=WhyAnswer)
    def why(
        project_path: str,
        path: str,
        line: int | None = None,
        as_of: str | None = None,
        provider_id: str | None = None,
        current: Repo = repo_dep,
    ) -> WhyAnswer:
        """Why a path or line exists: decisions, rejected alternatives, questions."""
        provider = None
        if provider_id:
            provider, _ = build_for(provider_id, current.list_providers())
        return why_for(
            current,
            provider,
            Path(project_path).expanduser(),
            path,
            line=line,
            as_of=as_of,
            with_reasoning=provider is not None,
        )

    @app.get("/api/v1/why/history", response_model=list[WhyFinding])
    def why_history_route(
        project_path: str, path: str, limit: int = 5, current: Repo = repo_dep
    ) -> list[WhyFinding]:
        """The timeline of changes to one file, newest first (no LLM call)."""
        return why_history(current, Path(project_path).expanduser(), path, limit=limit)

    # ---------- HTTP client (the API tab) ----------

    @app.post("/api/v1/http/request", response_model=HttpResponseResult)
    def http_request(body: HttpRequestSpec, current: Repo = repo_dep) -> HttpResponseResult:
        """Send one composed request and record it in the history."""
        result = send_request(body)
        current.record_http_history(
            body.method.upper() or "GET",
            result.url or body.url,
            result.status,
            result.elapsed_ms,
            result.size,
        )
        return result

    @app.get("/api/v1/http/collections", response_model=list[str])
    def http_collections(current: Repo = repo_dep) -> list[str]:
        """The names of the collections stored in the repo."""
        return CollectionStore(current.root).list()

    @app.get("/api/v1/http/collections/{name}", response_model=HttpCollection)
    def http_collection(name: str, current: Repo = repo_dep) -> HttpCollection:
        return CollectionStore(current.root).get(name)

    @app.put("/api/v1/http/collections/{name}", response_model=HttpCollection)
    def http_save_collection(
        name: str, body: HttpCollection, current: Repo = repo_dep
    ) -> HttpCollection:
        """Create or replace a collection (stored as a file beside the history)."""
        return CollectionStore(current.root).save(body.model_copy(update={"name": name}))

    @app.delete("/api/v1/http/collections/{name}", status_code=204)
    def http_delete_collection(name: str, current: Repo = repo_dep) -> None:
        CollectionStore(current.root).delete(name)

    @app.get("/api/v1/http/history", response_model=list[HttpHistoryEntry])
    def http_history(limit: int = 50, current: Repo = repo_dep) -> list[HttpHistoryEntry]:
        """Recently sent requests, newest first."""
        return current.list_http_history(limit)

    # ---------- usage (merged token accounting across every surface) ----------
    @app.get("/api/v1/usage", response_model=UsageSummary)
    def usage(days: int | None = None, current: Repo = repo_dep) -> UsageSummary:
        """Merged token usage across every surface, optionally the last `days`."""
        since = utcnow() - timedelta(days=days) if days else None
        return current.usage_summary(since)

    # ---------- harness limits (each CLI's own account limits) ----------

    @app.get("/api/v1/limits", response_model=list[HarnessLimits])
    def limits(refresh: bool = False, harness: str | None = None) -> list[HarnessLimits]:
        """Account adapters and explicit availability for every registered CLI."""
        return (
            all_limits(refresh=refresh, harness=harness) if harness else all_limits(refresh=refresh)
        )

    # ---------- documents (Chat "Document" mode: generate a file) ----------

    @app.post("/api/v1/documents/stream")
    def documents_stream(body: DocumentRequest, current: Repo = repo_dep) -> StreamingResponse:
        """Generate a document on a topic, render it, and stream progress."""
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        auto_commit = (
            body.auto_commit
            if body.auto_commit is not None
            else (session.auto_commit if session else True)
        )
        secret: str | None = None
        if body.provider:
            active_llm, resolved = build_for(body.provider, current.list_providers())
            secret = resolved.api_key
            model = body.model or resolved.model or "gpt-4o-mini"
        else:
            active_llm = llm
            model = body.model or "gpt-4o-mini"
        messages = document_prompt(body.prompt, body.format, body.template)
        usage_box, usage_sink = _usage_collector()

        async def events() -> AsyncIterator[str]:
            parts: list[str] = []
            try:
                yield _sse("step", {"label": "Generating", "detail": f"{body.format} document"})
                async for chunk in _stream_tokens(
                    active_llm, messages, model=model, usage_sink=usage_sink
                ):
                    parts.append(chunk)
                    yield _sse("token", {"text": chunk})
                markdown = "".join(parts).strip() or "(empty document)"
                yield _sse("step", {"label": "Rendering", "detail": body.format})
                document = build_document(markdown, body.format, body.template)
                try:
                    data = render(document, body.format)
                except MissingRenderer as exc:
                    yield _sse("error", {"error": str(exc)})
                    return
                document_id = uuid4().hex[:12]
                filename = filename_for(document.title, document_id, body.format)
                save(current.root, document_id, body.format, filename, document.title, data)
                rendered = RenderedDocument(
                    id=document_id,
                    filename=filename,
                    format=body.format,
                    size=len(data),
                    title=document.title,
                    markdown=markdown,
                )
                if usage_box:
                    prompt_tokens, completion_tokens = usage_box[-1]
                    usage_source: Literal["provider", "estimate"] = "provider"
                else:
                    prompt_tokens = sum(_estimate_text(m.content) for m in messages)
                    completion_tokens = _estimate_text(markdown)
                    usage_source = "estimate"
                current.record_usage(
                    body.provider or "default",
                    model,
                    "chat",
                    source=usage_source,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    session_id=session.id if session else None,
                    branch=branch,
                )
                turn = [
                    Message(role="user", content=body.prompt),
                    Message(role="assistant", content=markdown),
                ]
                if session is not None and not auto_commit:
                    staged = current.stage(session.id, turn)
                    yield _sse("document", rendered.model_dump(mode="json"))
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
                    model=model,
                    summary=f"document: {document.title[:100]}",
                    branch=branch,
                )
                if session is not None:
                    current.set_session_status(session.id, "done")
                yield _sse("document", rendered.model_dump(mode="json"))
                yield _sse("done", {"commit_id": commit.id, "branch": branch, "staged": False})
            except Exception as exc:
                yield _sse("error", {"error": _redact(str(exc), secret)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/v1/documents", response_model=list[DocumentInfo])
    def list_generated_documents(current: Repo = repo_dep) -> list[DocumentInfo]:
        """Every document generated in this repository, newest first."""
        return list_documents(current.root)

    @app.get("/api/v1/documents/{document_id}")
    def download_document(
        document_id: str, format: str = "pdf", current: Repo = repo_dep
    ) -> FileResponse:
        """Download a previously generated document."""
        if format not in _DOCUMENT_MEDIA:
            raise HTTPException(status_code=422, detail=f"unknown format: {format}")
        path = path_for(current.root, document_id, cast("DocumentFormat", format))
        if path is None:
            raise HTTPException(status_code=404, detail="document not found")
        meta = metadata_for(current.root, document_id) or {}
        filename = meta.get("filename", path.name)
        return FileResponse(path, filename=filename, media_type=_DOCUMENT_MEDIA[format])

    # ---------- council (same prompt, several providers) ----------

    @app.post("/api/v1/council/stream")
    def council_stream(body: CouncilRequest, current: Repo = repo_dep) -> StreamingResponse:
        """Fan the same prompt out to N members in parallel; stream each reply."""
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        head = body.commit_id or current.log(branch)[0].id
        request_messages = [
            *current.build_context(head),
            Message(role="user", content=body.prompt),
        ]
        records = current.list_providers()
        members: list[tuple[int, str, str, str, LLMProvider, str | None]] = []
        for index, member in enumerate(body.members):
            adapter, resolved = build_for(member.provider, records)
            model = member.model or resolved.model or "gpt-4o-mini"
            members.append(
                (index, member.provider, model, resolved.spec.label, adapter, resolved.api_key)
            )

        async def events() -> AsyncIterator[str]:
            queue: asyncio.Queue[tuple[str, dict[str, object]]] = asyncio.Queue()

            async def run_member(
                index: int,
                provider_id: str,
                model: str,
                label: str,
                adapter: LLMProvider,
                secret: str | None,
            ) -> None:
                await queue.put(
                    (
                        "member",
                        {"index": index, "provider": provider_id, "model": model, "label": label},
                    )
                )
                parts: list[str] = []
                usage_box, usage_sink = _usage_collector()
                try:
                    async for chunk in _stream_tokens(
                        adapter, request_messages, model=model, usage_sink=usage_sink
                    ):
                        parts.append(chunk)
                        await queue.put(("token", {"index": index, "text": chunk}))
                    await queue.put(("member_done", {"index": index, "answer": "".join(parts)}))
                except Exception as exc:
                    await queue.put(("error", {"index": index, "error": _redact(str(exc), secret)}))
                # One usage row per council member (real when reported).
                if usage_box:
                    member_prompt, member_completion = usage_box[-1]
                    member_source: Literal["provider", "estimate"] = "provider"
                else:
                    member_prompt = sum(_estimate_text(m.content) for m in request_messages)
                    member_completion = _estimate_text("".join(parts))
                    member_source = "estimate"
                current.record_usage(
                    provider_id,
                    model,
                    "council",
                    source=member_source,
                    prompt_tokens=member_prompt,
                    completion_tokens=member_completion,
                    branch=branch,
                )

            tasks = [asyncio.create_task(run_member(*entry)) for entry in members]
            try:
                finished = 0
                while finished < len(tasks):
                    event, data = await queue.get()
                    if event in ("member_done", "error"):
                        finished += 1
                    yield _sse(event, data)
                yield _sse("done", {"commit_id": None, "branch": branch, "staged": False})
            finally:
                for task in tasks:
                    task.cancel()

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------- images (prompt -> rendered tiles) ----------

    @app.post("/api/v1/images/stream")
    def images_stream(body: ImageRequest, current: Repo = repo_dep) -> StreamingResponse:
        """Render a prompt and commit (or stage) the prompt as the versioned artifact."""
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        auto_commit = (
            body.auto_commit
            if body.auto_commit is not None
            else (session.auto_commit if session else True)
        )
        transport, resolved = build_images_for(body.provider, current.list_providers())
        model = body.model or resolved.model or "image"
        secret = resolved.api_key

        async def events() -> AsyncIterator[str]:
            try:
                yield _sse(
                    "step",
                    {
                        "label": "Rendering",
                        "detail": f"{resolved.spec.label} · {model} · {body.aspect}",
                    },
                )

                def render() -> list[ImageResult]:
                    return transport.generate(
                        body.prompt, model=model, aspect=body.aspect, count=body.count
                    )

                tiles = await anyio.to_thread.run_sync(render)
                for tile in tiles:
                    yield _sse("image", tile.model_dump(mode="json"))
                turn = [
                    Message(role="user", content=body.prompt),
                    Message(
                        role="assistant",
                        content=f"[image] {model} · {body.aspect} · {len(tiles)} tile(s)",
                    ),
                ]
                if session is not None and not auto_commit:
                    staged = current.stage(session.id, turn)
                    yield _sse(
                        "done",
                        {
                            "commit_id": None,
                            "branch": branch,
                            "tiles": len(tiles),
                            "staged": True,
                            "staged_count": len(staged),
                        },
                    )
                    return
                commit = current.commit(
                    turn,
                    model=model,
                    summary=f"image: {body.prompt[:100]}",
                    branch=branch,
                    kind="note",
                )
                yield _sse(
                    "done",
                    {
                        "commit_id": commit.id,
                        "branch": branch,
                        "tiles": len(tiles),
                        "staged": False,
                    },
                )
            except Exception as exc:
                yield _sse("error", {"error": _redact(str(exc), secret)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------- research (deep / competitive / lead / verify) ----------

    @app.post("/api/v1/research/stream")
    def research_stream(body: ResearchRequest, current: Repo = repo_dep) -> StreamingResponse:
        """Run the loop, stream its steps, then commit the report as context."""
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        head = body.commit_id or current.log(branch)[0].id
        auto_commit = (
            body.auto_commit
            if body.auto_commit is not None
            else (session.auto_commit if session else True)
        )
        records = current.list_providers()
        secret: str | None = None
        if body.provider:
            active_llm, resolved = build_for(body.provider, records)
            secret = resolved.api_key
            model = body.model or resolved.model or "gpt-4o-mini"
        else:
            active_llm = llm
            model = body.model or "gpt-4o-mini"
        search_backend, _ = build_search_for(body.search_provider, records)
        fetcher = Fetcher()
        store = ResearchStore(current.root)
        run_id = uuid4().hex[:12]

        async def events() -> AsyncIterator[str]:
            try:
                claims: list[str] | None = None
                if body.mode == "verify":
                    verify_context = current.build_context(head)
                    if session is not None and not auto_commit:
                        verify_context = [*verify_context, *current.staged(session.id)]
                    context = "\n".join(m.content for m in verify_context)
                    if context.strip():
                        claims = await extract_claims(active_llm, context[-6000:])
                artifact = ""
                sources: list[dict[str, object]] = []
                async for name, data in run_research(
                    body.mode,
                    body.prompt,
                    provider=active_llm,
                    search=search_backend,
                    fetcher=fetcher,
                    breadth=body.breadth,
                    depth=body.depth,
                    max_pages=body.max_pages,
                    claims=claims,
                    store=store,
                    run_id=run_id,
                ):
                    if name == "done":
                        artifact = str(data.get("artifact", ""))
                        continue
                    if name == "source":
                        sources.append(data)
                    yield _sse(name, data)
                turn = [
                    Message(role="user", content=body.prompt),
                    Message(role="assistant", content=artifact or "(no artifact produced)"),
                ]
                # The research engine calls the provider internally, so record a
                # single estimate for the whole run.
                current.record_usage(
                    body.provider or "default",
                    model,
                    "research",
                    source="estimate",
                    prompt_tokens=_estimate_text(body.prompt),
                    completion_tokens=_estimate_text(turn[1].content),
                    session_id=session.id if session else None,
                    branch=branch,
                )
                if session is not None and not auto_commit:
                    staged = current.stage(session.id, turn)
                    yield _sse(
                        "done",
                        {
                            "commit_id": None,
                            "branch": branch,
                            "sources": sources,
                            "run_id": run_id,
                            "staged": True,
                            "staged_count": len(staged),
                        },
                    )
                    return
                commit = current.commit(
                    turn,
                    model=model,
                    summary=f"{body.mode} research: {body.prompt[:100]}",
                    branch=branch,
                )
                yield _sse(
                    "done",
                    {
                        "commit_id": commit.id,
                        "branch": branch,
                        "sources": sources,
                        "run_id": run_id,
                        "staged": False,
                    },
                )
            except Exception as exc:
                yield _sse("error", {"error": _redact(str(exc), secret)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------- chat ----------

    @app.post("/api/v1/chat/stream")
    def chat_stream(body: ChatRequest, current: Repo = repo_dep) -> StreamingResponse:
        session = current.get_session(body.session_id) if body.session_id else None
        branch = body.branch or (session.branch if session else current.current_branch())
        head = body.commit_id or current.log(branch)[0].id
        context_messages = current.build_context(head)
        auto_commit = (
            body.auto_commit
            if body.auto_commit is not None
            else (session.auto_commit if session else True)
        )
        # Uncommitted (staged) turns are part of the conversation too: a user who
        # commits on demand still expects the next turn to see the previous one.
        if session is not None and not auto_commit:
            context_messages = [*context_messages, *current.staged(session.id)]
        request_messages = [*context_messages, Message(role="user", content=body.prompt)]
        secret: str | None = None
        if body.provider:
            active_llm, resolved = build_for(body.provider, current.list_providers())
            secret = resolved.api_key
            model = body.model or resolved.model or "gpt-4o-mini"
        else:
            active_llm = llm
            model = body.model or "gpt-4o-mini"

        usage_box, usage_sink = _usage_collector()

        async def events() -> AsyncIterator[str]:
            parts: list[str] = []
            try:
                async for chunk in _stream_tokens(
                    active_llm, request_messages, model=model, usage_sink=usage_sink
                ):
                    parts.append(chunk)
                    yield _sse("token", {"text": chunk})
                turn = [
                    Message(role="user", content=body.prompt),
                    Message(role="assistant", content="".join(parts)),
                ]
                # Record the call's token usage: real when the provider reported
                # it, otherwise the ~4-chars estimate.
                if usage_box:
                    prompt_tokens, completion_tokens = usage_box[-1]
                    usage_source: Literal["provider", "estimate"] = "provider"
                else:
                    prompt_tokens = sum(_estimate_text(m.content) for m in request_messages)
                    completion_tokens = _estimate_text(turn[1].content)
                    usage_source = "estimate"
                current.record_usage(
                    body.provider or "default",
                    model,
                    "chat",
                    source=usage_source,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    session_id=session.id if session else None,
                    branch=branch,
                )
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
                    model=model,
                    summary=body.prompt[:120],
                    branch=branch,
                )
                if session is not None:
                    current.set_session_status(session.id, "done")
                yield _sse("done", {"commit_id": commit.id, "branch": branch, "staged": False})
            except Exception as exc:
                yield _sse("error", {"error": _redact(str(exc), secret)})

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


async def _stream_tokens(
    provider: LLMProvider,
    messages: list[Message],
    *,
    model: str,
    usage_sink: UsageSink | None = None,
) -> AsyncIterator[str]:
    """Prefer a provider's async stream; fall back to its synchronous one."""
    if isinstance(provider, AsyncLLMProvider):
        async for chunk in provider.astream(messages, model=model, usage_sink=usage_sink):
            yield chunk
        return
    for chunk in provider.stream(messages, model=model, usage_sink=usage_sink):
        yield chunk


def _estimate_text(text: str) -> int:
    """The repository's ~4-chars-per-token heuristic for one string."""
    return (len(text) + 3) // 4 if text else 0


def _usage_collector() -> tuple[list[tuple[int, int]], UsageSink]:
    """A mutable box plus the sink adapters report real usage into."""
    box: list[tuple[int, int]] = []

    def sink(prompt_tokens: int, completion_tokens: int) -> None:
        box.append((prompt_tokens, completion_tokens))

    return box, sink


def _slug(text: str) -> str:
    """A stable provider id from a display name."""
    return "-".join("".join(c.lower() if c.isalnum() else " " for c in text).split())


def _provider_record(
    body: ProviderUpsertRequest, provider_id: str, existing: ProviderRecord | None
) -> ProviderRecord:
    """Merge a request onto the built-in (when the id matches) and the stored row."""
    base = BUILTIN_BY_ID.get(provider_id)
    base_url = body.base_url or (base.base_url if base else "")
    if not base_url:
        raise ProviderConfigError("a custom provider needs a base URL")
    now = utcnow()
    capability = (
        body.capability
        or (base.capability if base else None)
        or (existing.capability if existing else "chat")
    )
    return ProviderRecord(
        id=provider_id,
        label=body.label or (base.label if base else provider_id),
        vendor=body.vendor or (base.vendor if base else ""),
        kind=body.kind or (base.kind if base else "cloud"),
        capability=capability,
        base_url=base_url,
        auth_style=body.auth_style or (base.auth if base else "bearer"),
        api_key=(
            body.api_key if body.api_key is not None else (existing.api_key if existing else None)
        ),
        default_model=body.default_model or (base.default_model if base else None),
        models=body.models or (base.models if base else []),
        created_at=existing.created_at if existing else now,
        updated_at=now,
    )


def _record_from_spec(spec: ProviderSpec) -> ProviderRecord:
    """A stored row for a built-in, so a fetched model list can be persisted."""
    return ProviderRecord(
        id=spec.id,
        label=spec.label,
        vendor=spec.vendor,
        kind=spec.kind,
        capability=spec.capability,
        base_url=spec.base_url,
        auth_style=spec.auth,
        default_model=spec.default_model,
        models=spec.models,
    )


def _redact(text: str, secret: str | None) -> str:
    """Never let a stored key surface in an error message."""
    return text.replace(secret, "•••") if secret else text


_app_token = os.getenv("CONTEXTGIT_API_TOKEN") or secrets.token_urlsafe(32)
app = create_app(api_token=_app_token)
