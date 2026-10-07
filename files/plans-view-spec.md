# Product spec — the "Plans" view

**Status:** proposal
**Companion:** `files/plans-research.md` (market pricing + proposed ContextGit tiers)
**Scope of first version:** read-only, informational. No billing, no auth, no server.

---

## 1. Why this view exists

ContextGit already talks to a dozen AI CLI harnesses and LLM providers, and it already
reads each harness's *own* account limits (`contextgit/limits/`, surfaced in the Code tab).
What it does **not** do is answer the question a user actually has:

> "Which AI plans am I paying for, what does each tier include, and how close am I to the
> limits on each?"

The **Plans** view is the single place that answers that. It joins two things:
1. the **live usage/limits** ContextGit already fetches per harness (real, from the CLI's
   own API), with
2. a **bundled static catalog** of what each vendor's plan tiers include (from
   `files/plans-research.md`), which the limits API does not provide.

A second, forward-looking card shows the **ContextGit** plan (the proposed Free/Pro/Team
model) — presented honestly as an entitlement placeholder, since the app is local-first
with no accounts today.

---

## 2. Goals / non-goals

**Goals**
- One screen: every installed harness → vendor tiers, your current plan, live usage vs caps.
- Zero new network calls: reuse the cached `all_limits()` registry; the catalog is static.
- Reuse the existing desktop tab pattern and CSS primitives — no new design language.
- Read-only and safe: no writes, no state, no auth surface added.

