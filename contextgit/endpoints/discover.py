"""Find the HTTP endpoints of a project without running it.

Discovery is heuristic by nature, so every finding carries a source and a
confidence. In order of trust: a project's OpenAPI document (authoritative, and
in a later phase the *live* server's), Python (parsed with the standard AST),
then JS/TS and Go (pattern-matched).
"""

from __future__ import annotations

import ast
import importlib
import json
import re
from pathlib import Path

from contextgit.core.models import (
    Endpoint,
    EndpointField,
    EndpointGraph,
    EndpointSource,
)

_SKIP_DIRS = {
    ".git",
    ".hg",
    ".contextgit",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".next",
    ".nuxt",
    "coverage",
    "dist",
    "build",
    "target",
    "vendor",
    "node_modules",
}
_MAX_FILES = 4000
_MAX_BYTES = 512 * 1024
_PY_EXT = {".py"}
_WEB_EXT = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"}
_GO_EXT = {".go"}

# HTTP verbs as they appear in FastAPI/Flask decorators.
_VERBS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
# Objects that look like a router in JS/TS (keeps us off axios/fetch clients).
_ROUTER_OBJECTS = {"app", "router", "server", "api", "fastify", "route", "routes", "apiRouter"}

_JS_ROUTE = re.compile(
    r"\b(?P<obj>[A-Za-z_$][\w$]*)\s*\.\s*(?P<method>get|post|put|patch|delete|head|options|all)"
    r"\s*\(\s*(?P<quote>['\"`])(?P<path>[^'\"`]*)(?P=quote)",
)
_NEST_DECORATOR = re.compile(
    r"@(?P<method>Get|Post|Put|Patch|Delete|Head|Options|All)"
    r"\s*\(\s*(?:['\"`](?P<path>[^'\"`]*)['\"`])?",
)
_GO_ROUTE = re.compile(
    r"\.(?P<method>GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|HandleFunc|Handle)"
    r"\s*\(\s*\"(?P<path>[^\"]+)\"",
)
_DJANGO_CONVERTER = re.compile(r"<(?:[A-Za-z_]\w*:)?(?P<name>\w+)>")


def _canonical(path: str) -> str:
    """One spelling per endpoint: `:id`, `<int:id>` and `{id}` all become `{id}`."""
    path = _DJANGO_CONVERTER.sub(r"{\g<name>}", path)
    path = re.sub(r":(?P<name>[A-Za-z_]\w*)", r"{\g<name>}", path)
    if not path.startswith("/"):
        path = "/" + path
    return path


def _endpoint_id(method: str, path: str) -> str:
    return f"{method.lower()} {path}" if path else method.lower()


def _join_path(prefix: str, path: str) -> str:
    """Join a router prefix with an operation path without doubling slashes."""
    if not prefix:
        return path or "/"
    if not path:
        return prefix
    return f"{prefix.rstrip('/')}/{path.lstrip('/')}"


# --------------------------------------------------------------- OpenAPI --


def load_openapi(project: Path) -> dict[str, object] | None:
    """Read a static OpenAPI document from the project, if it ships one."""
    for name in (
        "openapi.json",
        "docs/openapi.json",
        "public/openapi.json",
        "openapi.yaml",
        "openapi.yml",
    ):
        candidate = project / name
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text("utf-8", errors="replace")
            if name.endswith((".yaml", ".yml")):
                yaml = importlib.import_module("yaml")  # noqa: PLC0415
                loaded = yaml.safe_load(text)
            else:
                loaded = json.loads(text)
        except Exception:
            continue
        if isinstance(loaded, dict) and isinstance(loaded.get("paths"), dict):
            return loaded
    return None


def _spec_fields(operation: dict[str, object]) -> list[EndpointField]:
    fields: list[EndpointField] = []
    parameters = operation.get("parameters")
    for raw in parameters if isinstance(parameters, list) else []:
        if not isinstance(raw, dict):
            continue
        location = str(raw.get("in", "query"))
        if location not in {"path", "query", "header", "cookie", "body"}:
            continue
        raw_schema = raw.get("schema")
        schema: dict[str, object] = raw_schema if isinstance(raw_schema, dict) else {}
        found_type = schema.get("type")
        fields.append(
            EndpointField(
                name=str(raw.get("name", "")),
                location=location,  # type: ignore[arg-type]
                type=str(found_type) if found_type else None,
                required=bool(raw.get("required", False)),
            )
        )
    body = operation.get("requestBody")
    if isinstance(body, dict):
        fields.append(
            EndpointField(
                name="body",
                location="body",
                type="object",
                required=bool(body.get("required", False)),
            )
        )
    return fields


