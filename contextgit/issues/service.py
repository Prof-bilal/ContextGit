"""Conservative repository scans used by the Issues surface.

The first implementation intentionally favors deterministic, safe findings. It
does not execute project-defined scripts and never stores a discovered secret.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx

from contextgit.core.models import (
    IssueFinding,
    IssueLink,
    IssueScanConfig,
    IssueScanner,
    IssueScanRun,
    IssueSeverity,
    IssueTrigger,
    Message,
    utcnow,
)
from contextgit.core.repo import Repo
from contextgit.llm.base import LLMProvider

_SKIP = {".git", ".contextgit", "node_modules", ".venv", "venv", "dist", "build", ".next"}
_TEXT_SUFFIXES = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".env",
    ".md",
    ".sql",
    ".sh",
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".graphql",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".kt",
    ".less",
    ".php",
    ".rs",
    ".rb",
    ".scss",
    ".swift",
    ".svelte",
    ".vue",
    ".xml",
    ".ini",
    ".cfg",
    ".conf",
}
_SECRET_PATTERNS = (
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    (
        "generic-secret",
        re.compile(
            r"(?i)\b(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([A-Za-z0-9_\-/+=]{20,})"
        ),
    ),
)
_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _fingerprint(scanner: str, rule_id: str, location: str | None, title: str) -> str:
    value = "|".join(
        (scanner, rule_id, (location or "").replace("\\", "/"), " ".join(title.lower().split()))
    )
    return hashlib.sha256(value.encode()).hexdigest()[:32]


def _mask(value: str) -> str:
    if len(value) <= 8:
        return "[redacted]"
    return f"{value[:3]}…{value[-4:]}"


def _finding(
    run_id: str,
    scanner: IssueScanner,
    rule_id: str,
    severity: IssueSeverity,
    confidence: float,
    title: str,
    location: str | None,
    evidence: str,
    why: str,
    fix: str,
) -> IssueFinding:
    fingerprint = _fingerprint(scanner, rule_id, location, title)
    return IssueFinding(
        id=uuid4().hex,
        run_id=run_id,
        fingerprint=fingerprint,
        scanner=scanner,
        rule_id=rule_id,
        severity=severity,
        confidence=confidence,
        title=title,
        location=location,
        evidence=evidence,
        why=why,
        fix=fix,
    )


def _files(root: Path) -> list[Path]:
    files: list[Path] = []
    candidates: list[Path]
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=root,
            capture_output=True,
            timeout=10,
            check=False,
        )
        tracked_paths = [
            root / item for item in tracked.stdout.decode(errors="ignore").split("\0") if item
        ]
        # Include untracked source files too; a local scan should inspect the
        # working tree, not only the last commit.
        candidates = list(dict.fromkeys(tracked_paths + list(root.rglob("*"))))
    except (OSError, subprocess.TimeoutExpired):
        candidates = list(root.rglob("*"))
    for path in candidates:
        if not path.is_file() or any(part in _SKIP for part in path.parts):
            continue
        if (
            path.suffix.lower() not in _TEXT_SUFFIXES
            and path.name
            not in {
                "Dockerfile",
                "Makefile",
            }
            and not path.name.startswith(".")
        ):
            continue
        try:
            if path.stat().st_size > 512 * 1024:
                continue
            if b"\0" in path.read_bytes()[:8192]:
                continue
        except OSError:
            continue
        files.append(path)
        if len(files) >= 4000:
            break
    return files


def _project_root(repo: Repo) -> Path:
    """Return the user project, not ContextGit's metadata directory."""
    return repo.root.parent if repo.root.name == ".contextgit" else repo.root


def _scan_secrets(root: Path, run_id: str) -> list[IssueFinding]:
    findings: list[IssueFinding] = []
    for path in _files(root):
        try:
            text = path.read_text("utf-8", errors="ignore")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for rule_id, pattern in _SECRET_PATTERNS:
                match = pattern.search(line)
                if not match:
                    continue
                raw = match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(0)
                findings.append(
                    _finding(
                        run_id,
                        "secrets",
                        rule_id,
                        "critical",
                        1.0,
                        "Potential secret committed to the repository",
                        f"{path.relative_to(root)}:{line_no}",
                        _mask(raw),
                        "A credential in source control can be copied and abused.",
                        "Revoke or rotate the credential, remove it from history, "
                        "and load it from a secret store.",
                    )
                )
                break
    return findings


