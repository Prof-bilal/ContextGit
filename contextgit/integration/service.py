"""Project-scoped durable jobs, isolated candidates, and conditional publication."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from contextgit.core.models import UsageEvent, utcnow
from contextgit.integration.runners import Cancelled, CLIRunner, execute
from contextgit.integration.usage import observation

ACTIVE = {"building", "reviewing", "checking", "publishing"}
TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}
_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def git(root: Path | str, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if check and result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git operation failed")
    return result.stdout.strip()


@contextmanager
def project_lock(project: str, name: str = "integration") -> Iterator[None]:
    with _LOCKS_GUARD:
        lock = _LOCKS.setdefault(project + name, threading.RLock())
    with lock:
        common = Path(git(project, "rev-parse", "--path-format=absolute", "--git-common-dir"))
        with (common / f"contextgit-{name}.lock").open("a") as handle:
            if os.name == "posix":
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "posix":
                    fcntl.flock(handle, fcntl.LOCK_UN)


class IntegrationService:
    def __init__(self, repo: Any, runner: Any = None) -> None:
        self.repo = repo
        self.runner = runner or CLIRunner()
        self.db_path = repo._storage._db_path
        self.lock = threading.RLock()
        self.cancel_events: dict[str, threading.Event] = {}
        self.stopping = threading.Event()
        self.thread: threading.Thread | None = None
        self.workers: dict[str, threading.Thread] = {}

    @contextmanager
    def db(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            conn = sqlite3.connect(self.db_path, timeout=30)
            conn.row_factory = sqlite3.Row
            try:
                with conn:
                    yield conn
            finally:
                conn.close()

    def project(self, path: str) -> str:
        root = str(Path(path).expanduser().resolve())
        if git(root, "rev-parse", "--show-toplevel") != root:
            raise ValueError("Select the project repository root")
        return root

    def settings(self, project: str) -> dict[str, Any]:
        project = self.project(project)
        with self.db() as db:
            row = db.execute(
                "SELECT payload FROM integration_settings WHERE project=?", (project,)
            ).fetchone()
        stored = cast(dict[str, Any], json.loads(row[0])) if row else None
        branches = git(
            project, "for-each-ref", "--format=%(refname:short)", "refs/heads"
        ).splitlines()
        if stored:
            return {**stored, "branches": branches}
        return {
            "project": project,
            "harness": "codex",
            "target": "main" if "main" in branches else "",
            "checks": "",
            "authority": "disabled",
            "generation": 0,
            "branches": branches,
        }

    def configure(
        self, project: str, harness: str, target: str, checks: str, authority: str
    ) -> dict[str, Any]:
        project = self.project(project)
        if authority not in {"enabled", "paused", "disabled"}:
            raise ValueError("Invalid authority")
        if harness not in {"codex", "claude"}:
            raise ValueError("Select Codex or Claude Code")
        with self.lock, project_lock(project, "authority"):
            old = self.settings(project)
            if authority == "enabled":
                if not checks.strip():
                    raise ValueError("Automatic integration requires a check command")
                if any(
                    session.project_path
                    and str(Path(session.project_path).resolve()) == project
                    and session.git_branch == target
                    for session in self.repo.list_sessions()
                ):
                    raise ValueError("The integration target cannot be a worker branch")
                git(project, "check-ref-format", "--branch", target)
                git(project, "rev-parse", "--verify", f"refs/heads/{target}")
                self.runner.capability(harness)
            value = {
                **old,
                "harness": harness,
                "target": target,
                "checks": checks.strip(),
                "authority": authority,
                "generation": old["generation"]
                + int(
                    authority == "disabled"
                    or old["authority"] == "disabled"
                    or (harness, target, checks.strip())
                    != (old["harness"], old["target"], old["checks"])
                ),
            }
            with self.db() as db:
                db.execute(
                    "INSERT OR REPLACE INTO integration_settings VALUES (?,?)",
                    (project, json.dumps(value)),
                )
            for job in self.jobs(project):
                if job["state"] in ACTIVE:
                    self.cancel_events.setdefault(job["id"], threading.Event()).set()
        return value

    def jobs(self, project: str | None = None) -> list[dict[str, Any]]:
        with self.db() as db:
            rows = db.execute(
                "SELECT payload FROM integration_jobs"
                + (" WHERE project=?" if project else "")
                + " ORDER BY rowid",
                (str(Path(project).resolve()),) if project else (),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def job(self, job_id: str) -> dict[str, Any]:
        with self.db() as db:
            row = db.execute(
                "SELECT payload FROM integration_jobs WHERE id=?", (job_id,)
            ).fetchone()
        if not row:
            raise ValueError("Integration job not found")
        return cast(dict[str, Any], json.loads(row[0]))

    def save(self, job: dict[str, Any], **updates: Any) -> dict[str, Any]:
        with self.lock:
            # Never overwrite a cancellation that arrived during inference/checks.
            current = self.job(job["id"])
            if current["state"] == "cancelled" and updates.get("state") not in {
                "succeeded",
                "queued",
            }:
                updates["state"] = "cancelled"
            job.update(updates, updated_at=utcnow().isoformat())
            with self.db() as db:
                db.execute(
                    "UPDATE integration_jobs SET payload=? WHERE id=?", (json.dumps(job), job["id"])
                )
        return job

    def ready(self, session_id: str, task_id: str | None = None) -> dict[str, Any]:
        session = self.repo.get_session(session_id)
        if not session.project_path or not session.worktree_path or not session.git_branch:
            raise ValueError("Ready for integration requires a committed Git worker worktree")
        project = self.project(session.project_path)
        settings = self.settings(project)
        if settings["authority"] != "enabled":
            raise ValueError("Automatic integration is not enabled for this project")
        if not settings["checks"]:
            raise ValueError("Configure required checks first")
        if settings["target"] == session.git_branch:
            raise ValueError("The integration target cannot be the worker branch")
        worker = session.worktree_path
        if git(worker, "status", "--porcelain", "--untracked-files=all"):
            raise ValueError("Commit all changes and clean the worker worktree before integration")
        source = git(worker, "rev-parse", "HEAD")
        if git(project, "rev-parse", f"refs/heads/{session.git_branch}") != source:
            raise ValueError("Worker HEAD must match its recorded branch")
        if session.base_commit == source:
            raise ValueError("Worker has no committed changes")
        with self.db() as db:
            row = db.execute(
                "SELECT payload FROM integration_jobs WHERE project=? AND target=? "
                "AND session_id=? AND source_sha=?",
                (project, settings["target"], session_id, source),
            ).fetchone()
            if row:
                existing = json.loads(row[0])
                if task_id and not existing.get("task_id"):
                    existing["task_id"] = task_id
                    db.execute(
                        "UPDATE integration_jobs SET payload=? WHERE id=?",
                        (json.dumps(existing), existing["id"]),
                    )
                return cast(dict[str, Any], existing)
            now = utcnow().isoformat()
            job = {
                "id": uuid4().hex,
                "project": project,
                "target": settings["target"],
                "session_id": session_id,
                "source_sha": source,
                "worker": worker,
                "source_branch": session.git_branch,
                "task_id": task_id,
                "conversation_branch": session.branch,
                "brief": (
                    (
                        self.repo.get_task(task_id).brief
                        + "\n"
                        + self.repo.get_task(task_id).done_criteria
                    )
                    if task_id
                    else session.task or ""
                ),
                "generation": settings["generation"],
                "state": "queued",
                "attempts": 0,
                "target_sha": None,
                "candidate_commit": None,
                "verdict": None,
                "conflicts": [],
                "resolution_diff": "",
                "check_output": "",
                "usage": None,
                "feedback": "",
                "created_at": now,
                "updated_at": now,
            }
            db.execute(
                "INSERT OR IGNORE INTO integration_jobs VALUES (?,?,?,?,?,?)",
                (job["id"], project, job["target"], session_id, source, json.dumps(job)),
            )
            row = db.execute(
                "SELECT payload FROM integration_jobs WHERE project=? AND target=? "
                "AND session_id=? AND source_sha=?",
                (project, settings["target"], session_id, source),
            ).fetchone()
            assert row
            job = json.loads(row[0])
        return cast(dict[str, Any], job)

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self.lock, project_lock(self.job(job_id)["project"], "authority"):
            job = self.job(job_id)
            if job["state"] == "succeeded":
                raise ValueError("A published integration cannot be cancelled")
            self.cancel_events.setdefault(job_id, threading.Event()).set()
            return self.save(job, state="cancelled", feedback="Cancelled by user")

    def retry(self, job_id: str) -> dict[str, Any]:
        with self.lock:
            job = self.job(job_id)
            if job["state"] not in TERMINAL - {"succeeded"}:
                raise ValueError("Only stopped jobs can be retried")
            settings = self.settings(job["project"])
            if settings["authority"] != "enabled" or settings["target"] != job["target"]:
                raise ValueError("Enable authority for this target before retrying")
            self.cancel_events[job_id] = threading.Event()
            return self.save(
                job,
                state="queued",
                generation=settings["generation"],
                feedback="",
                candidate_commit=None,
                attempts=0,
            )

    def validate(self, job: dict[str, Any]) -> None:
        if self.stopping.is_set():
            raise Cancelled("Backend is stopping")
        settings = self.settings(job["project"])
        if settings["authority"] != "enabled" or settings["generation"] != job["generation"]:
            raise Cancelled("Integration authority changed; retry after enabling authority")
        if (
            self.job(job["id"])["state"] == "cancelled"
            or self.cancel_events.setdefault(job["id"], threading.Event()).is_set()
        ):
            raise Cancelled("Integration cancelled")
        if (
            git(job["project"], "rev-parse", f"refs/heads/{job['source_branch']}")
            != job["source_sha"]
        ):
            raise ValueError("Worker branch changed. Submit the new committed run for integration")
        if git(job["worker"], "rev-parse", "HEAD") != job["source_sha"] or git(
            job["worker"], "status", "--porcelain", "--untracked-files=all"
        ):
            raise ValueError("Worker changed since readiness; commit and resubmit")

    def process(self, job_id: str) -> dict[str, Any]:
        job = self.job(job_id)
        if job["state"] != "queued":
            return job
        with project_lock(job["project"]):
            # A second service may have processed this durable job while we waited.
            job = self.job(job_id)
            if job["state"] != "queued":
                return job
            try:
                for _ in range(3):  # Moving target: rebuild and check; bounded to avoid starvation.
                    self.validate(job)
                    settings = self.settings(job["project"])
                    target = git(job["project"], "rev-parse", f"refs/heads/{job['target']}")
                    self.save(
                        job,
                        state="building",
                        target_sha=target,
                        candidate_commit=None,
                        check_passed=False,
                    )
                    with tempfile.TemporaryDirectory(prefix="contextgit-candidate-") as folder:
                        candidate = Path(folder) / "repo"
                        git(
                            Path(folder),
                            "clone",
                            "--no-hardlinks",
                            "--no-checkout",
                            "--",
                            job["project"],
                            str(candidate),
                        )
                        git(candidate, "config", "user.name", "ContextGit Merge Agent")
                        git(candidate, "config", "user.email", "merge@contextgit.local")
                        # Fetch exact worker objects, including unadvertised worktree branches.
                        git(candidate, "fetch", "--no-tags", job["project"], job["source_sha"])
                        git(candidate, "checkout", "--detach", target)
                        git(
                            candidate,
                            "merge",
                            "--no-commit",
                            "--no-ff",
                            job["source_sha"],
                            check=False,
                        )
                        conflicts = git(
                            candidate, "diff", "--name-only", "--diff-filter=U"
                        ).splitlines()
                        self.save(job, state="reviewing", conflicts=conflicts)
                        base = git(candidate, "merge-base", target, job["source_sha"])
                        changed_paths = git(
                            candidate, "diff", "--name-only", base, job["source_sha"]
                        ).splitlines()
                        if any(
                            Path(name).parts[0] in {".git", ".contextgit"} for name in changed_paths
                        ):
                            raise ValueError(
                                "Integration only accepts code; conversation metadata is excluded"
                            )
                        relevant_versions = {
                            name: {
                                label: git(candidate, "show", f"{sha}:{name}", check=False)
                                for label, sha in [
                                    ("base", base),
                                    ("source", job["source_sha"]),
                                    ("target", target),
                                ]
                            }
                            for name in changed_paths
                        }
                        versions = {}
                        for name in conflicts:
                            versions[name] = {
                                label: git(candidate, "show", f"{sha}:{name}", check=False)
                                for label, sha in [
                                    ("base", base),
                                    ("source", job["source_sha"]),
                                    ("target", target),
                                ]
                            }
                            file = candidate / name
                            if file.is_symlink():
                                raise ValueError(
                                    "Symbolic link conflicts require manual resolution"
                                )
                            versions[name]["working"] = (
                                file.read_text(errors="replace") if file.is_file() else ""
                            )
                        diff = git(candidate, "diff", base, job["source_sha"])
                        if (
                            len(diff)
                            + len(json.dumps(versions))
                            + len(json.dumps(relevant_versions))
                            > 500000
                        ):
                            raise ValueError(
                                "Diff is too large for safe automatic review; split this run"
                            )
                        prompt = json.dumps(
                            {
                                "instruction": (
                                    "Review integration against the brief. Approve only if safe. "
                                    "Return a unified Git patch against working conflict versions, "
                                    "editing ONLY conflict paths. No tools or commands. "
                                    "Unclear intent means uncertain. Review clean merges too."
                                ),
                                "brief": job["brief"],
                                "diff": diff,
                                "conflicts": versions,
                                "versions": relevant_versions,
                                "base": base,
                                "source": job["source_sha"],
                                "target": target,
                            }
                        )
                        for attempt in range(2):
                            self.save(job, attempts=job["attempts"] + 1)
                            result = self.runner.review(
                                settings["harness"],
                                prompt,
                                self.cancel_events[job_id],
                                lambda value, harness=settings["harness"]: self.save(
                                    job,
                                    usage=observation(harness, job_id, value),
                                ),
                            )
                            reported = job.get("usage")
                            if reported and reported["totals"]["total_tokens"] is not None:
                                self.repo._storage.insert_usage(
                                    UsageEvent(
                                        provider=settings["harness"],
                                        model=settings["harness"],
                                        surface="code",
                                        source="provider",
                                        session_id=job_id,
                                        branch=job["conversation_branch"],
                                        total_tokens=int(reported["totals"]["total_tokens"]),
                                    )
                                )
                            self.save(job, verdict=result["verdict"], feedback=result["feedback"])
                            if result["verdict"] != "approve":
                                raise ValueError(
                                    result["feedback"] or "Resolution needs worker review"
                                )
                            try:
                                self.apply_patch(candidate, conflicts, result["patch"])
                                break
                            except ValueError as error:
                                if attempt == 1:
                                    raise
                                prompt += "\nPatch validation failed: " + str(error)
                        if git(candidate, "ls-files", "--unmerged"):
                            raise ValueError("Resolution left unresolved Git entries")
                        resolution = git(candidate, "diff", "--cached", target)
                        git(
                            candidate,
                            "commit",
                            "--allow-empty",
                            "-m",
                            f"Integrate {job['session_id']} ({job['source_sha'][:12]})",
                        )
                        sha = git(candidate, "rev-parse", "HEAD")
                        git(candidate, "merge-base", "--is-ancestor", job["source_sha"], sha)
                        self.save(
                            job,
                            state="checking",
                            check_command=settings["checks"],
                            candidate_commit=sha,
                            resolution_diff=resolution,
                        )
                        output = execute(
                            (
                                ["cmd.exe", "/c", settings["checks"]]
                                if os.name == "nt"
                                else ["/bin/sh", "-c", settings["checks"]]
                            ),
                            candidate,
                            self.cancel_events[job_id],
                            on_output=lambda output: self.save(job, check_output=output),
                        )
                        self.save(
                            job,
                            check_output=output[-64000:],
                            check_passed=True,
                            check_exit_code=0,
                            check_ran_at=utcnow().isoformat(),
                        )
                        if (
                            git(candidate, "status", "--porcelain", "--untracked-files=all")
                            or git(candidate, "rev-parse", "HEAD") != sha
                        ):
                            raise ValueError(
                                "Checks changed the candidate; checks must leave it clean"
                            )
                        with self.lock, project_lock(job["project"], "authority"):
                            self.validate(job)
                            if (
                                git(job["project"], "rev-parse", f"refs/heads/{job['target']}")
                                != target
                            ):
                                continue
                            self.save(job, state="publishing")
                            git(job["project"], "fetch", "--no-tags", str(candidate), sha)
                            self.publish(job, sha, target)
                            self.save(
                                job,
                                state="succeeded",
                                feedback="Integrated locally; no push performed",
                            )
                        self.finish_task(job)
                        return job
                raise ValueError("Target keeps changing; retry to build and test a new candidate")
            except Cancelled as error:
                self.save(job, state="cancelled", feedback=str(error))
            except Exception as error:
                if job["state"] == "succeeded":
                    return self.save(
                        job, feedback=f"Integrated locally; Team follow-up pending: {error}"
                    )
                self.save(
                    job,
                    state="failed",
                    feedback=str(error),
                    check_exit_code=getattr(error, "exit_code", None),
                    check_output=(
                        str(error)[-64000:] if job["state"] == "checking" else job["check_output"]
                    ),
                )
                if job.get("task_id") and self.repo.get_task(job["task_id"]).status == "review":
                    self.repo.reject_task(job["task_id"], "Integration failed: " + str(error))
        return job

    def apply_patch(self, candidate: Path, conflicts: list[str], patch: str) -> None:
        # Failed attempts must leave the original merge/index available to attempt two.
        index = candidate / git(candidate, "rev-parse", "--git-path", "index")
        saved_index = index.read_bytes()
        originals = {
            name: (candidate / name).read_bytes() if (candidate / name).is_file() else None
            for name in conflicts
        }
        try:
            self._apply_patch(candidate, conflicts, patch)
        except Exception:
            index.write_bytes(saved_index)
            for name, contents in originals.items():
                file = candidate / name
                if contents is None:
                    if file.is_file() or file.is_symlink():
                        file.unlink()
                else:
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(contents)
            raise

    def _apply_patch(self, candidate: Path, conflicts: list[str], patch: str) -> None:
        if not conflicts:
            if patch.strip():
                raise ValueError("Clean merge review cannot modify code")
            return
        if not patch.strip():
            raise ValueError("Conflict resolution requires a patch")
        # --numstat validates Git's path parsing, including quoted/rename paths.
        result = subprocess.run(
            ["git", "apply", "--numstat", "-z", "-"],
            cwd=candidate,
            input=patch,
            text=True,
            capture_output=True,
            timeout=30,
        )
        paths = [entry.split("\t", 2)[-1] for entry in result.stdout.split("\0") if entry]
        if (
            result.returncode
            or not paths
            or any(
                name not in conflicts or Path(name).is_absolute() or ".." in Path(name).parts
                for name in paths
            )
            or "120000" in patch
            or "160000" in patch
        ):
            raise ValueError(
                "Patch must edit only conflict files and cannot create links/submodules"
            )
        applied = subprocess.run(
            ["git", "apply", "--check", "-"],
            cwd=candidate,
            input=patch,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if applied.returncode:
            raise ValueError("Patch does not apply to working conflict versions: " + applied.stderr)
        subprocess.run(
            ["git", "apply", "-"],
            cwd=candidate,
            input=patch,
            text=True,
            check=True,
            capture_output=True,
            timeout=30,
        )
        for name in conflicts:
            file = candidate / name
            if file.is_symlink():
                raise ValueError("Automatic resolution of symbolic links is unsupported")
            if file.is_file() and any(
                line.startswith(("<<<<<<< ", "=======", ">>>>>>> "))
                for line in file.read_text(errors="replace").splitlines()
            ):
                raise ValueError("Conflict markers remain")
        git(candidate, "add", "--all", "--", *conflicts)

    def publish(self, job: dict[str, Any], sha: str, target: str) -> None:
        records = git(job["project"], "worktree", "list", "--porcelain").split("\n\n")
        checkouts = []
        for record in records:
            lines = record.splitlines()
            if f"branch refs/heads/{job['target']}" in lines:
                checkouts.append(lines[0].removeprefix("worktree "))
        if len(checkouts) > 1:
            raise ValueError("Target is checked out more than once")
        if checkouts:
            checkout = checkouts[0]
            if git(checkout, "status", "--porcelain", "--untracked-files=all"):
                raise ValueError("Target checkout is dirty; commit or clean it before retrying")
            for operation in (
                "MERGE_HEAD",
                "CHERRY_PICK_HEAD",
                "REVERT_HEAD",
                "rebase-merge",
                "rebase-apply",
                "BISECT_LOG",
            ):
                location = git(checkout, "rev-parse", "--git-path", operation)
                if (Path(checkout) / location).exists():
                    raise ValueError("Target checkout has an active Git operation")
            if git(checkout, "rev-parse", "HEAD") != target:
                raise ValueError("Target moved before publication")
            git(checkout, "merge", "--ff-only", sha)
        else:
            git(job["project"], "update-ref", f"refs/heads/{job['target']}", sha, target)

    def finish_task(self, job: dict[str, Any]) -> None:
        task_id = job.get("task_id")
        if task_id and self.repo.get_task(task_id).status == "review":
            self.repo.approve_task(task_id)

    def recover(self) -> None:
        for job in self.jobs():
            if job["state"] not in ACTIVE | {"succeeded"}:
                continue
            try:
                self._recover_job(job)
            except Exception as error:
                self.save(
                    job,
                    state=job["state"] if job["state"] == "succeeded" else "interrupted",
                    feedback=f"Recovery needs attention: {error}",
                )

    def _recover_job(self, job: dict[str, Any]) -> None:
        with project_lock(job["project"]):
            job = self.job(job["id"])
            if job["state"] in ACTIVE:
                candidate = job.get("candidate_commit")
                published = (
                    candidate
                    and job.get("check_passed")
                    and subprocess.run(
                        [
                            "git",
                            "merge-base",
                            "--is-ancestor",
                            candidate,
                            f"refs/heads/{job['target']}",
                        ],
                        cwd=job["project"],
                        capture_output=True,
                        timeout=30,
                    ).returncode
                    == 0
                )
                self.save(
                    job,
                    state="succeeded" if published else "interrupted",
                    feedback="Recovered published commit"
                    if published
                    else "Interrupted; retry required",
                )
            if job["state"] == "succeeded":
                self.finish_task(job)

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.stopping.clear()

        def work(job_id: str) -> None:
            try:
                self.process(job_id)
            except Exception as error:
                self.save(self.job(job_id), state="failed", feedback=str(error))

        def run() -> None:
            self.recover()
            while not self.stopping.is_set():
                for job in self.jobs():
                    if self.stopping.is_set():
                        break
                    project = job["project"]
                    previous = self.workers.get(project)
                    if job["state"] != "queued" or (previous and previous.is_alive()):
                        continue
                    try:
                        if self.settings(project)["authority"] != "enabled":
                            continue
                    except Exception as error:
                        self.save(job, state="failed", feedback=str(error))
                        continue
                    worker = threading.Thread(
                        target=work, args=(job["id"],), daemon=True, name="contextgit-project-merge"
                    )
                    self.workers[project] = worker
                    worker.start()
                self.stopping.wait(1)

        self.thread = threading.Thread(target=run, name="contextgit-integration", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        for event in self.cancel_events.values():
            event.set()
        if self.thread:
            self.thread.join(timeout=5)
        for worker in self.workers.values():
            worker.join(timeout=5)
