# CLI harness usage limits

The Code tab shows **Usage & limits** for every registered CLI. Account windows
appear only when reported by the provider. Other CLIs show session tokens, cost,
local project totals, or an explicit unavailable state. Token counts are never
converted into invented account quota percentages.

## Where the numbers come from

The existing backend adapters use the login each CLI already stored:

| Harness | Host | Auth | Endpoints |
|---|---|---|---|
| **Command Code** (`commandcode`) | `https://api.commandcode.ai` | `~/.commandcode/auth.json` (`apiKey`) | `/alpha/billing/credits` (5-hour + weekly windows, credits), `/alpha/usage/summary` (period totals), `/alpha/billing/subscriptions` (plan) |
| **Cline** (`cline`) | `https://api.cline.bot` | `~/.cline/data/settings/providers.json` (OAuth `accessToken`) | `/api/v1/users/me/plan`, `/api/v1/users/active-account` |
| **Freebuff** (`freebuff`) | `https://www.codebuff.com` | **OS keychain** (`service freebuff-cli`, via `secret-tool` on Linux / `security` on macOS) | `/api/v1/freebuff/session` (Freebucks balance) |

Freebuff pays for models in **Freebucks**: a daily allowance (`daily.limit` /
`spent` / `remaining`, refreshed on `resetAt`) plus a wallet (`wallet.balance`).
Its auth token is not on disk — the CLI keeps it in the OS keychain, so the
adapter reads it there before making the same read-only call.

Command Code reports credit-denominated windows (`fiveHour`/`weekly` with
`used`/`cap`/`resetAt`), credit balances and billing-period totals — including
lifetime tokens like `1.35B`. Cline's response format is undocumented, so its
adapter maps the fields it recognises and otherwise degrades to a message; an
expired OAuth token reads "sign in again" (refreshing needs a client secret we
deliberately don't hold).

Additional desktop collectors run in Electron, independently of the backend:

- **Codex:** a separate, read-only app-server connection calls `account/read`
  and `account/rateLimits/read`. Returned buckets retain their actual durations,
  reset times, and percentages. It never creates a thread or sends a prompt.
  API-key and Bedrock logins do not expose ChatGPT subscription quotas.
- **Claude Code:** a launch-scoped status-line wrapper reads optional account
  windows and session cost. The existing status-line command is preserved.
  Global configuration is not changed.
- **Gemini CLI:** launch-scoped local telemetry supplies cumulative token and
  request counters. Prompt and trace logging are disabled. Account quota is
  available inside the CLI with `/stats model`.
- **Pi:** a launch-scoped extension observes assistant usage records and emits
  numeric totals without sending messages or continuing the agent.
- **Aider:** reported token and session-cost lines are observed in the existing
  terminal output. Estimates are labeled as CLI-reported usage.
- **OpenCode and Kilo:** local `stats --project ""` totals are read for the run's
  working directory. Unknown output formats produce an unavailable message.
- **Ollama:** local inference has no subscription quota; the panel links to
  cloud usage. **Shell:** usage tracking does not apply.

Observers are isolated per launch and session. Existing runs need a new launch
to attach Claude, Gemini, or Pi instrumentation. An unavailable helper or usage
sink must not prevent the CLI from starting.

## Normalized model + endpoint

`contextgit/limits/` maps every CLI into one shape
(`HarnessLimits` → `windows[]`, `credits`, `totals`, `plan`, `message`), exposed as:

```
GET /api/v1/limits?refresh=false
```

The registry returns every registered harness, including explicit placeholders
for desktop collectors. The preload `harnessUsage` IPC supplies those readings.
Account/project queries cache for 5 minutes and deduplicate simultaneous
requests; the panel reads local observers every 2 seconds while Code is open.
Refresh bypasses the account cache. Last valid readings are retained and labeled
stale when a subsequent lookup fails.

## Graceful degradation

These are **undocumented** APIs and can change when a CLI updates. Every adapter
is written to fail soft: a missing auth file, an expired/refused token, an HTTP
error or an unreachable host all become a `HarnessLimits` with `signed_in=false`
and a human `message` — never an exception, never a broken panel.

## UI

- **Code dock** — `desktop/src/shell/terminal/HarnessLimitsPanel.tsx` renders the
  selected run's harness limits under the run inspector (window bars with
  `used/cap` and "resets in …", credits, period totals).
- **Code rail** — `AgentRail` shows a compact badge on each harness group header
  (the tightest window, e.g. `Weekly 21%`).
- Data is fetched by `useLimits()` only while the Code tab is open, so the vendor
  APIs are hit at most once per cache window.

## Tests

`tests/test_limits.py` drives the adapters through an `httpx.MockTransport` (no
network): mapping the real Command Code payload shapes, missing-auth and error
paths, the cache, endpoint, and coverage of the CLI registry.

`npm run test:lifecycle --prefix desktop` checks quota normalization, cumulative
telemetry, isolated observers, unavailable helpers, and the Codex read-only
protocol. Desktop e2e verifies that the shell's PID and environment survive list
omissions, duplicate session IDs, tab/mode switches, and a backend interruption.

## Backend recovery and terminal lifetime

Readiness checks validate service/version, repository identity, session loading,
and renderer CORS. CORS wraps the server error boundary so a 500 retains its
headers. Repository-pinned requests reject a mismatched backend with HTTP 409.
After initial readiness, an outage displays a reconnect banner while keeping
terminal panes mounted. New runs are disabled until the backend is available.
Late session polls cannot overwrite mutations, and an omitted session is checked
individually before treating it as deleted. Saved pane IDs are deduplicated and
scoped to the validated repository.
