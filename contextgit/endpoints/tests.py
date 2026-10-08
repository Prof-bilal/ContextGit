"""Generate, save and run real API tests for a project's endpoints.

Generated tests are ordinary pytest files in `tests/api/` hitting the running
server at `$API_BASE_URL`, so they keep working in CI without ContextGit. The
per-file status lives in a local manifest under `.contextgit/endpoints/`
(gitignored) — the files are the source of truth, the manifest is a cache.
"""

from __future__ import annotations

import os
import re
import shlex
import sys
from pathlib import Path

from contextgit.core.errors import ProviderConfigError
from contextgit.core.models import (
    Endpoint,
    EndpointTestFile,
    EndpointTestSuite,
    Message,
    utcnow,
)
from contextgit.endpoints.provenance import blame_span
from contextgit.gitops.repo import Git
from contextgit.llm.base import LLMProvider
from contextgit.verify.runner import run_command

MANIFEST = Path(".contextgit") / "endpoints" / "suite.json"
TEST_DIR = Path("tests") / "api"
MAX_SOURCE_EXCERPT = 60

# A generated file must never guess where the service is: testing against a
# stranger's server on a fixed port is worse than not testing at all.
BASE_URL_HELP = (
    "BASE_URL = os.environ.get(\"API_BASE_URL\", \"\").rstrip(\"/\")\n"
    "if not BASE_URL:\n"
    "    raise RuntimeError(\n"
    "        \"API_BASE_URL is not set — start the server from the ContextGit \"\n"
    "        \"Endpoints tab, or export API_BASE_URL yourself.\"\n"
    "    )\n"
)

SYSTEM_PROMPT = (
    "You write pytest tests for an existing HTTP service. Reply with Python "
    "source only — no prose, no markdown fences. Requirements: use httpx and "
    'pytest; read the base URL from os.environ["API_BASE_URL"] and never fall '
    "back to a hard-coded host or port — if it is missing the file must raise a "
    "clear error; every test function name starts with test_; each test asserts "
    "the status code and something about the body; only assert exact values that "
    "the handler source actually shows, otherwise assert shape and content type; "
    "cover the happy path plus invalid input, and auth failures and boundary "
    "values where they apply; never start a server, never import subprocess, "
    "shutil or socket, and never write to the filesystem. The file must run "
    "as-is with `pytest`."
)

_FENCE = re.compile(r"```(?:[a-zA-Z]+)?\s*([\s\S]*?)```")
_TEST_FUNC = re.compile(r"^def (test_\w+)", re.MULTILINE)
_OUTCOME = re.compile(
    r"^(?P<file>[\w./\\-]+\.py)::(?P<name>[\w\[\]\-]+)\s+"
    r"(?P<outcome>PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)"
)
_FORBIDDEN = ("subprocess", "os.system", "shutil", "socket", "eval(", "exec(", "__import__")
# A test that hard-codes a host can silently point at someone else's service.
_HARDCODED_HOSTS = ("127.0.0.1", "localhost", "0.0.0.0")


def slug_for(endpoint: Endpoint) -> str:
    """A filesystem-safe name for one endpoint's test file."""
    raw = f"{endpoint.method.lower()}_{endpoint.path.strip('/') or 'root'}"
    slug = re.sub(r"[^a-z0-9]+", "_", raw.lower()).strip("_")
    return slug[:60] or "endpoint"


def test_path_for(endpoint: Endpoint) -> str:
    """Where this endpoint's test file lives, relative to the project."""
    return str(TEST_DIR / f"test_{slug_for(endpoint)}.py")


def handler_excerpt(project: Path, endpoint: Endpoint) -> str:
    """The handler's source, so the model sees the real contract."""
    source = endpoint.source
    if not source.file or source.line is None:
        return "(handler source not available)"
    path = project / source.file
    try:
        lines = path.read_text("utf-8", errors="replace").splitlines()
    except OSError:
        return "(handler source not available)"
    start = max(0, source.line - 1 - 10)
    end = min(len(lines), source.line + MAX_SOURCE_EXCERPT)
    body = "\n".join(lines[start:end])
    return f"{source.file}:{source.line}\n{body}"


def style_sample(project: Path) -> str | None:
    """An existing test file, so generated tests match the project's style."""
    for path in sorted((project / "tests").rglob("test_*.py")):
        if TEST_DIR in path.parents or "api" in path.parts:
            continue
        try:
            text = path.read_text("utf-8", errors="replace")
        except OSError:
            continue
        if "def test_" in text:
            return text[:2000]
    return None