**Non-goals (explicitly out of scope for v1)**
- Real checkout, payment, license keys, accounts, or a billing server.
- Gating any existing feature behind a tier.
- Writing to any vendor API (the limits adapters stay read-only).
- A hosted cloud sync backend (that is the *Pro* tier's future work, not this view).

---

## 3. UX

**Placement:** a new **top-level tab** "Plans", last in the segmented nav
(after `storage`). No icon system exists — the nav uses a generic dot + label.

**Layout (rail + view, no dock, no bottom bar):**

```
┌ Rails ──────────┬ View ────────────────────────────────────────────────┐
│ Plans           │ Plans                                                │
│ ───────────────  │ Everything you're subscribed to, and where you stand │
│ ● Claude Code    │ ┌─ Connected AI plans ──────────────────────────────┐ │
│   Weekly 21%     │ │ [Claude Code]  Plan: Pro        [signed in]        │ │
│ ● Command Code   │ │  5-hour  ▓▓▓▓░░░░ 42%   Weekly ▓▓▓░░░░░ 21%        │ │
│   Max 10×        │ │  Anchors: $20/mo · Pro+ $60 · Ultra $200           │ │
│ ○ Cline          │ ├───────────────────────────────────────────────────┤ │
│   (no data)      │ │ [Command Code] Plan: Max 10×   $150 credits left   │ │
│                  │ │  ... windows, credits, totals ...                  │ │
│ ───────────────  │ └───────────────────────────────────────────────────┘ │
│ ContextGit       │ ┌─ ContextGit plan ─────────────────────────────────┐ │
│ Free (Local)     │ │ Free (Local) — full local app, unlimited          │ │
│                  │ │ Pro $20/mo · Team $30/seat · Enterprise           │ │
│                  │ │ [Compare plans]  (informational)                  │ │
│                  │ └───────────────────────────────────────────────────┘ │
└──────────────────┴─────────────────────────────────────────────────────┘
```

- **Rail:** one row per harness that has a catalog entry, with a small plan/usage badge
  (mirror `AgentRail`'s compact badge). Selecting scrolls/filters the view to that harness.
- **View:** "Connected AI plans" cards (live data), then the "ContextGit plan" card.
- **States:** signed-out / no-data harnesses render a muted row with the vendor's tier list
  and a "sign in to see your usage" note — never an error (mirrors `limits`' graceful
  degradation).

---

## 4. Data model

New package **`contextgit/plans/`** (precedent: `contextgit/limits/`).

```python
# contextgit/plans/models.py
from pydantic import BaseModel, Field
from contextgit.limits.models import HarnessLimits

class PlanTier(BaseModel):
    """One vendor tier, from the static catalog."""
    name: str                 # "Free", "Pro", "Pro+", "Ultra", "Teams", "Enterprise"
    price: str                # "$20/mo", "custom", "$0"
    period: str = "month"     # month | seat | custom
    highlights: list[str] = Field(default_factory=list)

class HarnessPlan(BaseModel):
    """A harness's vendor tiers + the user's live limits for it."""
    harness: str              # "commandcode"
    label: str                # "Command Code"
    vendor: str               # "Command Code"
    tiers: list[PlanTier] = Field(default_factory=list)
    limits: HarnessLimits | None = None   # joined live data, if any
    note: str | None = None

class ContextGitTier(BaseModel):
    name: str                 # "Free (Local)"
    price: str
    highlights: list[str] = Field(default_factory=list)

class PlansResponse(BaseModel):
    generated_for: str        # ISO date of the catalog snapshot
    harnesses: list[HarnessPlan] = Field(default_factory=list)
    contextgit: list[ContextGitTier] = Field(default_factory=list)
```

```python
# contextgit/plans/catalog.py
# Static, versioned data — no network. Source: files/plans-research.md.
CATALOG: dict[str, dict] = {
    "commandcode": {
        "label": "Command Code", "vendor": "Command Code",
        "tiers": [
            {"name": "Go", "price": "$1/mo", "highlights": ["~9K requests", "$10 credits"]},
            {"name": "GOAT", "price": "$10/mo", "highlights": ["~75K requests", "API access"]},
            {"name": "Pro", "price": "$20/mo", "highlights": ["~100K requests"]},
            {"name": "Max 10×", "price": "$100/mo", "highlights": ["~219K requests"]},
            {"name": "Max 20×", "price": "$200/mo", "highlights": ["~437K requests"]},
            {"name": "Teams", "price": "$40/mo", "highlights": ["Pooled credits"]},
        ],
    },
    "cline": {"label": "Cline", "vendor": "Cline AI",
        "tiers": [{"name": "Open Source", "price": "Free (BYOK)"},
                  {"name": "Teams", "price": "$20/mo"}, {"name": "Enterprise", "price": "custom"}]},
    "freebuff": {"label": "Freebuff", "vendor": "Freebuff",
        "tiers": [{"name": "Starter", "price": "$8/mo"}, {"name": "Plus", "price": "$25/mo"},
                  {"name": "Pro", "price": "$60/mo"}]},
    "claude":  {"label": "Claude Code", "vendor": "Anthropic",
        "tiers": [{"name": "Free", "price": "$0"},
                  {"name": "Pro", "price": "$20/mo"}, {"name": "Max", "price": "$100–$200/mo"}]},
    "codex":   {"label": "Codex", "vendor": "OpenAI",
        "tiers": [{"name": "Free", "price": "$0"}, {"name": "Plus", "price": "$20/mo"},
                  {"name": "Pro", "price": "$100–$500/mo"}]},
    "gemini":  {"label": "Gemini CLI", "vendor": "Google",
        "tiers": [{"name": "Free", "price": "$0"}, {"name": "AI Plus", "price": "$7.99/mo"},
                  {"name": "AI Pro", "price": "$19.99/mo"}, {"name": "AI Ultra", "price": "$100–$200/mo"}]},
    # claude-code/codex/gemini/aider/opencode have no limit adapter -> tiers only, no live data
}
```
*(The catalog is data, not behavior; keep it in one file and update it when vendors change
prices. Include a `catalog_version`/date so the UI can show "as of <date>".)*

---

## 5. Backend changes

**New route** in `contextgit/api/app.py`, beside the limits route (`app.py:1178-1190`):

```python
# ---------- plans (what each AI plan includes + your live usage) ----------
@app.get("/api/v1/plans", response_model=PlansResponse)
def plans(refresh: bool = False) -> PlansResponse:
    """Vendor plan tiers joined with your live harness limits (read-only)."""
    return build_plans(all_limits(refresh=refresh))
```

- `build_plans()` lives in `contextgit/plans/__init__.py` (or `service.py`): reads
  `CATALOG`, joins by harness id to the `HarnessLimits` returned by `all_limits()`
  (`contextgit/limits/registry.py`), and fills `contextgit` from the proposed tiers.
- Import `PlansResponse`/`HarnessPlan` into `app.py`'s schema import block.
- **No writes, no vendor calls beyond the existing cached limits fetch** (`TTL_SECONDS = 300`).

**Tests** — `tests/test_plans.py` (mirror `tests/test_limits.py`, no network):
- catalog integrity: every entry has `label`/`vendor`/non-empty `tiers`, valid prices.
- the join: a mocked limits registry produces `HarnessPlan.limits` populated for
  `commandcode`/`cline`/`freebuff`; `None` for `claude`/`codex`/`gemini`/`aider`/`opencode`.
- the endpoint returns `200` + `PlansResponse` shape; `refresh=true` bypasses the cache.

---

## 6. Desktop changes

Per the app's tab pattern (verified against the current tree):

| File | Change |
|---|---|
| `lib/api.ts` | Add `PlanTier` / `HarnessPlan` / `ContextGitTier` / `PlansResponse` types + `plans: (refresh=false) => request<PlansResponse>('/api/v1/plans'…)`. |
| `desktop/src/shell/TopNav.tsx` | Add `"plans"` to the `TabId` union (line 3-16). |
| `desktop/src/shell/Shell.tsx` | `TAB_IDS` push `"plans"` (line 102); `tabs[]` push `{ id: "plans", label: "Plans" }` (line 1003); `rail()` `case "plans"` (line 1177); `view()` `case "plans"` (line 1277); `bottomBar()` early-return `if (tab === "plans") return null;` (line 1730). |
| `desktop/src/shell/plans/usePlans.ts` | **New.** Fetch-on-enable hook, mirror `useLimits(enabled)`; load only while the tab is open. |
| `desktop/src/shell/views/PlansView.tsx` | **New.** Reuse `.cg-view-toolbar` / `.cg-view-body` / `.cg-usage-cards` / `.cg-usage-section` / `.cg-limit` / `Chip` / `Field`. |
| `desktop/src/shell/rail/PlansRail.tsx` | **New.** Harness list + plan badge (mirror `AgentRail`). |

No routing config, icon map, or barrel files are involved. The dock and bottom bar are
opted out (the view is read-only).

---

## 7. The entitlement seam (described, not built)

To make the *ContextGit plan* card real later, the app needs a local entitlement source.
Minimal seam, no server required for the free tier:

```
# ~/.commandcode/ … or <repo>/.contextgit/license.json
{ "tier": "free", "expires_at": null, "features": ["local", "team-mode", "mcp"] }
```

- `contextgit/plans/entitlements.py` reads this file; absent → `free`.
- The API exposes the resolved tier on `PlansResponse.contextgit`.
- **Cloud** tiers (sync, cloud agents, managed inference) are the only things that truly
  need a server — and are therefore deferred to a separate, much larger effort.

This keeps the promise that the **whole local product stays free**, and only cloud/
collaboration features are paid (`files/plans-research.md` §4).

---

## 8. Rollout

1. **v1 (this spec):** static catalog + live limits join, read-only view. Ships with zero
   new dependencies and reuses `contextgit/limits/`.
2. **v2:** add the ContextGit plan card + `license.json` entitlement read (still no billing).
3. **v3 (separate project):** cloud sync / cloud agents / billing — needs accounts, a server,
   auth (note: the API currently has *none* — see `files/codebase-audit.md` S1), and a
   privacy/security design.

---

## 9. Verification

- `files/plans-view-spec.md` file list matches the current tab wiring in
  `desktop/src/shell/Shell.tsx` (`TAB_IDS` :102, `tabs[]` :1003, `rail()` :1177,
  `view()` :1277, `bottomBar()` :1730) and `TopNav.tsx` (`TabId` :3-16).
- Backend route mirrors the `/api/v1/limits` pattern (`app.py:1178-1190`) and the
  `contextgit/limits/` package layout.
- `tests/test_plans.py` runs offline like `tests/test_limits.py`.
- No application code exists yet for this feature — this document is the contract.
