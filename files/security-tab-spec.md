# Product spec — the "Security" tab (paid)

**Status:** proposal
**Tier:** **Pro** (the flagship paid feature; see `files/monetization-strategy.md` §4)
**Companion:** `files/monetization-strategy.md`, `files/optimization-plan.md`,
`files/codebase-audit.md` (the audit that inspired this feature).

---

## 1. What it is

A **built-in security audit of the user's own project**, run from inside ContextGit. The exact
kind of review this repo just had done to it (`files/codebase-audit.md`) — but as a product
feature, pointed at whatever project the user has open. It covers four scanners:

1. **Secret scanning** — committed keys/tokens/private keys.
2. **Dependency vulnerabilities (SCA)** — CVEs in the project's dependencies.
3. **AI code review for vulnerabilities** — an LLM agent reviews source for injection, path
   traversal, authz gaps, unsafe deserialization, etc.
4. **Live / DAST** — boots the user's app and probes it for exposed routes, missing auth, and
   insecure config.

The report is a prioritized, actionable list (severity + `file:line` + why + suggested fix) —
the same format as `files/codebase-audit.md` — and can be saved, re-run, and gated in CI.

**Why it's the paid wedge:** security is the one benefit a solo dev buys for peace of mind
*and* a company must buy for compliance (see the strategy doc §3). Nobody enjoys buying it;
everybody who has shipped a leaked key wishes they had.

---

## 2. Goals / non-goals

**Goals**
- One click: scan the current project across all four scanners, stream results live.
- Findings are concrete and actionable; never a raw tool dump.
- Reuse existing infrastructure (runner, LLM agents, project walker, server supervisor).
- Safe by construction: no new RCE/unauth surface, never store secret values, DAST only hits
  servers ContextGit itself started.

**Non-goals (v1)**
- Fixing code automatically (a later "auto-fix PR" phase).
- Replacing a full SAST/SCA platform; this is a high-signal, opinionated built-in.
- Scanning remote/third-party hosts (SSRF-safe by design).

---

## 3. Architecture

### 3.1 New package `contextgit/security/`

| Module | Responsibility |
|---|---|
| `models.py` | `Finding`, `Severity`, `ScanRequest`, `ScanReport`, `ScannerKind` (Pydantic) |
| `secrets.py` | Regex/entropy secret detector over text files; **stores only a masked value + sha256** |
| `deps.py` | Runs the ecosystem's auditor (`npm audit --json`, `pip-audit -f json`, `cargo audit --json`) and normalizes CVE output |
| `review.py` | The AI vuln-review agent (LLM); chunks files, asks for strict-JSON findings, validates them |
| `dast.py` | Uses the server supervisor to boot the app and probe routes (auth/CORS/debug), SSRF-guarded |
| `scanners.py` | The four `Scanner` implementations behind one protocol |
| `service.py` | Orchestrator: runs scanners, merges + de-dupes findings, assigns severity, persists the report |
| `store.py` | Persists `<project>/.contextgit/security/<scan_id>.json` + lists history |
| `entitlements.py` | Reads `<userData>/license.json`; `security` feature gate (see §6) |

### 3.2 Reuse map (build on what exists — do not reinvent)

| Need | Reuse |
|---|---|
| Run a bounded command (auditors, git) | `contextgit/verify/runner.py:run_command` — **argv form, no `shell=True`** |
| Detect the project's ecosystem/tooling | `contextgit/verify/detect.py:detect_gate` + `PROBES` |
| Never store a secret value | `contextgit/verify/env.py` precedent: names + `sha256` only (`hash_value`) |
| Walk project files (capped) | `contextgit/endpoints/discover.py:project_files` (`_SKIP_DIRS`, `_MAX_FILES=4000`, `_MAX_BYTES=512KB`) — **loosen the extension filter** for secret scanning |
| LLM adapter selection | `contextgit/llm/registry.py:build_for`; contract `contextgit/llm/base.py` |
| Small agent template | `contextgit/agents/asset_agent.py` (`SYSTEM_PROMPT` / `build_prompt` / strict-JSON parse) |
| Validate model output before trusting it | `contextgit/endpoints/tests.py:validate_source` pattern |
| Boot the user's server | `contextgit/endpoints/serve.py:supervisor()` (+ the `--auth`/loopback rules) |
| Streaming progress (SSE) | `contextgit/api/app.py:research_stream` (`_sse`, `_stream_tokens`, `usage_sink`, `_redact`) |
| Provider info without leaking keys | `contextgit/api/app.py:_redact`, `llm/registry.py:key_hint` |