def _scan_osv(root: Path, run_id: str) -> list[IssueFinding]:
    local = root / ".contextgit" / "tools" / "osv-scanner"
    executable = (
        str(local) if local.is_file() and os.access(local, os.X_OK) else shutil_which("osv-scanner")
    )
    if not executable:
        return []
    try:
        completed = subprocess.run(
            [executable, "scan", "source", "--format", "json", str(root)],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return []
    findings: list[IssueFinding] = []
    for result in payload.get("results", []):
        source = result.get("source", {}).get("path")
        for package in result.get("packages", []):
            pkg = package.get("package", {})
            name = str(pkg.get("name", "unknown"))
            version = str(pkg.get("version", "unknown"))
            for vuln in package.get("vulnerabilities", []):
                advisory = str(vuln.get("id") or (vuln.get("aliases") or ["unknown"])[0])
                score = _cvss(vuln)
                severity = "critical" if score >= 9 else "high" if score >= 7 else "medium"
                findings.append(
                    _finding(
                        run_id,
                        "dependencies",
                        advisory,
                        severity,
                        1.0,
                        f"Vulnerable dependency: {name}@{version}",
                        str(Path(source).relative_to(root)) if source else name,
                        advisory,
                        "The dependency matches a published vulnerability advisory.",
                        "Upgrade to a fixed version or apply the advisory's documented mitigation.",
                    )
                )
    return findings


def _review_prompt(files: list[tuple[str, str]]) -> str:
    payload = "\n\n".join(f"===== FILE: {name} =====\n{content}" for name, content in files)
    return (
        "You are a senior application-security and reliability reviewer.\n"
        "Review the supplied repository files for real, actionable bugs, security "
        "vulnerabilities, auth holes, data-loss risks, unsafe input handling, and "
        "serious correctness failures. Do not report style or speculative concerns.\n\n"
        "Return ONLY valid JSON with a top-level findings array. Each finding must "
        "contain rule_id, severity (critical|high|medium|low), confidence (0..1), "
        "title, location (relative/path:real-line), evidence, why, and fix.\n"
        "Rules: location must be a real supplied file and 1-based line; keep evidence "
        "under 240 characters; do not include credentials; return [] when nothing is "
        "justified.\n\n" + payload
    )


def _redact_review_text(value: str) -> str:
    redacted = value
    for _, pattern in _SECRET_PATTERNS:
        redacted = pattern.sub(lambda match: _mask(match.group(0)), redacted)
    return redacted[:240]


def _scan_ai_review(root: Path, run_id: str, provider: LLMProvider | None) -> list[IssueFinding]:
    if provider is None:
        return []
    sources: list[tuple[str, str]] = []
    locations: dict[str, int] = {}
    for path in _files(root)[:80]:
        try:
            content = path.read_text("utf-8", errors="ignore")[:12_000]
        except OSError:
            continue
        relative = str(path.relative_to(root)).replace("\\", "/")
        sources.append((relative, content))
        locations[relative] = max(1, content.count("\n") + 1)
    if not sources:
        return []
    try:
        raw = provider.complete(
            [
                Message(role="system", content="Return strict machine-readable review JSON."),
                Message(role="user", content=_review_prompt(sources)),
            ],
            temperature=0,
        )
        cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
        payload = json.loads(cleaned)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError):
        return []
    entries = payload.get("findings", []) if isinstance(payload, dict) else []
    if not isinstance(entries, list):
        return []
    findings: list[IssueFinding] = []
    for entry in entries[:50]:
        if not isinstance(entry, dict):
            continue
        match = re.fullmatch(r"(.+):(\d+)", str(entry.get("location", "")))
        if not match:
            continue
        relative, line_text = match.groups()
        line_no = int(line_text)
        if relative not in locations or not 1 <= line_no <= locations[relative]:
            continue
        try:
            confidence = min(1.0, max(0.0, float(entry.get("confidence", 0))))
        except (TypeError, ValueError):
            continue
        severity = str(entry.get("severity", "")).lower()
        title = str(entry.get("title", "")).strip()
        if severity not in _SEVERITY_RANK or not title or confidence < 0.5:
            continue
        findings.append(
            _finding(
                run_id,
                "review",
                str(entry.get("rule_id", "ai-review"))[:100],
                severity,
                confidence,
                title[:240],
                f"{relative}:{line_no}",
                _redact_review_text(str(entry.get("evidence", ""))),
                str(entry.get("why", "Potential issue identified by AI review."))[:1000],
                str(entry.get("fix", "Review and remediate the reported behavior."))[:1000],
            )
        )
    return findings


def _local_tool(root: Path, name: str) -> str | None:
    candidate = root / "node_modules" / ".bin" / name
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    return shutil_which(name)