def from_openapi(spec: dict[str, object], source_file: str | None = None) -> list[Endpoint]:
    """Build endpoints from an OpenAPI document."""
    found: list[Endpoint] = []
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return found
    for raw_path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method in _VERBS:
            operation = item.get(method)
            if not isinstance(operation, dict):
                continue
            tags = [str(tag) for tag in operation.get("tags", []) or []]
            responses = operation.get("responses")
            status: int | None = None
            if isinstance(responses, dict):
                for code in responses:
                    try:
                        status = int(str(code))
                        break
                    except ValueError:
                        continue
            summary = operation.get("summary") or operation.get("operationId")
            found.append(
                Endpoint(
                    id=_endpoint_id(method, _canonical(str(raw_path))),
                    method=method.upper(),
                    path=_canonical(str(raw_path)),
                    operation=str(summary) if summary else None,
                    tags=tags,
                    auth=bool(operation.get("security")),
                    request_fields=_spec_fields(operation),
                    response_status=status,
                    source=EndpointSource(kind="openapi", file=source_file, confidence="high"),
                )
            )
    return found


# ---------------------------------------------------------------- Python --


class _PythonVisitor(ast.NodeVisitor):
    """Collect decorated route handlers, plus the BaseModel names in the file."""

    def __init__(self, relative: str) -> None:
        self.relative = relative
        self.models: set[str] = set()
        self.found: list[Endpoint] = []
        self.prefixes: dict[str, str] = {}

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for base in node.bases:
            name = base.id if isinstance(base, ast.Name) else getattr(base, "attr", "")
            if name in {"BaseModel", "Schema", "Model"}:
                self.models.add(node.name)

    def visit_Assign(self, node: ast.Assign) -> None:
        # `router = APIRouter(prefix="/items")`, `app = FastAPI()` — remember prefixes.
        value = node.value
        if not isinstance(value, ast.Call):
            return
        func = value.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
        if name not in {"APIRouter", "Blueprint", "FastAPI", "Flask", "Router"}:
            return
        prefix = ""
        for keyword in value.keywords:
            if keyword.arg in {"prefix", "url_prefix"} and isinstance(keyword.value, ast.Constant):
                prefix = str(keyword.value.value or "")
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.prefixes[target.id] = prefix

    def _endpoint(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
        path: str,
        method: str,
        decorator: ast.Call,
        dynamic: bool,
    ) -> None:
        status: int | None = None
        auth = False
        for keyword in decorator.keywords:
            if keyword.arg == "status_code" and isinstance(keyword.value, ast.Constant):
                status = int(keyword.value.value) if isinstance(keyword.value.value, int) else None
            if keyword.arg == "dependencies":
                auth = True
        canonical = _canonical(path)
        self.found.append(
            Endpoint(
                id=_endpoint_id(method, canonical),
                method=method.upper(),
                path=canonical,
                operation=node.name.replace("_", " "),
                auth=auth,
                request_fields=self._fields(node, canonical),
                response_status=status,
                source=EndpointSource(
                    kind="python",
                    file=self.relative,
                    line=decorator.lineno,
                    confidence="low" if dynamic else "high",
                ),
            )
        )

    def _fields(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef, path: str
    ) -> list[EndpointField]:
        placeholders = set(re.findall(r"{(\w+)}", path))
        fields: list[EndpointField] = []
        positional = [*node.args.posonlyargs, *node.args.args]
        defaults: list[ast.expr | None] = [None] * (len(positional) - len(node.args.defaults))
        defaults.extend(node.args.defaults)
        pairs: list[tuple[ast.arg, ast.expr | None]]
        pairs = list(zip(positional, defaults, strict=False))
        pairs.extend(zip(node.args.kwonlyargs, node.args.kw_defaults, strict=False))
        for arg, default in pairs:
            if arg.arg in {"self", "cls", "request", "response", "db", "session"}:
                continue
            annotation = ast.unparse(arg.annotation) if arg.annotation else None
            if arg.arg in placeholders:
                location = "path"
            elif annotation and any(model in annotation for model in self.models):
                location = "body"
            else:
                location = "query"
            fields.append(
                EndpointField(
                    name=arg.arg,
                    location=location,  # type: ignore[arg-type]
                    type=annotation,
                    required=default is None,
                )
            )
        return fields

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            func = decorator.func
            attribute = (
                func.attr
                if isinstance(func, ast.Attribute)
                else func.id
                if isinstance(func, ast.Name)
                else ""
            )
            attribute = attribute.lower()
            if attribute not in _VERBS and attribute != "route":
                continue
            literal: str | None = None
            dynamic = False
            for arg in decorator.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    literal = arg.value
                    break
                if isinstance(arg, ast.JoinedStr):
                    dynamic = True
                    for part in arg.values:
                        if isinstance(part, ast.Constant) and isinstance(part.value, str):
                            literal = (literal or "") + part.value
            if literal is None:
                continue
            owner = (
                func.value.id
                if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)
                else ""
            )
            path = _join_path(self.prefixes.get(owner, ""), literal)
            if attribute == "route":
                methods: list[str] = []
                for keyword in decorator.keywords:
                    if keyword.arg == "methods" and isinstance(
                        keyword.value, (ast.List, ast.Tuple)
                    ):
                        methods = [
                            str(item.value).lower()
                            for item in keyword.value.elts
                            if isinstance(item, ast.Constant) and isinstance(item.value, str)
                        ]
                for method in methods or ["get"]:
                    self._endpoint(node, path, method, decorator, dynamic)
            else:
                self._endpoint(node, path, attribute, decorator, dynamic)