### 3.3 Endpoint (SSE, streaming)

```python
# contextgit/api/app.py  (beside /api/v1/limits and /api/v1/usage)

@app.post("/api/v1/security/scan")
def security_scan(body: ScanRequest, current: Repo = repo_dep) -> StreamingResponse:
    """Stream a security audit of the project: secrets, deps, AI review, DAST."""
    async def events() -> AsyncIterator[str]:
        try:
            async for event, data in run_scan(body, current, provider=llm):
                yield _sse(event, data)          # step | finding | done
        except Exception as exc:
            yield _sse("error", {"error": _redact(str(exc), secret)})
    return StreamingResponse(events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/api/v1/security/scans", response_model=list[ScanSummary])
def security_scans(current: Repo = repo_dep) -> list[ScanSummary]:
    """Past scans for this project, newest first."""
    return list_scans(current.root)
```

Event shapes: `step` `{label, detail}`, `finding` `{finding}`, `done` `{scan_id, counts}`.

### 3.4 Finding model

```python
class Finding(BaseModel):
    id: str
    scanner: Literal["secrets", "deps", "review", "dast"]
    severity: Literal["critical", "high", "medium", "low"]
    title: str
    location: str | None      # "path:line" or "package@version" or "GET /route"
    evidence: str             # masked/redacted — NEVER the raw secret
    why: str                  # the risk, in plain language
    fix: str                  # concrete remediation
    confidence: float = 1.0
```

### 3.5 The four scanners

1. **Secrets** (`secrets.py`): walk text files (loosen `project_files` to include all
   text-ish extensions, still capped); match provider patterns (AWS/GitHub/OpenAI/Anthropic/
   Stripe/Google keys, `BEGIN … PRIVATE KEY`, `.env`-style assignments) + Shannon-entropy
   heuristic. **Store a masked form (`sk-…AB12`) and a sha256 only** — never the value.
   ~Zero cost, runs first, catches the highest-embarrassment class.
2. **Deps** (`deps.py`): detect manifest/lockfile → run the ecosystem auditor as **argv**
   (`npm audit --json` in the project dir, `pip-audit -f json`, `cargo audit --json`) with a
   bounded timeout; parse CVEs → `Finding(severity from CVSS)`. Degrades gracefully when the
   tool isn't installed (a `message`, never an exception — mirror `limits/`).
3. **AI review** (`review.py`): for each file (ranked by risk: routes/auth/parsers/IO first),
   send a chunk to the configured provider with a strict system prompt (vuln classes + exact
   JSON shape). Parse with fence-stripping, **validate every field** (`severity`, `location`
   within the sent chunk, no invented paths), drop the invalid — the `tests.py:validate_source`
   discipline. Records token usage via `usage_sink` (shows in the Usage tab).
4. **DAST** (`dast.py`): only if a server for this project is running/startable via
   `supervisor()`. Probe the known route set (from `endpoints/discover.py`) for: unauthenticated
   access to sensitive routes, verbose error/stack leakage, permissive CORS, exposed debug
   endpoints, missing security headers. **Hard rule: only the supervisor's own URL** (never a
   user-supplied host) — this is the SSRF gate from the repo's own audit (S11/S12).

### 3.6 Persistence & history

`store.py` writes `<project>/.contextgit/security/<scan_id>.json` (mirrors
`documents/store.py`) and `.gitignore`-aware. The view lists past scans with a severity
summary and a diff between runs ("2 new criticals since last scan") — the sticky, CI-friendly
artifact.

### 3.7 Tests (`tests/test_security.py`, offline)

- secret detector: true positives + false-positive fixtures; asserts the value never appears
  in the output (only masked + hash).
- dep parser: canned `npm audit --json` / `pip-audit` JSON → normalized findings.
- agent: `parse_findings` on valid + malformed + hallucinated-location outputs (drops bad ones).
- orchestrator: merged, de-duped, severity-sorted report; SSE event sequence.
- DAST: never targets a non-supervisor host (assert).
Precedent: `tests/test_limits.py` (MockTransport, no network).

