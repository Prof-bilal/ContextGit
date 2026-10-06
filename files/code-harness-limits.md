# CLI harness usage limits

The Code tab shows each CLI harness's **own account limits** — the 5-hour /
Weekly meters, credit balances and plan that the CLI reports to itself. It is a
local, read-only view: no prompts or keys leave the machine, and requests go only
to the CLI's own API host.

## Where the numbers come from

No harness exposes limits on a machine-readable command; `cmd` and `cline` render
them only inside their TUI, fetched from their private APIs. This app makes the
same read-only calls using the login each CLI already stored:

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

`claude`, `codex`, `gemini`, `aider` and `opencode` have no account limits to show.

## Normalized model + endpoint

`contextgit/limits/` maps every CLI into one shape
(`HarnessLimits` → `windows[]`, `credits`, `totals`, `plan`, `message`), exposed as:

```
GET /api/v1/limits?refresh=false
```

The registry caches results for 5 minutes (`TTL_SECONDS`); `refresh=true` (the
panel's Refresh button) bypasses the cache.

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
network): mapping the real Command Code payload shapes, the missing-auth and
error paths, the expired-token path, the cache, and the endpoint.