def _scan_python(project: Path, files: list[Path]) -> list[Endpoint]:
    found: list[Endpoint] = []
    for path in files:
        if path.suffix not in _PY_EXT:
            continue
        try:
            tree = ast.parse(path.read_text("utf-8", errors="replace"))
        except (SyntaxError, ValueError, OSError):
            continue
        visitor = _PythonVisitor(str(path.relative_to(project)))
        visitor.visit(tree)
        found.extend(visitor.found)
    return found


def _scan_django(project: Path, files: list[Path]) -> list[Endpoint]:
    """`urls.py` route tables: path("items/<int:pk>/", view)."""
    found: list[Endpoint] = []
    for path in files:
        if path.suffix not in _PY_EXT or path.name != "urls.py":
            continue
        try:
            tree = ast.parse(path.read_text("utf-8", errors="replace"))
        except (SyntaxError, ValueError, OSError):
            continue
        relative = str(path.relative_to(project))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if name not in {"path", "re_path"} or not node.args:
                continue
            first = node.args[0]
            literal = first.value if isinstance(first, ast.Constant) else None
            if not isinstance(literal, str):
                continue
            canonical = _canonical(literal)
            found.append(
                Endpoint(
                    id=_endpoint_id("get", canonical),
                    method="GET",
                    path=canonical,
                    operation=relative,
                    source=EndpointSource(
                        kind="django",
                        file=relative,
                        line=node.lineno,
                        confidence="medium",
                    ),
                )
            )
    return found


# ------------------------------------------------------------ JS / TS / Go --


def _scan_web(project: Path, files: list[Path]) -> list[Endpoint]:
    found: list[Endpoint] = []
    for path in files:
        if path.suffix not in _WEB_EXT:
            continue
        try:
            source = path.read_text("utf-8", errors="replace")
        except OSError:
            continue
        relative = str(path.relative_to(project))
        for match, line in _regex_hits(_JS_ROUTE, source):
            if match.group("obj") not in _ROUTER_OBJECTS:
                continue
            raw = match.group("path")
            if not raw.startswith("/"):
                continue
            dynamic = "${" in raw
            canonical = _canonical(raw)
            found.append(
                Endpoint(
                    id=_endpoint_id(match.group("method"), canonical),
                    method=match.group("method").upper(),
                    path=canonical,
                    source=EndpointSource(
                        kind="javascript",
                        file=relative,
                        line=line,
                        confidence="low" if dynamic else "medium",
                    ),
                )
            )
        for match, line in _regex_hits(_NEST_DECORATOR, source):
            raw = match.group("path") or "/"
            canonical = _canonical(raw)
            found.append(
                Endpoint(
                    id=_endpoint_id(match.group("method"), canonical),
                    method=match.group("method").upper(),
                    path=canonical,
                    source=EndpointSource(
                        kind="javascript",
                        file=relative,
                        line=line,
                        confidence="medium",
                    ),
                )
            )
    return found