def build_prompt(
    project: Path, endpoint: Endpoint, base_url: str | None, style: str | None
) -> str:
    """The user message: the contract, the handler, and the house style."""
    fields = "\n".join(
        f"- {field.name} ({field.location}, {field.type or 'untyped'},"
        f" {'required' if field.required else 'optional'})"
        for field in endpoint.request_fields
    )
    parts = [
        f"Endpoint: {endpoint.method} {endpoint.path}",
        "Base URL: always read it from the API_BASE_URL environment variable "
        + (f"(it is {base_url} while we validate)" if base_url else "(this run has no server)"),
        f"Authentication required: {'yes' if endpoint.auth else 'no'}",
        f"Success status: {endpoint.response_status or 200}",
        f"Operation: {endpoint.operation or '(unnamed)'}",
    ]
    if endpoint.tags:
        parts.append(f"Tags: {', '.join(endpoint.tags)}")
    parts.append(f"Inputs:\n{fields or '(none detected)'}")
    if endpoint.provenance and endpoint.provenance.summary:
        parts.append(
            "Why this endpoint exists (from the change that introduced it): "
            f"{endpoint.provenance.summary}"
        )
    parts.append(f"Handler source:\n```python\n{handler_excerpt(project, endpoint)}\n```")
    if style:
        parts.append(f"Match this house style:\n```python\n{style}\n```")
    parts.append("Write the test file now.")
    return "\n\n".join(parts)


def _strip_fences(text: str) -> str:
    match = _FENCE.search(text)
    return (match.group(1) if match else text).strip()


def validate_source(source: str) -> str:
    """Reject a generated file we will not run, or return it unchanged."""
    if not _TEST_FUNC.search(source):
        raise ProviderConfigError("the model did not return any test functions")
    if "assert" not in source:
        raise ProviderConfigError("the generated tests do not assert anything")
    if "httpx" not in source:
        raise ProviderConfigError("the generated tests do not use httpx")
    if "API_BASE_URL" not in source:
        raise ProviderConfigError("the generated tests do not read API_BASE_URL")
    lowered = source.lower()
    for host in _HARDCODED_HOSTS:
        if host in lowered:
            raise ProviderConfigError(
                f"the generated tests hard-code {host!r} instead of API_BASE_URL"
            )
    for token in _FORBIDDEN:
        if token in lowered:
            raise ProviderConfigError(f"the generated tests use {token!r}, which is not allowed")
    if len(source.encode()) > 64 * 1024:
        raise ProviderConfigError("the generated test file is too large")
    return source


def header(endpoint: Endpoint) -> str:
    return (
        f"# Generated by ContextGit for {endpoint.method} {endpoint.path}.\n"
        "# Edit freely — regenerating replaces this file.\n"
        "# Run it with API_BASE_URL set to the running server, e.g.\n"
        "#   API_BASE_URL=http://127.0.0.1:PORT pytest tests/api\n\n"
    )


def _write_source(
    project: Path, endpoint: Endpoint, source: str, relative: str
) -> EndpointTestFile:
    target = project / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(header(endpoint) + source + "\n", "utf-8")
    source_info = endpoint.source
    handler = (
        f"{source_info.file}:{source_info.line}"
        if source_info.file and source_info.line is not None
        else source_info.file
    )
    return EndpointTestFile(
        endpoint_id=endpoint.id,
        file=relative,
        handler=handler,
        tests=_TEST_FUNC.findall(source),
    )


def _complete(adapter: LLMProvider, messages: list[Message], model: str) -> str:
    try:
        return str(adapter.complete(messages, model=model, temperature=0))
    except Exception as exc:
        raise ProviderConfigError(str(exc)) from exc


def _run_file(
    project: Path, relative: str, base_url: str, timeout: float = 180.0
) -> tuple[bool, str]:
    """Run one generated file; (passed, output)."""
    result = run_command(
        f"{sys.executable} -m pytest {relative} -q --tb=short -p no:cacheprovider",
        project,
        env={**os.environ, "API_BASE_URL": base_url},
        timeout=timeout,
    )
    return result.ok, result.output


def generate_for_endpoint(
    project: Path | str,
    endpoint: Endpoint,
    *,
    adapter: LLMProvider,
    model: str,
    base_url: str | None = None,
    validate: bool = True,
) -> tuple[EndpointTestFile, bool, str | None]:
    """Write this endpoint's tests, run them, repair once, and record the result.

    Returns (entry, overwrote an existing file, remaining failure output).
    Validation only happens when asked for, because it needs the server up.
    """
    entry, overwrote, failure = _generate(
        project,
        endpoint,
        adapter=adapter,
        model=model,
        base_url=base_url,
        validate=validate,
    )
    TestStore(project).upsert(entry)
    return entry, overwrote, failure


def _generate(
    project: Path | str,
    endpoint: Endpoint,
    *,
    adapter: LLMProvider,
    model: str,
    base_url: str | None = None,
    validate: bool = True,
) -> tuple[EndpointTestFile, bool, str | None]:
    root = Path(project)
    relative = test_path_for(endpoint)
    overwrote = (root / relative).exists()
    messages = [
        Message(role="system", content=SYSTEM_PROMPT),
        Message(role="user", content=build_prompt(root, endpoint, base_url, style_sample(root))),
    ]

    entry: EndpointTestFile | None = None
    output = ""
    # Without a real server URL there is nothing honest to validate against.
    validating = validate and bool(base_url)
    for attempt in range(2):
        source = validate_source(_strip_fences(_complete(adapter, messages, model)))
        entry = _write_source(root, endpoint, source, relative)
        if not validating:
            return entry, overwrote, None
        passed, output = _run_file(root, relative, base_url or "")
        if passed:
            entry.status = "pass"
            entry.ran_at = utcnow()
            entry.verified_at_commit = handler_commit(root, endpoint)
            return entry, overwrote, None
        if attempt == 0:
            messages = [
                *messages,
                Message(role="assistant", content=source),
                Message(
                    role="user",
                    content=(
                        "Those tests failed against the running server:\n\n"
                        f"{output[-1800:]}\n\n"
                        "Fix them and reply with the corrected file only."
                    ),
                ),
            ]

    assert entry is not None
    entry.status = "fail"
    entry.detail = output[-1800:]
    entry.ran_at = utcnow()
    entry.verified_at_commit = handler_commit(root, endpoint)
    return entry, overwrote, output[-1800:]