---

## 4. Desktop (SecurityView)

New top-level tab, wired exactly like the existing ones (verified against the current tree):

| File | Change |
|---|---|
| `desktop/src/shell/TopNav.tsx` | add `"security"` to `TabId` (lines 3-16) |
| `desktop/src/shell/Shell.tsx` | `TAB_IDS` (102), `tabs[]` (1003), `rail()` (1077), `view()` (1211), `bottomBar()` (1730, return `null`) |
| `desktop/src/shell/views/SecurityView.tsx` | **new** — toolbar ("Run scan"), scanner toggles, findings list, severity filter, past-scans rail |
| `desktop/src/shell/rail/SecurityRail.tsx` | **new** — scanners + scan history |
| `desktop/src/shell/security/useSecurity.ts` | **new** — `streamSecurityScan()` consumer + `api.securityScans()` |
| `lib/api.ts` | **add** types + `securityScan`/`securityScans` — **note:** this file is being edited by the user right now; coordinate before touching it |

Reuse `.cg-view-toolbar` / `.cg-view-body` / `.cg-row` / `Chip` (`data-tone="bad"|warn`) /
`Field` / `.cg-pane-error`. Findings render severity-chipped rows with location, `why`, and a
copyable `fix`.

**Locked state:** when the `security` feature isn't entitled, the tab renders a blurred
preview + "Run a free sample scan on one file" → then "Audit the whole repo with Pro."

---

## 5. Safety & security (this feature must not add risk)

- **No shell:** auditors and git run as argv lists via `run_command`-style calls, never
  `shell=True` (the repo's own audit flags S2/S3 for exactly this).
- **Secrets never leave the machine and are never stored in the clear** (masked + sha256).
- **DAST is scoped to the supervisor's own URL** — no arbitrary-host requests (guards SSRF,
  audit S11/S12).
- **The AI review sends code to the user's chosen provider** — surfaced in the UI before the
  scan; local/mock providers supported.
- **The API must be authenticated first.** Today the loopback API has *no* auth
  (`files/codebase-audit.md` S1, CRITICAL). Selling a security feature on top of an
  unauthenticated control plane is indefensible — **ship the per-launch token fix (S1) before
  this tab exposes any scan endpoint.**

---

## 6. The entitlement seam (described, not built)

No license/tier/flag concept exists in the repo today — this is the first one.

```
# <userData>/license.json      (absent → free)
{ "tier": "pro", "expires_at": "2027-10-07", "features": ["security", "cloud-sync"] }
```

- `contextgit/security/entitlements.py` reads it; the API exposes `entitled: bool` on the
  scan endpoint (403 when not).
- The desktop renders the tab locked/unlocked from a single `features` check in `Shell.tsx`.
- **Keep the check server-side**, not just a UI hide — a locked tab with an open endpoint is
  theatre.
- Cloud tiers (sync/cloud agents) are the only parts that need a real server; the security
  feature can work **fully offline** once entitled, which keeps it consistent with the
  local-first promise.

---

## 7. Roadmap

1. **v1** — secrets + deps + AI review, read-only results, persisted history. (Highest value,
   no server dependency.)
2. **v2** — DAST against the supervisor's app; CI gate (exit non-zero on critical findings in
   the project's own gate command, tie into `verify/runner.py`).
3. **v3** — auto-fix suggestions → one-click PR; org policy/severity thresholds; scheduled
   scans (reuses the Agent-routines direction).
4. **Monetization tie-in** — the CI gate and org policy are natural Team/Enterprise upsells
   (see `files/monetization-strategy.md` §4).

---

## 8. Verification

- Tab wiring matches `TopNav.tsx:3-16` and `Shell.tsx:102/1003/1077/1211/1730`.
- Building blocks exist as cited: `verify/runner.py:run_command`, `verify/env.py:hash_value`,
  `agents/asset_agent.py` (`SYSTEM_PROMPT`/`build_prompt`/parse), `endpoints/discover.py:
  project_files`, `endpoints/serve.py:supervisor`, `api/app.py:_sse`/`_stream_tokens`.
- No new `shell=True`; no raw secret stored; DAST host is the supervisor URL only.
- `git status` shows no app-code changes from this task (spec only).
