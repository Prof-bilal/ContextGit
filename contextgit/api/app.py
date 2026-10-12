"""FastAPI routes are thin validation and serialization wrappers around Repo."""

import hashlib
import importlib
import os
import secrets
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from contextgit.agent import approve_plan, commit_run, create_run, create_run_issue, reject_plan
from contextgit.api.cors import LocalAPI
from contextgit.api.schemas import (
    AgentApprovalRequest,
    AgentCommitRequest,
    AgentRunRequest,
    BranchRequest,
    CheckoutRequest,
    ClaimCheckRequest,
    ClaimCheckResult,
    CommitRequest,
    CommitResponse,
    CommitStagedRequest,
    DbOpenRequest,
    DbQueryRequest,
    EndpointBisectRequest,
    EndpointGenerateRequest,
    EndpointGenerateResponse,
    EndpointRunRequest,
    EndpointServeRequest,
    EnqueueMergeRequest,
    InitRequest,
    IntegrateRequest,
    IssueConfigRequest,
    LocalIssueRequest,
    MergeApplyRequest,
    MergePreviewRequest,
    PreflightRequest,
    ProjectMemoryApprovalRequest,
    ProjectMemorySynthesisRequest,
    RepoSnapshot,
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
    TerminalTranscriptRequest,
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
    ServerStatus,
    UsageSummary,
    WhyAnswer,
    WhyFinding,
    utcnow,
)
from contextgit.core.repo import Repo
from contextgit.dbclient.store import ConnectionStore, registry
from contextgit.endpoints.provenance import graph_with_provenance
from contextgit.endpoints.serve import detect_run_command, fetch_live_openapi, supervisor
from contextgit.endpoints.staleness import annotate
from contextgit.endpoints.tests import (
    generate_for_endpoint,
    remembered,
    run_suite,
)
from contextgit.endpoints.why import why_for, why_history
from contextgit.issues import install_osv_scanner, run_scan
from contextgit.limits.models import HarnessLimits
from contextgit.limits.registry import all_limits
from contextgit.llm import (
    FakeProvider,
    LLMProvider,
    OpenAICompatibleProvider,
    build_for,
)
from contextgit.memory.project import synthesize_project_memory
from contextgit.verify.bisect import bisect_gate, oldest_commit
from contextgit.verify.detect import detect_gate


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
                    "error": "Backend repository changed. Reconnecting to the active workspace.",
                    "type": "RepositoryMismatch",
                },
            )
        return await call_next(request)

    # Tauri supplies a fresh token on each launch. Standalone API deployments
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
    from contextgit.api.transcripts import router as transcript_router

    app.include_router(transcript_router(get_repo))

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

    # ---------- scheduled repository issues ----------

    @app.get("/api/v1/issues/config")
    def issue_config(current: Repo = repo_dep) -> dict[str, object]:
        return current.issue_config().model_dump(mode="json")

    @app.put("/api/v1/issues/config")
    def update_issue_config(
        body: IssueConfigRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        config = current.issue_config()
        updates = body.model_dump(exclude_none=True)
        for key, value in updates.items():
            setattr(config, key, value)
        config.updated_at = utcnow()
        current.save_issue_config(config)
        return config.model_dump(mode="json")

    @app.get("/api/v1/issues/scans")
    def issue_scans(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [run.model_dump(mode="json") for run in current.issue_runs()]

    @app.get("/api/v1/issues/findings")
    def issue_findings(current: Repo = repo_dep) -> list[dict[str, object]]:
        findings = current.issue_findings()
        result: list[dict[str, object]] = []
        for finding in findings:
            link = current.issue_link(finding.fingerprint)
            result.append(
                {
                    **finding.model_dump(mode="json"),
                    "issue": link.model_dump(mode="json") if link else None,
                }
            )
        return result

    @app.post("/api/v1/issues/scan")
    def issue_scan(current: Repo = repo_dep) -> dict[str, object]:
        return run_scan(current, "manual", llm).model_dump(mode="json")

    @app.post("/api/v1/issues/dependencies/install")
    def install_issue_dependencies(current: Repo = repo_dep) -> dict[str, object]:
        return install_osv_scanner(current)

    @app.post("/api/v1/issues/schedule/pause")
    def pause_issue_schedule(current: Repo = repo_dep) -> dict[str, object]:
        config = current.issue_config()
        config.enabled = False
        config.updated_at = utcnow()
        current.save_issue_config(config)
        return config.model_dump(mode="json")

    @app.post("/api/v1/issues/schedule/resume")
    def resume_issue_schedule(current: Repo = repo_dep) -> dict[str, object]:
        config = current.issue_config()
        config.enabled = True
        config.updated_at = utcnow()
        current.save_issue_config(config)
        return config.model_dump(mode="json")

    @app.post("/api/v1/issues/github/test")
    def test_github(current: Repo = repo_dep) -> dict[str, object]:
        token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
        return {"configured": bool(token), "repository": current.issue_config().github_repository}

    @app.post("/api/v1/issues/github/install-workflow")
    def install_github_workflow(current: Repo = repo_dep) -> dict[str, object]:
        workflow = current.root / ".github" / "workflows" / "contextgit-issues.yml"
        workflow.parent.mkdir(parents=True, exist_ok=True)
        workflow.write_text(
            "name: ContextGit Issues\n\n"
            "on:\n  schedule:\n    - cron: '17 1,6,11,16,21 * * *'\n  workflow_dispatch:\n\n"
            "permissions:\n  contents: read\n  issues: write\n\n"
            "concurrency:\n  group: contextgit-issues\n  cancel-in-progress: false\n\n"
            "jobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n"
            "      - uses: actions/checkout@v4\n"
            "      - uses: actions/setup-python@v5\n"
            "        with:\n          python-version: '3.11'\n"
            "      - run: pip install 'contextgit @ "
            "git+https://github.com/Prof-bilal/ContextGit.git@main'\n"
            "      - run: ctx issues scan --github-issues\n"
            "        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n",
            encoding="utf-8",
        )
        return {"path": str(workflow), "installed": True}

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

    @app.get("/api/v1/sessions/{session_id}/detail")
    def session_detail(session_id: str, current: Repo = repo_dep) -> dict[str, object]:
        """One bounded read for the complete AI-work record of a session."""
        session = current.get_session(session_id)
        commits = current.log(session.branch)
        head = commits[0].id if commits else None
        run = next(
            (item for item in current.agent_runs(500) if item.session_id == session.id), None
        )
        workspace = None
        try:
            workspace = current.session_workspace(session.id).model_dump(mode="json")
        except Exception:
            # Plain chat sessions and non-git projects have no worktree status.
            workspace = None
        memory = current.project_memory(session.project_path) if session.project_path else None
        conversation = current.build_context(head) if head else []
        staged = current.staged(session.id)
        terminal_transcript = current.terminal_transcript(session.id)
        conversation_status = "saved"
        conversation_error = None
        if session.agent == "opencode":
            from contextgit.integration.transcript import CaptureUnavailable

            try:
                conversation = current.transcripts.conversation(session.id)
                staged = []  # Native history already includes staged and committed text.
                conversation_status = "live"
            except CaptureUnavailable as error:
                conversation_status = error.status
                conversation_error = str(error)
        return {
            "session": session.model_dump(mode="json"),
            "conversation_status": conversation_status,
            "conversation_error": conversation_error,
            "messages": [item.model_dump(mode="json") for item in conversation],
            "staged_messages": [item.model_dump(mode="json") for item in staged],
            "terminal_transcript": terminal_transcript,
            "agent_run": (
                {
                    **run.model_dump(mode="json"),
                    "steps": [step.model_dump(mode="json") for step in current.agent_steps(run.id)],
                    "artifacts": [
                        artifact.model_dump(mode="json")
                        for artifact in current.agent_artifacts(run.id)
                    ],
                }
                if run
                else None
            ),
            "workspace_status": workspace,
            "commits": [commit.model_dump(mode="json") for commit in commits[:100]],
            "project_memory_preview": {
                "revision": memory.revision,
                "summary": memory.summary,
                "text": current.project_memory_text(memory),
            }
            if memory
            else None,
        }

    @app.get("/api/v1/project-memory")
    def project_memory(project_path: str, current: Repo = repo_dep) -> dict[str, object]:
        canonical = current.canonical_project_path(project_path)
        memory = current.project_memory(canonical)
        return {
            "project_path": canonical,
            "current": memory.model_dump(mode="json") if memory else None,
            "text": current.project_memory_text(memory),
        }

    @app.post("/api/v1/project-memory/synthesize")
    def synthesize_memory(
        body: ProjectMemorySynthesisRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        active = llm
        provider_id = body.provider
        model = body.model
        if body.provider:
            active, resolved = build_for(body.provider, current.list_providers())
            if getattr(resolved, "kind", None) == "mock":
                raise ProviderConfigError("project-memory synthesis requires a real provider")
            model = body.model or resolved.model
        elif provider is None and isinstance(active, FakeProvider):
            raise ProviderConfigError(
                "project-memory synthesis requires a configured real provider"
            )
        try:
            memory = synthesize_project_memory(
                current,
                active,
                body.project_path,
                body.session_ids,
                provider_id=provider_id,
                model=model,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            # Provider adapters wrap transport and provider-response failures in
            # RuntimeError. Keep this an actionable gateway error instead of an
            # opaque Starlette 500 page.
            raise HTTPException(
                status_code=502,
                detail=f"Project-memory provider failed: {exc}",
            ) from exc
        return memory.model_dump(mode="json")

    @app.post("/api/v1/project-memory/{revision_id}/approve")
    def approve_memory(
        revision_id: str,
        body: ProjectMemoryApprovalRequest,
        current: Repo = repo_dep,
    ) -> dict[str, object]:
        if body.memory.id != revision_id:
            raise InvalidRefName("memory revision id does not match the request path")
        canonical = current.canonical_project_path(body.memory.project_path)
        if canonical != body.memory.project_path:
            raise InvalidRefName("project path must be canonical")
        allowed = {
            session.id for session in current.list_sessions() if session.project_path == canonical
        }
        if any(session_id not in allowed for session_id in body.memory.source_session_ids):
            raise InvalidRefName("memory sources must belong to the selected project")
        draft = body.memory.model_copy(
            update={
                "project_path": canonical,
                "revision": current.next_project_memory_revision(canonical),
                "status": "draft",
                "approved_at": None,
            }
        )
        current.save_project_memory(draft)
        return current.approve_project_memory(revision_id).model_dump(mode="json")

    # ---------- versioned repository agent ----------

    def agent_payload(current: Repo, run_id: str) -> dict[str, object]:
        run = current.agent_run(run_id)
        issue = current.local_issue(run.local_issue_id) if run.local_issue_id else None
        return {
            **run.model_dump(mode="json"),
            "steps": [step.model_dump(mode="json") for step in current.agent_steps(run_id)],
            "artifacts": [
                artifact.model_dump(mode="json") for artifact in current.agent_artifacts(run_id)
            ],
            "issue": issue.model_dump(mode="json") if issue else None,
        }

    @app.get("/api/v1/agent/runs")
    def agent_runs(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [agent_payload(current, run.id) for run in current.agent_runs()]

    @app.post("/api/v1/agent/runs", status_code=201)
    def create_agent_run(body: AgentRunRequest, current: Repo = repo_dep) -> dict[str, object]:
        active = llm
        provider_id = body.provider
        model = body.model
        if body.provider:
            active, resolved = build_for(body.provider, current.list_providers())
            model = body.model or resolved.model
        run = create_run(current, body.task, active, provider_id, model)
        return agent_payload(current, run.id)

    @app.get("/api/v1/agent/runs/{run_id}")
    def get_agent_run(run_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return agent_payload(current, run_id)

    @app.post("/api/v1/agent/runs/{run_id}/approval")
    def approve_agent_run(
        run_id: str, body: AgentApprovalRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        run = current.agent_run(run_id)
        if body.decision == "rejected":
            run = reject_plan(current, run_id)
        else:
            active = llm
            if run.provider:
                active, _ = build_for(run.provider, current.list_providers())
            run = approve_plan(current, run_id, active)
        return agent_payload(current, run.id)

    @app.post("/api/v1/agent/runs/{run_id}/cancel")
    def cancel_agent_run(run_id: str, current: Repo = repo_dep) -> dict[str, object]:
        run = current.agent_run(run_id)
        run.status = "cancelled"
        run.updated_at = utcnow()
        current.save_agent_run(run)
        return agent_payload(current, run.id)

    @app.post("/api/v1/agent/runs/{run_id}/commit")
    def commit_agent_run(
        run_id: str, body: AgentCommitRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return agent_payload(current, commit_run(current, run_id, body.message).id)

    @app.get("/api/v1/local-issues")
    def local_issues(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [issue.model_dump(mode="json") for issue in current.local_issues()]

    @app.post("/api/v1/agent/runs/{run_id}/issue", status_code=201)
    def create_agent_issue(
        run_id: str, body: LocalIssueRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return create_run_issue(current, run_id, body.title, body.body).model_dump(mode="json")

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

    @app.post("/api/v1/sessions/{session_id}/terminal-transcript")
    def append_terminal_transcript(
        session_id: str,
        body: TerminalTranscriptRequest,
        current: Repo = repo_dep,
    ) -> dict[str, str]:
        return {"content": current.append_terminal_transcript(session_id, body.content)}

    @app.post("/api/v1/sessions/{session_id}/staging")
    def stage_messages(
        session_id: str,
        body: StageRequest,
        current: Repo = repo_dep,
    ) -> list[dict[str, object]]:
        session = current.get_session(session_id)
        if session.agent == "opencode" and any(message.role == "tool" for message in body.messages):
            from contextgit.integration.transcript import CaptureUnavailable

            try:
                staged = current.transcripts.capture(session_id)
            except CaptureUnavailable as error:
                raise HTTPException(409, {"status": error.status, "message": str(error)}) from error
        else:
            staged = current.stage(session_id, body.messages)
        return [message.model_dump(mode="json") for message in staged]

    @app.get("/api/v1/commits/{commit_id}/conversation")
    def commit_conversation(commit_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        commit = current.get_commit(commit_id)
        messages = [message for message in commit.messages if message.role in {"user", "assistant"}]
        # An ancestor may appear on many session branches. Never graft a native
        # conversation onto an immutable legacy commit without source receipts.
        return [message.model_dump(mode="json") for message in messages]

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
        if current.get_session(session_id).agent == "opencode":
            from contextgit.integration.transcript import CaptureUnavailable

            try:
                current.transcripts.capture(session_id)
            except CaptureUnavailable as error:
                raise HTTPException(409, {"status": error.status, "message": str(error)}) from error
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

    return app


def snapshot(repo: Repo) -> RepoSnapshot:
    """Return every stored commit so merge-parent edges appear in the graph."""
    return RepoSnapshot(
        current_branch=repo.current_branch(),
        branches=repo.list_branches(),
        commits=repo.all_commits(),
        tags=repo.list_tags(),
    )


def _redact(text: str, secret: str | None) -> str:
    """Never let a stored key surface in an error message."""
    return text.replace(secret, "•••") if secret else text


_app_token = os.getenv("CONTEXTGIT_API_TOKEN") or secrets.token_urlsafe(32)
app = create_app(api_token=_app_token)