def _quality_commands(root: Path) -> list[tuple[str, list[str]]]:
    commands: list[tuple[str, list[str]]] = []
    if (root / "tsconfig.json").is_file():
        tsc = _local_tool(root, "tsc")
        if tsc:
            commands.append(("TypeScript", [tsc, "--noEmit"]))
    if any(
        (root / name).is_file()
        for name in ("eslint.config.js", "eslint.config.mjs", ".eslintrc.json")
    ):
        eslint = _local_tool(root, "eslint")
        if eslint:
            commands.append(("ESLint", [eslint, ".", "--no-error-on-unmatched-pattern"]))
    if (root / "pyproject.toml").is_file():
        ruff = shutil_which("ruff")
        if ruff:
            commands.append(("Ruff", [ruff, "check", "."]))
        pytest = shutil_which("pytest")
        if pytest:
            commands.append(("Pytest", [pytest, "-q"]))
    return commands[:4]


def _scan_quality(root: Path, run_id: str) -> tuple[list[IssueFinding], str]:
    commands = _quality_commands(root)
    if not commands:
        return [], "No safe repository quality command discovered"
    findings: list[IssueFinding] = []
    results: list[str] = []
    for label, argv in commands:
        try:
            completed = subprocess.run(
                argv,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            output = (completed.stdout or completed.stderr or "").strip()[:1200]
        except subprocess.TimeoutExpired:
            completed = None
            output = "timed out after 120 seconds"
        except OSError as exc:
            completed = None
            output = str(exc)[:1200]
        passed = completed is not None and completed.returncode == 0
        results.append(f"{label}: {'passed' if passed else 'failed'}")
        if not passed:
            findings.append(
                _finding(
                    run_id,
                    "quality",
                    f"{label.lower().replace(' ', '-')}-failed",
                    "high",
                    1.0,
                    f"{label} check failed",
                    None,
                    _redact_review_text(output or "The quality command returned a failure."),
                    f"The repository's {label} check reported a failure.",
                    f"Run `{label}` locally, fix the reported errors, and rerun the scan.",
                )
            )
    return findings, "; ".join(results)


def _cvss(vulnerability: dict[str, Any]) -> float:
    scores: list[float] = []
    for severity in vulnerability.get("severity", []):
        try:
            scores.append(float(severity.get("score", 0)))
        except (TypeError, ValueError):
            pass
    return max(scores, default=0.0)


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


def _osv_executable(repo: Repo) -> str | None:
    local = repo.root / "tools" / "osv-scanner"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    return shutil_which("osv-scanner")


def install_osv_scanner(repo: Repo) -> dict[str, object]:
    """Install OSV-Scanner into ContextGit's local tools directory on request."""
    go = shutil_which("go")
    if not go:
        return {"installed": False, "detail": "Go is not installed; install Go first."}
    target = repo.root / "tools"
    target.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["GOBIN"] = str(target)
    try:
        completed = subprocess.run(
            [go, "install", "github.com/google/osv-scanner/v2/cmd/osv-scanner@latest"],
            cwd=repo.root,
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"installed": False, "detail": f"OSV-Scanner installation failed: {exc}"}
    executable = target / "osv-scanner"
    if completed.returncode != 0 or not executable.is_file():
        detail = (completed.stderr or completed.stdout or "unknown installation error").strip()
        return {"installed": False, "detail": f"OSV-Scanner installation failed: {detail[:500]}"}
    executable.chmod(executable.stat().st_mode | 0o111)
    return {"installed": True, "detail": "OSV-Scanner installed in ContextGit tools."}


def _repo_sha(root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return result.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def next_run_at(config: IssueScanConfig, now: datetime | None = None) -> datetime:
    current = now or utcnow()
    zone = ZoneInfo(config.timezone)
    local = current.astimezone(zone)
    # Fixed five-hour wall-clock slots, deliberately away from minute zero.
    base = local.replace(minute=config.schedule_minute, second=0, microsecond=0)
    slots = [base.replace(hour=hour) for hour in (1, 6, 11, 16, 21)]
    future = [slot for slot in slots if slot > local]
    candidate = min(future) if future else (base + timedelta(days=1)).replace(hour=1)
    return candidate.astimezone(UTC)


def _github_repo(root: Path, configured: str | None) -> str | None:
    if configured:
        return configured
    try:
        result = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        remote = result.stdout.strip().removesuffix(".git")
        match = re.search(r"github\.com[:/]([^/]+/[^/]+)$", remote)
        return match.group(1) if match else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _create_github_issues(
    repo: Repo, findings: list[IssueFinding], config: IssueScanConfig
) -> None:
    token = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    target = _github_repo(repo.root, config.github_repository)
    if not token or not target or not config.auto_create:
        return
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    with httpx.Client(base_url="https://api.github.com", headers=headers, timeout=20) as client:
        for finding in findings:
            if (
                _SEVERITY_RANK[finding.severity] < _SEVERITY_RANK[config.minimum_severity]
                or finding.confidence < config.minimum_confidence
            ):
                continue
            if repo.issue_link(finding.fingerprint):
                continue
            marker = f"<!-- contextgit:fingerprint={finding.fingerprint} -->"
            existing = client.get(
                f"/repos/{target}/issues", params={"state": "open", "per_page": 100}
            ).raise_for_status()
            if marker in existing.text:
                continue
            body = (
                f"{marker}\n\n**Location:** `{finding.location or 'repository'}`\n\n"
                f"{finding.why}\n\n**Evidence:** `{finding.evidence}`\n\n"
                f"**Recommended fix:** {finding.fix}\n\n"
                f"Scanner: `{finding.scanner}` · Fingerprint: `{finding.fingerprint}`"
            )
            response = client.post(
                f"/repos/{target}/issues",
                json={
                    "title": f"[{finding.severity}] {finding.title}",
                    "body": body,
                    "labels": ["contextgit", finding.scanner, finding.severity],
                },
            )
            response.raise_for_status()
            created = response.json()
            repo.save_issue_link(
                IssueLink(
                    fingerprint=finding.fingerprint,
                    issue_number=int(created["number"]),
                    issue_url=str(created["html_url"]),
                )
            )


def run_scan(
    repo: Repo, trigger: IssueTrigger = "manual", provider: LLMProvider | None = None
) -> IssueScanRun:
    config = repo.issue_config()
    root = _project_root(repo)
    run = IssueScanRun(
        id=uuid4().hex,
        commit_sha=_repo_sha(root),
        trigger=trigger,
        status="running",
        started_at=utcnow(),
    )
    repo.create_issue_run(run)
    try:
        findings: list[IssueFinding] = []
        if "secrets" in config.scanners:
            secret_findings = _scan_secrets(root, run.id)
            findings.extend(secret_findings)
            run.steps.append(
                {
                    "scanner": "secrets",
                    "status": "done",
                    "detail": f"Checked {len(_files(root))} text files",
                    "findings": len(secret_findings),
                }
            )
        if "dependencies" in config.scanners:
            executable = _osv_executable(repo)
            dependency_findings = _scan_osv(root, run.id)
            findings.extend(dependency_findings)
            run.steps.append(
                {
                    "scanner": "dependencies",
                    "status": "done" if executable else "skipped",
                    "detail": "OSV-Scanner completed"
                    if executable
                    else "OSV-Scanner is not installed",
                    "findings": len(dependency_findings),
                }
            )
        if "quality" in config.scanners:
            quality_findings, quality_detail = _scan_quality(root, run.id)
            findings.extend(quality_findings)
            run.steps.append(
                {
                    "scanner": "quality",
                    "status": "done" if _quality_commands(root) else "skipped",
                    "detail": quality_detail,
                    "findings": len(quality_findings),
                }
            )
        if "review" in config.scanners:
            review_findings = _scan_ai_review(root, run.id, provider)
            findings.extend(review_findings)
            run.steps.append(
                {
                    "scanner": "review",
                    "status": "done" if provider is not None else "skipped",
                    "detail": "AI repository review completed"
                    if provider is not None
                    else "Configure an AI provider to enable repository review",
                    "findings": len(review_findings),
                }
            )
        for finding in findings:
            repo.save_issue_finding(finding)
        counts = {
            severity: sum(1 for item in findings if item.severity == severity)
            for severity in _SEVERITY_RANK
        }
        run.status = "done"
        run.finished_at = utcnow()
        run.counts = counts
        repo.save_issue_run(run)
        _create_github_issues(repo, findings, config)
        return run
    except Exception as exc:
        run.status = "failed"
        run.finished_at = utcnow()
        run.error = str(exc)[:500]
        repo.save_issue_run(run)
        return run


async def start_scheduler(repo: Repo, provider: LLMProvider | None = None) -> None:
    """Run the persisted local scheduler until the API lifespan ends."""
    lock = asyncio.Lock()
    while True:
        config = repo.issue_config()
        if config.enabled:
            if config.next_run_at is None:
                config.next_run_at = next_run_at(config)
                repo.save_issue_config(config)
            if utcnow() >= config.next_run_at and not lock.locked():
                async with lock:
                    await asyncio.to_thread(run_scan, repo, "schedule", provider)
                    config = repo.issue_config()
                    config.next_run_at = next_run_at(config, utcnow())
                    repo.save_issue_config(config)
        await asyncio.sleep(30)