def _scan_go(project: Path, files: list[Path]) -> list[Endpoint]:
    found: list[Endpoint] = []
    for path in files:
        if path.suffix not in _GO_EXT:
            continue
        try:
            source = path.read_text("utf-8", errors="replace")
        except OSError:
            continue
        relative = str(path.relative_to(project))
        for match, line in _regex_hits(_GO_ROUTE, source):
            raw = match.group("path")
            method = match.group("method")
            if method in {"HandleFunc", "Handle"}:
                # Go 1.22 allows "GET /path"; otherwise it is method-agnostic.
                if raw.split(" ", 1)[0].isupper() and " " in raw:
                    method, raw = raw.split(" ", 1)
                else:
                    method = "GET"
            if not raw.startswith("/"):
                continue
            canonical = _canonical(raw)
            found.append(
                Endpoint(
                    id=_endpoint_id(method, canonical),
                    method=method.upper(),
                    path=canonical,
                    source=EndpointSource(
                        kind="go",
                        file=relative,
                        line=line,
                        confidence="medium",
                    ),
                )
            )
    return found


def _regex_hits(pattern: re.Pattern[str], source: str) -> list[tuple[re.Match[str], int]]:
    """Matches with their 1-indexed line numbers."""
    hits: list[tuple[re.Match[str], int]] = []
    for match in pattern.finditer(source):
        line = source.count("\n", 0, match.start()) + 1
        hits.append((match, line))
    return hits


# ------------------------------------------------------------------ walk --


def project_files(project: Path) -> list[Path]:
    """Source files worth scanning, skipping build output and dependencies."""
    files: list[Path] = []
    for path in sorted(project.rglob("*")):
        if len(files) >= _MAX_FILES:
            break
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in _SKIP_DIRS for part in path.relative_to(project).parts):
            continue
        if path.suffix not in _PY_EXT | _WEB_EXT | _GO_EXT:
            continue
        try:
            if path.stat().st_size > _MAX_BYTES:
                continue
        except OSError:
            continue
        files.append(path)
    return files


_RANK: dict[str, int] = {
    "openapi": 4,
    "python": 3,
    "django": 2,
    "javascript": 2,
    "go": 2,
    "manual": 1,
}
_CONFIDENCE_RANK = {"high": 3, "medium": 2, "low": 1}


def _merge(found: list[Endpoint]) -> list[Endpoint]:
    """One endpoint per (method, path); the best source wins, locations survive."""
    best: dict[tuple[str, str], Endpoint] = {}
    for endpoint in found:
        key = (endpoint.method, endpoint.path)
        current = best.get(key)
        if current is None:
            best[key] = endpoint
            continue
        current_rank = (
            _CONFIDENCE_RANK[current.source.confidence],
            _RANK.get(current.source.kind, 0),
        )
        new_rank = (
            _CONFIDENCE_RANK[endpoint.source.confidence],
            _RANK.get(endpoint.source.kind, 0),
        )
        winner, loser = (endpoint, current) if new_rank > current_rank else (current, endpoint)
        # A spec knows the contract but not where the handler lives, so keep the
        # code location even when the spec wins.
        if winner.source.file is None and loser.source.file is not None:
            winner.source.file = loser.source.file
            winner.source.line = loser.source.line
        if winner.operation is None:
            winner.operation = loser.operation
        if not winner.tags:
            winner.tags = loser.tags
        if not winner.request_fields:
            winner.request_fields = loser.request_fields
        if winner.response_status is None:
            winner.response_status = loser.response_status
        if not winner.auth:
            winner.auth = loser.auth
        best[key] = winner
    return sorted(best.values(), key=lambda item: (item.path, item.method))


def discover(project: Path | str, *, openapi: dict[str, object] | None = None) -> EndpointGraph:
    """Scan a project and return every endpoint we can find."""
    root = Path(project)
    files = project_files(root)
    found: list[Endpoint] = []
    spec = openapi if openapi is not None else load_openapi(root)
    if spec is not None:
        # A spec is not a code location: leaving `file` empty lets the scan's
        # handler location survive the merge below.
        found.extend(from_openapi(spec))
    found.extend(_scan_python(root, files))
    found.extend(_scan_django(root, files))
    found.extend(_scan_web(root, files))
    found.extend(_scan_go(root, files))
    endpoints = _merge(found)
    return EndpointGraph(
        project_path=str(root),
        scanned_files=len(files),
        endpoints=endpoints,
    )