def head_commit(project: Path) -> str | None:
    """The project's current commit, for recording what a run verified."""
    git = Git(project)
    if not git.is_repo():
        return None
    result = git.run("rev-parse", "HEAD", check=False)
    commit = result.stdout.strip()
    return commit or None


def handler_commit(project: Path, endpoint: Endpoint) -> str | None:
    """The commit behind the handler line — what a test verified against.

    Recording the *handler's* commit (not the repo HEAD) is what lets Phase C tell
    "this endpoint changed under my test" from "unrelated commits happened".
    """
    source = endpoint.source
    if source.file and source.line is not None:
        found = blame_span(
            project, source.file, source.line, source.line_end or source.line
        )
        if found:
            return found
    return head_commit(project)


class TestStore:
    """Read/write the local manifest of generated tests."""

    def __init__(self, project: Path | str) -> None:
        self._path = Path(project) / MANIFEST

    def load(self) -> EndpointTestSuite:
        project = self._path.parents[2]
        if not self._path.exists():
            return EndpointTestSuite(project_path=str(project))
        try:
            return EndpointTestSuite.model_validate_json(self._path.read_text("utf-8"))
        except ValueError:
            return EndpointTestSuite(project_path=str(project))

    def save(self, suite: EndpointTestSuite) -> EndpointTestSuite:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(suite.model_dump_json(indent=2) + "\n", "utf-8")
        return suite

    def upsert(self, entry: EndpointTestFile) -> EndpointTestSuite:
        suite = self.load()
        others = [item for item in suite.files if item.endpoint_id != entry.endpoint_id]
        suite.files = [*others, entry]
        return self.save(suite)


def discover_test_files(project: Path) -> list[str]:
    """Generated test files present in the project, relative paths."""
    directory = project / TEST_DIR
    if not directory.is_dir():
        return []
    return sorted(str(path.relative_to(project)) for path in directory.glob("test_*.py"))


def run_suite(project: Path | str, base_url: str, *, timeout: float = 300.0) -> EndpointTestSuite:
    """Run the project's generated API tests and record the outcome."""
    root = Path(project)
    files = discover_test_files(root)
    store = TestStore(root)
    suite = store.load()
    suite.project_path = str(root)
    if not files:
        suite.output = "No generated tests yet."
        return store.save(suite)

    command = shlex.join(
        [sys.executable, "-m", "pytest", *files, "-v", "--tb=short", "-p", "no:cacheprovider"]
    )
    result = run_command(
        command,
        root,
        env={**os.environ, "API_BASE_URL": base_url},
        timeout=timeout,
    )

    outcomes: dict[str, list[tuple[str, str]]] = {}
    for line in result.output.splitlines():
        match = _OUTCOME.match(line.strip())
        if match:
            outcomes.setdefault(match.group("file").replace("\\", "/"), []).append(
                (match.group("name"), match.group("outcome"))
            )

    commit = head_commit(root)
    entries: list[EndpointTestFile] = []
    passed = failed = 0
    for relative in files:
        names = outcomes.get(relative, [])
        good = [name for name, outcome in names if outcome == "PASSED"]
        bad = [name for name, outcome in names if outcome not in {"PASSED", "SKIPPED"}]
        passed += len(good)
        failed += len(bad)
        known = next((item for item in suite.files if item.file == relative), None)
        entries.append(
            EndpointTestFile(
                endpoint_id=known.endpoint_id if known else "",
                file=relative,
                tests=[name for name, _ in names] or (known.tests if known else []),
                status="pass" if names and not bad else ("fail" if names else "untested"),
                detail="\n".join(
                    line
                    for line in result.output.splitlines()
                    if any(name in line for name, outcome in names if outcome != "PASSED")
                )[:2000]
                or None,
                ran_at=utcnow(),
                verified_at_commit=commit,
            )
        )
    suite.files = entries
    suite.passed = passed
    suite.failed = failed
    suite.output = result.output[-4000:]
    return store.save(suite)


def remembered(project: Path | str) -> EndpointTestSuite:
    """The manifest as-is, plus any test files that were added outside the app."""
    suite = TestStore(project).load()
    known = {item.file for item in suite.files}
    for relative in discover_test_files(Path(project)):
        if relative not in known:
            suite.files.append(EndpointTestFile(endpoint_id="", file=relative))
    return suite
