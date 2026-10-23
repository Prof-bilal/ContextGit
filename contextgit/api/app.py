"""FastAPI routes are thin validation and serialization wrappers around Repo."""

import hashlib
import importlib
import base64
import os
import shutil
import socket
import subprocess
import secrets
import threading
import urllib.error
import urllib.request
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
    CanvasLayoutRequest,
    CanvasViewportRequest,
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
    GroupWorkersRequest,
    InitRequest,
    IntegrateRequest,
    IssueConfigRequest,
    LocalIssueRequest,
    MergeApplyRequest,
    MergePreviewRequest,
    PreflightRequest,
    ProjectMemoryApprovalRequest,
    ProjectMemorySynthesisRequest,
    ReorderWorkersRequest,
    RepoSnapshot,
    RunMergeQueueRequest,
    SessionRequest,
    SessionUpdateRequest,
    SkillLinkRequest,
    SkillReviewRequest,
    StageRequest,
    TaskCreateRequest,
    TaskRejectRequest,
    TaskStartRequest,
    TaskStopRequest,
    TaskUpdateRequest,
    TaskVerifyRequest,
    TeamCreateRequest,
    TeamGateRequest,
    TeamMessageRequest,
    TeamPlanRequest,
    TeamUpdateRequest,
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
    InvalidTaskTransition,
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
from contextgit.core.task_service import TaskService
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
from contextgit.knowledge.models import Lesson
from contextgit.knowledge.skills import SkillDraft, SkillLibrary
from contextgit.limits.models import HarnessLimits
from contextgit.limits.registry import all_limits
from contextgit.llm import (
    FakeProvider,
    LLMProvider,
    OpenAICompatibleProvider,
    build_for,
)
from contextgit.mcp.config import ensure_mcp_config
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

    # The browser launcher supplies a fresh token on each launch. Standalone API deployments
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
    editor_lock = threading.Lock()
    editor_process: dict[str, object] = {}

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

    @app.get("/api/v1/harnesses/{agent}/models")
    def harness_models(agent: str) -> dict[str, object]:
        from contextgit.core.cli_models import catalog
        try:
            return catalog(agent)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    from contextgit.integration.api import router as integration_router

    app.include_router(integration_router(get_repo))
    from contextgit.api.transcripts import router as transcript_router

    app.include_router(transcript_router(get_repo))
    from contextgit.api.knowledge import router as knowledge_router

    app.include_router(knowledge_router(get_repo, llm, provider is not None))

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
                InvalidTaskTransition,
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

    # ---------- browser project files ----------

    def _project_file(current: Repo, relative: str) -> Path:
        root = Path(current.root).parent.resolve()
        candidate = (root / relative.lstrip("/\\")).resolve()
        if candidate != root and root not in candidate.parents:
            raise HTTPException(400, "Project path escapes the selected folder.")
        return candidate

    def _file_version(file: Path) -> str:
        info = file.stat()
        return f"{info.st_size}:{info.st_mtime_ns}"

    @app.get("/api/v1/files")
    def files_list(relative: str = "", current: Repo = repo_dep) -> list[dict[str, object]]:
        directory = _project_file(current, relative or ".")
        if not directory.is_dir():
            raise HTTPException(400, "Choose a folder in the project.")
        root = Path(current.root).parent.resolve()
        hidden = {"__pycache__", "node_modules", "target", "dist", "build"}
        entries: list[dict[str, object]] = []
        for item in directory.iterdir():
            if item.name.startswith(".") or item.name in hidden:
                continue
            rel = item.relative_to(root).as_posix()
            entries.append({"name": item.name, "path": rel, "kind": "directory" if item.is_dir() else "file"})
        entries.sort(key=lambda item: (item["kind"] != "directory", str(item["name"]).lower()))
        return entries

    @app.get("/api/v1/files/document")
    def file_document(relative: str, current: Repo = repo_dep) -> dict[str, object]:
        file = _project_file(current, relative)
        info = file.stat()
        if info.st_size > 2_000_000:
            raise HTTPException(413, "Use a terminal to inspect text files larger than 2 MB.")
        try:
            content = file.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(415, "This file is not a UTF-8 text file.") from exc
        return {"path": relative, "content": content, "version": _file_version(file), "size": info.st_size, "encoding": "utf8"}

    @app.get("/api/v1/files/preview")
    def file_preview(relative: str, current: Repo = repo_dep) -> dict[str, object]:
        file = _project_file(current, relative)
        info = file.stat()
        if info.st_size > 8_000_000:
            raise HTTPException(413, "Preview supports files up to 8 MB.")
        extension = file.suffix.lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}.get(extension)
        raw = file.read_bytes()
        if mime:
            content = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
            kind = "image"
        else:
            try:
                content = raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise HTTPException(415, "This binary file has no preview.") from exc
            kind = "markdown" if extension in {"md", "markdown"} else "diff" if extension in {"diff", "patch"} else "text"
        return {"path": relative, "size": info.st_size, "version": _file_version(file), "kind": kind, "content": content}

    @app.put("/api/v1/files/document")
    def file_write(body: dict[str, object], current: Repo = repo_dep) -> dict[str, object]:
        relative = str(body.get("path") or "")
        content = body.get("content")
        if not isinstance(content, str):
            raise HTTPException(422, "File content must be text.")
        file = _project_file(current, relative)
        info = file.stat()
        expected = body.get("expectedVersion")
        if isinstance(expected, str) and expected != _file_version(file):
            raise HTTPException(409, "The file changed on disk. Reload it before saving.")
        file.write_text(content, encoding="utf-8")
        info = file.stat()
        return {"path": relative, "content": content, "version": _file_version(file), "size": info.st_size, "encoding": "utf8"}

    # ---------- browser editor lifecycle ----------

    def editor_status() -> dict[str, object]:
        process = editor_process.get("process")
        if not isinstance(process, subprocess.Popen) or process.poll() is not None:
            return {"state": "stopped", "instanceId": None, "url": None}
        url = str(editor_process["url"])
        try:
            with urllib.request.urlopen(f"{url}healthz", timeout=0.35) as response:
                ready = response.status == 200
        except (OSError, urllib.error.URLError):
            ready = False
        return {"state": "ready" if ready else "starting", "instanceId": editor_process["instance"], "url": url}

    @app.post("/api/v1/editor/start")
    def editor_start(current: Repo = repo_dep) -> dict[str, object]:
        with editor_lock:
            current_status = editor_status()
            if current_status["state"] != "stopped":
                return current_status
            executable = shutil.which("code-server")
            if not executable:
                return {"state": "unavailable", "instanceId": None, "url": None, "message": "code-server is not installed. Install it to use the browser editor."}
            root = Path(current.root).parent.resolve()
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = int(sock.getsockname()[1])
            instance = uuid4().hex
            command = [executable, "--bind-addr", f"127.0.0.1:{port}", "--auth", "none", "--disable-telemetry", "--disable-update-check", "--disable-workspace-trust", str(root)]
            try:
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            except OSError as exc:
                return {"state": "error", "instanceId": None, "url": None, "message": str(exc)}
            editor_process.update({"process": process, "instance": instance, "url": f"http://127.0.0.1:{port}/"})
            return editor_status()

    @app.get("/api/v1/editor/status")
    def get_editor_status(current: Repo = repo_dep) -> dict[str, object]:
        del current
        with editor_lock:
            return editor_status()

    @app.post("/api/v1/editor/{action}")
    def editor_action(action: str, current: Repo = repo_dep) -> dict[str, object]:
        del current
        if action not in {"suspend", "stop"}:
            raise HTTPException(404, "Unknown editor action.")
        with editor_lock:
            process = editor_process.get("process")
            if isinstance(process, subprocess.Popen) and process.poll() is None:
                process.terminate()
            editor_process.clear()
            return {"state": "stopped", "instanceId": None, "url": None}

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
            model=body.model,
            auto_commit=body.auto_commit,
            from_commit=body.from_commit,
            project_path=body.project_path,
            worktree=body.worktree,
            base_ref=body.base_ref,
            task=body.task,
            scope=body.scope,
            role=body.role,
            skills=body.skills,
            category=body.category,
        )
        return session.model_dump(mode="json")

    @app.get("/api/v1/sessions/{session_id}/context-window")
    def session_context_window(
        session_id: str,
        draft: str = "",
        current: Repo = repo_dep,
    ) -> dict[str, object]:
        """Estimate the next request's context for one agent session."""
        from contextgit.llm.context_window import context_window, estimate_tokens

        session = current.get_session(session_id)
        commits = current.log(session.branch)
        messages = current.build_context(commits[0].id) if commits else []
        staged = current.staged(session_id)
        text = "\n".join(item.content for item in [*messages, *staged])
        if draft:
            text += "\n" + draft
        model = session.model or next((item.model for item in commits if item.model), None)
        window = context_window(model)
        used = estimate_tokens(text)
        return {
            "session_id": session_id,
            "agent": session.agent,
            "model": model,
            "used_tokens": used,
            "limit_tokens": window.limit,
            "percentage": round((used / window.limit) * 100, 1) if window.limit else None,
            "remaining_tokens": max(window.limit - used, 0) if window.limit else None,
            "source": window.source,
            "estimated": True,
            "draft_tokens": estimate_tokens(draft),
        }

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
    def delete_session(
        session_id: str,
        permanent: bool = False,
        remove_worktree: bool = True,
        force_worktree: bool = False,
        current: Repo = repo_dep,
    ) -> None:
        """Move a run to Storage, or permanently delete it with explicit cleanup flags."""
        if permanent:
            current.delete_session(
                session_id,
                remove_worktree=remove_worktree,
                force_worktree=force_worktree,
            )
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

    @app.get("/api/v1/skills")
    def library_skills(project_path: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        library = SkillLibrary(current.canonical_project_path(project_path))
        # Existing approved lessons become reviewed project skills once, preserving evidence.
        known_sources = {skill.source_lesson for skill in library.list(include_removed=True)}
        for lesson in current.knowledge.records.list(project_path, "lesson"):
            if (
                isinstance(lesson, Lesson)
                and lesson.status == "approved"
                and lesson.id not in known_sources
            ):
                skill = library.propose(
                    SkillDraft(
                        title=lesson.title,
                        instruction=lesson.instruction,
                        evidence=lesson.evidence,
                        scope=lesson.scope,
                        source_session=lesson.session_id,
                        source_lesson=lesson.id,
                    )
                )
                library.review("project", skill.id, "approve")
                known_sources.add(lesson.id)
        return [skill.model_dump(mode="json") for skill in library.list()]

    @app.post("/api/v1/skills", status_code=201)
    def propose_library_skill(
        body: SkillDraft, project_path: str, current: Repo = repo_dep
    ) -> dict[str, object]:
        if body.source_team:
            team = current.get_team(body.source_team)
            if current.canonical_project_path(team.project_path) != current.canonical_project_path(
                project_path
            ):
                raise HTTPException(
                    status_code=400, detail="source team belongs to another project"
                )
        return (
            SkillLibrary(current.canonical_project_path(project_path))
            .propose(body)
            .model_dump(mode="json")
        )

    @app.post("/api/v1/skills/{origin}/{skill_id}/review")
    def review_library_skill(
        origin: str,
        skill_id: str,
        body: SkillReviewRequest,
        project_path: str,
        current: Repo = repo_dep,
    ) -> dict[str, object]:
        try:
            return (
                SkillLibrary(current.canonical_project_path(project_path))
                .review(origin, skill_id, body.action, body.instruction)
                .model_dump(mode="json")
            )
        except (ValueError, OSError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    def _spatial_team(current: Repo, team_id: str) -> dict[str, object]:
        board = current.team_board(team_id)
        if board is None:
            raise TeamNotFound(f"team '{team_id[:12]}' not found")
        plan = current.latest_team_plan(team_id)
        return {
            **board.model_dump(mode="json"),
            "layout": current.team_layout(team_id).model_dump(mode="json"),
            "plan": plan.model_dump(mode="json") if plan else None,
            "skills": [link.model_dump(mode="json") for link in current.team_skills(team_id)],
            "execution": current.team_execution.settings(team_id),
            "integrations": current._storage.team_integrations(team_id),
        }

    @app.get("/api/v1/teams")
    def list_spatial_teams(
        project_path: str | None = None, current: Repo = repo_dep
    ) -> list[dict[str, object]]:
        teams = current.list_teams(project_path=project_path)
        return [_spatial_team(current, team.id) for team in teams if team.archived_at is None]

    @app.post("/api/v1/canvas/import-sessions")
    def import_canvas_sessions(
        project_path: str, current: Repo = repo_dep
    ) -> list[dict[str, object]]:
        return [
            _spatial_team(current, team.id)
            for team in current.import_ungrouped_sessions(project_path)
        ]

    @app.post("/api/v1/canvas/group-workers", status_code=201)
    def group_canvas_workers(
        body: GroupWorkersRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        team = current.regroup_workers(body.project_path, body.name, body.task_ids)
        return _spatial_team(current, team.id)

    @app.put("/api/v1/teams/{team_id}/worker-order")
    def reorder_canvas_workers(
        team_id: str, body: ReorderWorkersRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        current.reorder_workers(team_id, body.task_ids)
        return _spatial_team(current, team_id)

    @app.get("/api/v1/teams/{team_id}")
    def get_spatial_team(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return _spatial_team(current, team_id)

    @app.patch("/api/v1/canvas/viewport")
    def patch_canvas_viewport(
        body: CanvasViewportRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return current.save_canvas_viewport(
            body.project_path, x=body.x, y=body.y, zoom=body.zoom
        ).model_dump(mode="json")

    @app.get("/api/v1/canvas/viewport")
    def get_canvas_viewport(project_path: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.canvas_viewport(project_path).model_dump(mode="json")

    @app.put("/api/v1/canvas/viewport")
    def put_canvas_viewport(
        body: CanvasViewportRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return current.save_canvas_viewport(
            body.project_path, x=body.x, y=body.y, zoom=body.zoom
        ).model_dump(mode="json")

    def _spatial_task(current: Repo, team_id: str, task_id: str) -> dict[str, object]:
        task = current.get_task(task_id)
        if task.team_id != team_id:
            raise TaskNotFound(f"task '{task_id[:12]}' not found in this team")
        view = TaskService(current).show(task_id)
        return {**task.model_dump(mode="json"), **view.to_json()}

    @app.get("/api/v1/teams/{team_id}/status")
    def spatial_team_status(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        board = current.team_board(team_id)
        if board is None:
            raise TeamNotFound(f"team '{team_id[:12]}' not found")
        tasks = board.tasks
        return {
            "team": board.team.model_dump(mode="json"),
            "counts": {
                status: sum(task.status == status for task in tasks)
                for status in {task.status for task in tasks}
            },
            "blocked": [task.id for task in tasks if task.status == "blocked"],
            "in_review": [task.id for task in tasks if task.status == "review"],
        }

    @app.get("/api/v1/teams/{team_id}/tasks")
    def list_spatial_tasks(team_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        current.get_team(team_id)
        return [_spatial_task(current, team_id, task.id) for task in current.list_tasks(team_id)]

    @app.post("/api/v1/teams/{team_id}/tasks", status_code=201)
    def create_spatial_task(
        team_id: str, body: TaskCreateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        team = current.get_team(team_id)
        if body.gate_command is not None and body.gate_command != detect_gate(
            Path(team.project_path)
        ):
            raise HTTPException(
                status_code=400,
                detail="gate_command must match the project's detected quality gate",
            )
        task = current.create_task(
            team_id,
            title=body.title,
            brief=body.brief,
            done_criteria=body.done_criteria,
            role=body.role,
            agent=body.agent,
            scope=body.scope,
            contract=body.contract,
            depends_on=body.depends_on,
            gate_command=body.gate_command,
            parent_id=body.parent_id,
        )
        return _spatial_task(current, team_id, task.id)

    @app.patch("/api/v1/teams/{team_id}/tasks/{task_id}")
    def update_spatial_task(
        team_id: str, task_id: str, body: TaskUpdateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        task = current.get_task(task_id)
        if task.team_id != team_id:
            raise TaskNotFound(f"task '{task_id[:12]}' not found in this team")
        if body.gate_command is not None:
            team = current.get_team(team_id)
            if body.gate_command != detect_gate(Path(team.project_path)):
                raise HTTPException(
                    status_code=400,
                    detail="gate_command must match the project's detected quality gate",
                )
        current.update_task(
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
            current.set_task_deps(task_id, body.depends_on)
        return _spatial_task(current, team_id, task_id)

    @app.delete("/api/v1/teams/{team_id}/tasks/{task_id}", status_code=204)
    def delete_spatial_task(team_id: str, task_id: str, current: Repo = repo_dep) -> None:
        _spatial_task(current, team_id, task_id)
        current.delete_task(task_id)

    @app.post("/api/v1/teams/{team_id}/launch")
    def launch_spatial_team(team_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        return [task.model_dump(mode="json") for task in current.launch_team(team_id)]

    @app.get("/api/v1/teams/{team_id}/tasks/{task_id}/events")
    def spatial_task_events(
        team_id: str, task_id: str, current: Repo = repo_dep
    ) -> list[dict[str, object]]:
        _spatial_task(current, team_id, task_id)
        return TaskService(current).events(task_id)

    @app.get("/api/v1/teams/{team_id}/messages")
    def spatial_team_messages(
        team_id: str, limit: int = 50, current: Repo = repo_dep
    ) -> list[dict[str, object]]:
        current.get_team(team_id)
        return [
            message.model_dump(mode="json")
            for message in current.team_messages(team_id, limit=max(1, min(limit, 200)))
        ]

    @app.post("/api/v1/teams/{team_id}/messages", status_code=201)
    def post_spatial_team_message(
        team_id: str, body: TeamMessageRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        current.get_team(team_id)
        for task_id in (body.task_id, body.from_task_id):
            if task_id and current.get_task(task_id).team_id != team_id:
                raise TaskNotFound(f"task '{task_id[:12]}' not found in this team")
        return current.post_message(
            team_id, body.body, kind=body.kind, task_id=body.task_id, from_task_id=body.from_task_id
        ).model_dump(mode="json")

    @app.post("/api/v1/teams", status_code=201)
    def create_spatial_team(body: TeamCreateRequest, current: Repo = repo_dep) -> dict[str, object]:
        if body.managed_execution:
            from contextgit.core.cli_models import TEAM_CLIS, validate_model
            try:
                if body.orchestrator_agent not in TEAM_CLIS:
                    raise ValueError("Choose a supported parent CLI")
                validate_model(body.orchestrator_model)
                for agent, model in body.worker_models.items():
                    if agent not in body.allowed_agents:
                        raise ValueError("Worker models must belong to an allowed CLI")
                    validate_model(model)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        if body.gate_command is not None and body.gate_command != detect_gate(
            Path(body.project_path)
        ):
            raise HTTPException(
                status_code=400,
                detail="gate_command must match the project's detected quality gate",
            )
        team = current.create_team(
            body.name,
            project_path=body.project_path,
            base_ref=body.base_ref,
            goal=body.goal,
            orchestrator_agent=body.orchestrator_agent,
        )
        if body.gate_command is not None:
            team = current.set_team_gate(team.id, body.gate_command)
        same_project = current.list_teams(project_path=team.project_path)
        if body.managed_execution:
            current.team_execution.configure(team.id, body.max_active, list(body.allowed_agents),
                body.orchestrator_model, body.worker_models)
        current.save_team_layout(team.id, x=80 + (len(same_project) - 1) * 1040, y=80)
        return _spatial_team(current, team.id)

    @app.delete("/api/v1/teams/{team_id}", status_code=204)
    def archive_spatial_team(team_id: str, current: Repo = repo_dep) -> None:
        current.archive_team(team_id)

    @app.patch("/api/v1/teams/{team_id}")
    def update_spatial_team(
        team_id: str, body: TeamUpdateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        current.update_team_details(team_id, **body.model_dump(exclude_none=True))
        return _spatial_team(current, team_id)

    @app.post("/api/v1/teams/{team_id}/orchestrator/start")
    def start_team_orchestrator(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        if not current.team_execution.settings(team_id):
            return _start_team_orchestrator(team_id, current)
        from contextgit.integration.service import project_lock
        with project_lock(current.get_team(team_id).project_path, "team-parent"):
            return _start_team_orchestrator(team_id, current)

    def _start_team_orchestrator(team_id: str, current: Repo) -> dict[str, object]:
        team = current.get_team(team_id)
        if team.orchestrator_session_id:
            try:
                existing = current.get_session(team.orchestrator_session_id)
                if existing.worktree_path:
                    ensure_mcp_config(existing.worktree_path, agent=existing.agent, model=existing.model, run_env={
                        "CONTEXTGIT_REPO": str(current.root.resolve()),
                        "CONTEXTGIT_ROLE": "orchestrator",
                        "CONTEXTGIT_TEAM": team.id,
                        "CONTEXTGIT_RUN": existing.name,
                    })
                return existing.model_dump(mode="json")
            except SessionNotFound:
                pass
        agent = team.orchestrator_agent or "claude"
        ensure_mcp_config(team.project_path)
        execution = current.team_execution.settings(team_id)
        session = current.create_session(
            f"{team.name} orchestrator",
            kind="terminal",
            agent=agent,
            model=execution.get("orchestrator_model") if execution else None,
            project_path=team.project_path,
            worktree=bool(execution),
            base_ref=execution["integration_branch"] if execution else None,
            task=current.team_execution.instruction(team_id) if execution else team.goal,
            role="orchestrator",
            category="orchestration",
            skills=[link.title for link in current.team_skills(team_id) if link.task_id is None],
        )
        if session.worktree_path:
            ensure_mcp_config(session.worktree_path, agent=agent, model=session.model, run_env={
                "CONTEXTGIT_REPO": str(current.root.resolve()),
                "CONTEXTGIT_ROLE": "orchestrator",
                "CONTEXTGIT_TEAM": team.id,
                "CONTEXTGIT_RUN": session.name,
            })
        current.update_team_details(team_id, orchestrator_session_id=session.id, state="planning")
        return session.model_dump(mode="json")

    @app.get("/api/v1/teams/{team_id}/plan")
    def get_team_plan(team_id: str, current: Repo = repo_dep) -> dict[str, object] | None:
        current.get_team(team_id)
        plan = current.latest_team_plan(team_id)
        return plan.model_dump(mode="json") if plan else None

    @app.put("/api/v1/teams/{team_id}/plan")
    def save_team_plan(
        team_id: str, body: TeamPlanRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        current.update_team_details(team_id, goal=body.goal or None)
        try:
            return current.save_team_plan(team_id, body.model_dump(mode="json")).model_dump(
                mode="json"
            )
        except InvalidTaskTransition as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post("/api/v1/teams/{team_id}/plan/approve")
    def approve_spatial_team_plan(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        current.approve_team_plan(team_id)
        if current.get_team(team_id).state != "paused":
            current.launch_team(team_id)
        return _spatial_team(current, team_id)

    @app.post("/api/v1/teams/{team_id}/pause")
    def pause_spatial_team(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        current.update_team_details(team_id, state="paused")
        return _spatial_team(current, team_id)

    @app.post("/api/v1/teams/{team_id}/resume")
    def resume_spatial_team(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        current.update_team_details(team_id, state="running")
        if current.team_execution.settings(team_id) and current.latest_team_plan(team_id) and current.latest_team_plan(team_id).status == "approved":
            current.team_execution.integrate(team_id)
        else:
            current.launch_team(team_id)
        return _spatial_team(current, team_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/start")
    def start_spatial_task(
        team_id: str, task_id: str, body: TaskStartRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        TaskService(current).start(task_id, agent=body.agent if body else None)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/stop")
    def stop_spatial_task(
        team_id: str, task_id: str, body: TaskStopRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        TaskService(current).stop(task_id, body.note if body else "stopped by user")
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/retry")
    def retry_spatial_task(
        team_id: str, task_id: str, body: TaskStartRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        TaskService(current).retry(task_id, agent=body.agent if body else None)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/complete")
    def complete_spatial_task(
        team_id: str, task_id: str, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        current.complete_task(task_id)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/gate")
    def gate_spatial_task(
        team_id: str, task_id: str, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        current.run_task_gate(task_id)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/approve")
    def approve_spatial_task(
        team_id: str, task_id: str, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        current.approve_task(task_id)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/reject")
    def reject_spatial_task(
        team_id: str, task_id: str, body: TaskRejectRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        current.reject_task(task_id, body.note)
        return _spatial_task(current, team_id, task_id)

    @app.post("/api/v1/teams/{team_id}/tasks/{task_id}/verify")
    def verify_spatial_task(
        team_id: str, task_id: str, body: TaskVerifyRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        _spatial_task(current, team_id, task_id)
        current.verify_task(task_id, agent=body.agent)
        return _spatial_task(current, team_id, task_id)

    @app.patch("/api/v1/teams/{team_id}/layout")
    def patch_spatial_team_layout(
        team_id: str, body: CanvasLayoutRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return current.update_canvas_layout(
            team_id, **body.model_dump(exclude_unset=True)
        ).model_dump(mode="json")

    @app.put("/api/v1/teams/{team_id}/layout")
    def put_spatial_team_layout(
        team_id: str, body: CanvasLayoutRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        layout = current.team_layout(team_id)
        updates = body.model_dump(exclude_unset=True)
        complete = {
            **layout.model_dump(),
            **{key: value for key, value in updates.items() if value is not None},
        }
        return current.save_team_layout(
            team_id,
            **{key: complete[key] for key in ("x", "y", "width", "height", "collapsed", "z_index")},
        ).model_dump(mode="json")

    @app.post("/api/v1/teams/{team_id}/skills", status_code=201)
    def attach_spatial_team_skill(
        team_id: str, body: SkillLinkRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return current.attach_skill(team_id, **body.model_dump()).model_dump(mode="json")

    @app.get("/api/v1/teams/{team_id}/skills")
    def list_spatial_team_skills(team_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        return [link.model_dump(mode="json") for link in current.team_skills(team_id)]

    @app.delete("/api/v1/teams/{team_id}/skills/{link_id}", status_code=204)
    def detach_spatial_team_skill(team_id: str, link_id: str, current: Repo = repo_dep) -> None:
        current.detach_skill(team_id, link_id)

    @app.post("/api/v1/teams/{team_id}/merge/preview")
    def preview_spatial_team_merge(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        if current.team_execution.settings(team_id):
            return current.team_execution.preview(team_id)
        current.get_team(team_id)
        tasks = current.list_tasks(team_id)
        unfinished = [task.title for task in tasks if task.status != "done"]
        team = current.get_team(team_id)
        ready = bool(tasks) and not unfinished
        changes: list[dict[str, object]] = []
        for task in tasks:
            session = current.get_session(task.session_id) if task.session_id else None
            files: list[dict[str, str]] = []
            conflicts: list[str] = []
            dirty = False
            uncommitted: list[str] = []
            if session and session.worktree_path:
                from contextgit.gitops.spatial import uncommitted_code

                workspace = current.session_workspace(session.id, target=team.base_ref)
                conflicts = workspace.conflicts
                dirty = workspace.dirty
                uncommitted = uncommitted_code(session.worktree_path)
                if uncommitted:
                    ready = False
                    unfinished.append(f"{task.title}: commit outstanding files before merging")
                if conflicts:
                    ready = False
                    unfinished.append(f"{task.title}: merge conflicts")
            if (task.gate_command or team.gate_command) and task.gate_status != "pass":
                ready = False
                unfinished.append(f"{task.title}: quality gate has not passed")
            if session and session.worktree_path:
                try:
                    from contextgit.gitops.repo import Git

                    diff = Git(session.worktree_path).run(
                        "diff", "--name-status", f"{team.base_ref or 'HEAD'}...HEAD"
                    )
                    files = [
                        {"status": parts[0], "path": parts[1]}
                        for line in diff.stdout.splitlines()
                        if len(parts := line.split("\t", 1)) == 2
                    ]
                except Exception:
                    files = []
            changes.append(
                {
                    "task_id": task.id,
                    "title": task.title,
                    "status": task.status,
                    "gate_status": task.gate_status,
                    "gate_output": task.gate_output,
                    "files": files,
                    "conflicts": conflicts,
                    "dirty": dirty,
                    "uncommitted": uncommitted,
                }
            )
        if ready:
            current.update_team_details(team_id, state="merge_ready")
        return {
            "ready": ready,
            "unfinished": unfinished,
            "tasks": [task.model_dump(mode="json") for task in tasks],
            "changes": changes,
            "checks": [
                {"task_id": task.id, "command": task.gate_command, "status": task.gate_status}
                for task in tasks
            ],
            "requires_confirmation": True,
        }

    @app.post("/api/v1/teams/{team_id}/merge/confirm")
    def confirm_spatial_team_merge(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        if current.team_execution.settings(team_id):
            return current.team_execution.confirm(team_id)
        current.get_team(team_id)
        tasks = current.list_tasks(team_id)
        if not tasks or any(task.status != "done" for task in tasks):
            raise TaskNotReviewable("all team tasks must be approved before merging")
        preview = preview_spatial_team_merge(team_id, current)
        if not preview["ready"]:
            raise TaskNotReviewable("Resolve merge conflicts and pass quality gates before merging")
        current.queue_done_tasks(team_id)
        entries = current.run_merge_queue(team_id=team_id)
        session_ids = {task.session_id for task in tasks}
        all_entries = [entry for entry in current.merge_queue() if entry.session_id in session_ids]
        if any(entry.status != "merged" for entry in all_entries):
            return {
                "entries": [entry.model_dump(mode="json") for entry in entries],
                "completed": False,
            }
        current.update_team_details(team_id, state="completed")
        return {"entries": [entry.model_dump(mode="json") for entry in entries]}

    @app.post("/api/v1/teams/{team_id}/integrate")
    def integrate_parent_team(team_id: str, current: Repo = repo_dep) -> dict[str, object]:
        return current.team_execution.integrate(team_id)

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
            body.name,
            project_path=body.project_path,
            base_ref=body.base_ref,
            goal=body.goal,
            orchestrator_agent=body.orchestrator_agent,
        )
        if body.gate_command is not None:
            team = current.set_team_gate(team.id, body.gate_command)
        board = current.team_board(team.id)
        if board is None:  # pragma: no cover - just created, cannot be missing
            raise TeamNotFound("team disappeared right after creation")
        return board.model_dump(mode="json")

    @app.patch("/api/v1/team")
    def set_team_gate(body: TeamGateRequest, current: Repo = repo_dep) -> dict[str, object]:
        """Set the team's default quality gate command (legacy shim)."""
        project_path = current.root.parent if current.root.name == ".contextgit" else current.root
        team = current.team_for_project(str(project_path)) or current.current_team()
        if team is None:
            raise TeamNotFound("no team yet")
        detected_gate = detect_gate(Path(team.project_path).expanduser())
        if body.gate_command != detected_gate:
            raise HTTPException(
                status_code=400,
                detail="gate_command must match the project's detected quality gate",
            )
        return current.set_team_gate(team.id, body.gate_command).model_dump(mode="json")

    def _task_detail(current: Repo, task_id: str) -> dict[str, object]:
        task = current.get_task(task_id)
        view = TaskService(current).show(task_id)
        return {**task.model_dump(mode="json"), **view.to_json()}

    def _create_task(body: TaskCreateRequest, current: Repo) -> dict[str, object]:
        project_path = current.root.parent if current.root.name == ".contextgit" else current.root
        team = current.team_for_project(str(project_path))
        project_path = Path(team.project_path).expanduser() if team else project_path
        if body.gate_command is not None:
            detected_gate = detect_gate(project_path)
            if body.gate_command != detected_gate:
                raise HTTPException(
                    status_code=400,
                    detail="gate_command must match the project's detected quality gate",
                )
        view = TaskService(current).create(
            body.title,
            brief=body.brief,
            done_criteria=body.done_criteria,
            role=body.role,
            agent=body.agent,
            scope=body.scope,
            contract=body.contract,
            depends_on=body.depends_on,
            gate_command=body.gate_command,
            parent_id=body.parent_id,
        )
        return _task_detail(current, view.id)

    @app.get("/api/v1/tasks")
    def list_tasks(current: Repo = repo_dep) -> list[dict[str, object]]:
        return [_task_detail(current, view.id) for view in TaskService(current).list_tasks()]

    @app.get("/api/v1/tasks/{task_id}")
    def show_task(task_id: str, current: Repo = repo_dep) -> dict[str, object]:
        task = current.get_task(task_id)
        project_path = current.root.parent if current.root.name == ".contextgit" else current.root
        task_project = Path(current.get_team(task.team_id).project_path).expanduser().resolve()
        if task_project != project_path.expanduser().resolve():
            raise TaskNotFound(f"task '{task_id[:12]}' not found in this project")
        return _task_detail(current, task_id)

    @app.post("/api/v1/tasks", status_code=201)
    def create_standalone_task(
        body: TaskCreateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return _create_task(body, current)

    @app.post("/api/v1/team/tasks", status_code=201)
    def create_legacy_team_task(
        body: TaskCreateRequest, current: Repo = repo_dep
    ) -> dict[str, object]:
        return _create_task(body, current)

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
        return _task_detail(current, task.id)

    @app.delete("/api/v1/team/tasks/{task_id}", status_code=204)
    def delete_task(task_id: str, current: Repo = repo_dep) -> None:
        current.delete_task(task_id)

    @app.post("/api/v1/team/launch")
    def launch_team(current: Repo = repo_dep) -> list[dict[str, object]]:
        """Start every ready task; blocked tasks stay blocked."""
        return [task.model_dump(mode="json") for task in current.launch_team()]

    @app.post("/api/v1/team/tasks/{task_id}/start")
    def start_task(
        task_id: str, body: TaskStartRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        TaskService(current).start(task_id, agent=body.agent if body else None)
        return _task_detail(current, task_id)

    @app.post("/api/v1/team/tasks/{task_id}/stop")
    def stop_task(
        task_id: str, body: TaskStopRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        TaskService(current).stop(task_id, body.note if body else "stopped by user")
        return _task_detail(current, task_id)

    @app.post("/api/v1/team/tasks/{task_id}/retry")
    def retry_task(
        task_id: str, body: TaskStartRequest | None = None, current: Repo = repo_dep
    ) -> dict[str, object]:
        TaskService(current).retry(task_id, agent=body.agent if body else None)
        return _task_detail(current, task_id)

    @app.get("/api/v1/team/tasks/{task_id}/events")
    def task_events(task_id: str, current: Repo = repo_dep) -> list[dict[str, object]]:
        return TaskService(current).events(task_id)

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
