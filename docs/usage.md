# Token usage

ContextGit records token usage for every LLM call and merges it across surfaces
in the **Usage** tab. Where a provider reports real usage we store it as-is;
everywhere else we fall back to the repository's `~4 chars ≈ 1 token` estimate and
tag the row as estimated.

## Real vs estimated

| Surface | Source | How |
|---|---|---|
| Chat | `provider` (real) when reported, else `estimate` | The chat stream passes a usage sink to the adapter. |
| Council | one row per member, real when reported | Same sink, per member. |
| Research | `estimate` | The engine calls the provider internally, so a single estimate covers the run. |
| Image | — | No LLM tokens. |
| Code (CLI/PTY) | `estimate` | A PTY agent's live usage is not observable; recorded at commit from the committed text. |

Adapters report real usage through an optional `usage_sink` (see
`contextgit/llm/base.py`):

- **OpenAI-compatible** — streaming requests add
  `stream_options: {include_usage: true}` and read the final `usage` frame; non-streaming
  reads `data["usage"]`. Providers that reject `stream_options` set
  `include_usage=False` and fall back to estimates.
- **Anthropic** — `message_start` supplies `input_tokens`, `message_delta` supplies
  `output_tokens`; non-streaming reads `data["usage"]`.

The sink is best-effort: a provider that never reports usage simply leaves the box
empty and the call site records an estimate instead.

## The event log

Every call appends one row to `usage_events` (`storage/migrations/0010_usage.sql`):
provider, model, surface, source, prompt/completion/total tokens, the session and
branch, and a timestamp. `Repo.record_usage` writes rows; `Repo.usage_summary`
merges them into totals and buckets (by provider+model, by surface, by source).

## Endpoint

`GET /api/v1/usage?days=N` → `UsageSummary` (`days` omitted = all time):

```json
{
  "totals": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
              "estimated_tokens": 0, "calls": 0 },
  "by_provider": [{ "provider": "openrouter", "model": "…", "totals": { … } }],
  "by_surface":  [{ "surface": "chat", "totals": { … } }],
  "by_source":   [{ "source": "provider", "totals": { … } }],
  "by_day":      [{ "date": "2026-10-06", "totals": { … } }],
  "activity":    [{ "date": "2026-10-06", "totals": { … } }],
  "streak": { "current": 3, "longest": 9, "active_days": 21, "last_active": "2026-10-06" }
}
```

`by_day` is the daily series **within the requested window** (oldest first) — it backs the
period-scoped stats (days active, average per day), so it follows the period filter.
`activity` is up to a year of daily buckets (last 365 days over **all** events) for the
contribution graph, so the graph is stable regardless of the selected period. `streak` is
computed over **all** events (UTC calendar days): `current` walks back from today (yesterday
still counts, so a streak isn't reported broken before the day's first call), `longest` is
the best run ever, `active_days` is the number of distinct days, and `last_active` is the
most recent one.

## The Usage tab

`desktop/src/shell/views/UsageView.tsx` (top-level tab) shows a **streak panel** (current /
best streak, active days), four stat cards (total tokens, model calls, days active, avg per
day), a full-year **contribution graph** (`activity`; the same `ActivityHeatmap` component
the Git tab uses, with month/weekday labels and a Less→More legend), a **Connected AI**
table — every ready provider plus any CLI harness that recorded `code` usage, each with
tokens, calls and a `real`/`est`/`mixed` chip — and a per-surface split. The rail switches
the window between **All time / Last 7 days / Today** (the contribution graph always spans
the last 12 months).
