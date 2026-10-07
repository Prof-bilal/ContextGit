# AI coding tools & models — plans research (Free / Pro / Plus / Team / Enterprise)

**Prepared:** 2026-10-07
**Purpose:** understand how the market structures subscription tiers — what's on free,
what's on pro/plus, what teams get — and use it to propose a tier model for ContextGit.
**Caveat:** pricing in this market changes monthly. Every figure below is dated to the
research pass; re-verify against the vendor page (linked at the end) before quoting publicly.

> Companion document: `files/plans-view-spec.md` spec's a new "Plans" view that surfaces
> this information inside the ContextGit desktop app.

---

## 1. Executive summary

1. **A free tier is table stakes.** Almost every tool has one — Cursor Hobby, Copilot Free,
   Claude Free, ChatGPT Free, Google AI Free, Windsurf Free, Cline/OpenCode/Aider (open
   source). The lone holdout is **Command Code**, whose cheapest plan is **Go at $1/mo**.
2. **Free is metered, not feature-crippled.** Vendors let you *use the core agent* and then
   run out of quota (Copilot Free = 2,000 completions + 50 chat/mo; Cursor Hobby = "limited
   agent requests"). The paywall is **usage**, not the product.
3. **The market has standardized on usage-based credits/quotas.** GitHub **AI Credits**
   (1 credit = **$0.01**), Cursor dollar-denominated usage pools, Command Code credits,
   Freebuff **Freebucks**, Windsurf/Devin daily+weekly quotas. Higher tiers mostly mean
   *more included usage*, not *more features*.
4. **$20 is the individual anchor; $100–$200 is the power band.** Cursor Pro $20 / Ultra
   $200, Claude Pro $20 / Max $100–$200, Copilot Pro $10 / Max $100, ChatGPT Plus $20 /
   Pro $100–$500, Google AI Pro ~$20 / Ultra $100–$200, Windsurf Pro $20 / Max $200.
5. **"Plus" has no stable rank — do not copy the naming blindly.** Google's *Plus ($7.99)
   < Pro ($19.99)*, but ChatGPT's *Plus ($20) < Pro ($100)*, and Freebuff's *Plus ($25)*
   sits in the middle. A user cannot infer ordering from the word "Plus".
6. **Team ≈ $20–40/seat; Enterprise is admin, not capability.** SSO/SAML/SCIM, audit logs,
   RBAC, central billing, pooled usage, VPC/self-host, IP indemnity, SLA.
7. **Open-source + bring-your-own-key is a genuine $0 competitor** (Cline, OpenCode, Aider).
   ContextGit itself sits in that camp — which shapes the tier model below.

---

## 2. Comparison tables (as of 2026-10-07)

### 2.1 AI-native IDEs and coding tools

| Tool | Free tier | Entry paid | Mid | High | Team / seat | Enterprise | Quota model |
|---|---|---|---|---|---|---|---|
| **Cursor** | Hobby $0 — limited agent requests, Composer | **Pro $20** | Pro+ $60 | Ultra $200 | Teams $40/user (Standard/Premium) | Custom | Model-usage pools, on-demand in arrears |
| **GitHub Copilot** | Free $0 — 2,000 completions + 50 chat/mo, CLI + agent mode | **Pro $10** | Pro+ $39 | Max $100 | Business $19 / Enterprise $39 | Custom | **AI Credits** (1 cr = $0.01); completions free on paid |
| **Windsurf / Devin** | Free $0 — light agent quota, unlimited Tab | **Pro $20** | — | Max $200 | Teams $80/mo + $40 per full dev seat | Custom | Daily + weekly quotas; extra usage at API rates |
| **Cline** | **Open source, free** (BYO key or inference at cost) | — | — | — | Teams $20 | Custom (SSO, RBAC, VPC, SLA) | Pay-as-you-go at cost, or BYOK |
| **Command Code** | *(none)* | **Go $1** | GOAT $10 / Pro $20 | Max 10× $100 / Max 20× $200 | Teams $40 | Custom | Subscription **credits** per model; roll-over top-ups |
| **Freebuff** | Free tier | Starter $8 | **Plus $25** | Pro $60 | — | — | **Freebucks** — per-hour model sessions, daily refill |
| **Codebuff** | PAYG 1¢/credit | — | — | Subs $100 / $200 / $500 | — | — | Credits by task complexity |
| **OpenCode** | **Open source, free** (free models included or BYOK) | — | — | — | — | — | BYOK / free model routing |
| **Aider** | **Open source, free** (BYOK) | — | — | — | — | — | BYOK |

### 2.2 General assistants with coding agents

| Tool | Free | Entry | Mid | High | Team / seat | Enterprise | Notes |
|---|---|---|---|---|---|---|---|
| **Claude** (Claude Code) | Free $0 (Claude Code **not** included) | **Pro $20** ($17 annual) | — | Max $100 (5×) / $200 (20×) | Team $25 std / $125 premium ($20/$100 annual) | $20/seat + usage at API rates | Claude Code needs Pro+; SSO/SCIM/audit on Team+ |
| **ChatGPT** (+ **Codex**) | Free $0 | Go $8 / **Plus $20** | — | Pro $100 / $200 / $500 | Business | Enterprise | Codex ships with every plan; Pro tiers = 5×/20× usage |
| **Google Gemini** (Antigravity, Jules) | Free | **AI Plus $7.99** | AI Pro $19.99 | AI Ultra $100 (5×) / $200 (20×) | (Workspace add-on) | Gemini Enterprise | Limits are "2× / 4× / higher / highest" vs free; storage bundled |

**Anchor prices observed:** $1, $8, $10, $20, $39, $60, $100, $200, $500 (monthly).

---

## 3. Cross-market patterns ("what's on free / pro / plus")

**Free tier**
- Always present (except Command Code), always **metered**, usually includes the *whole*
  agent for a limited volume. Common free limits: 2,000 completions + 50 chats (Copilot),
  "limited agent requests" (Cursor), a light daily quota (Windsurf), unlimited-but-BYOK
  (Cline/OpenCode/Aider).

**Pro / individual tiers**
- Priced **$10–$20**, anchored at **$20**.
- The jump from free → pro buys **more quota**, **frontier models** (Opus/GPT-5.x/Gemini
  Pro), and **quality features**: cloud agents, extended limits, MCP/skills/hooks (Cursor),
  research, priority access.

**Power / "Max"/"Ultra" tiers**
- **$100–$200** (some to $500). Marketed as 5×/20× usage, highest rate limits, early
  access. This is where "all models, no caps" lives.

**Team tiers**
- **$19–$40/seat**. Value is **collaboration + admin**: central billing, pooled usage,
  SSO, admin dashboard, analytics, team privacy mode, RBAC.

**Enterprise**
- **Custom** or seat + usage. Value is **compliance & control**: SAML/OIDC/SCIM, audit
  logs, IP allow-listing, VPC/self-host, HIPAA-ready, SLA, dedicated support, IP indemnity.

**Gating summary — what actually differs by tier**
| Axis | Free | Pro | Max/Ultra | Team | Enterprise |
|---|---|---|---|---|---|
| Core agent | limited | yes | yes | yes | yes |
| Quota | small | medium | large | medium/pooled | custom |
| Frontier models | some/none | yes | yes | yes | yes + custom |
| Cloud/background agents | no | often | yes | yes | yes |
| Admin (SSO/audit/RBAC) | no | no | no | some | yes |

---

## 4. Proposed ContextGit tier model

**Design principle (non-negotiable):** ContextGit is local-first, open-source (Apache-2.0),
no-accounts. Tiering must **not cripple the local tool** to manufacture upsell — that
contradicts both the license reality and the product's own "full real capability" value.
So: **the entire local, single-user product is free**, and paid tiers sell **scale, cloud,
and collaboration**.

### 4.1 Free — "Local"
Everything that runs on your machine, complete and unmetered:
- Conversation DAG (branch/diff/merge/rollback), semantic merge
- Parallel agent runs + one git worktree/branch per run, fleet/claims
- Team mode (task graph, roles, ownership), quality gate + independent verifier, merge queue
- Chat / Council / Research / Image; document export (MD/PDF/DOCX/PPTX)
- All desktop tabs: Git, Endpoints, Why, Database, API, Browser, embedded VS Code
- MCP server, all 12 CLI harnesses, all BYO LLM providers
- Unlimited local projects, commits, runs
- **Cost to vendor: $0** (no cloud, BYO keys). This is the honest free tier.

### 4.2 Pro — "$20/mo per user" (individual power)
Cloud + scale + convenience on top of Free:
- **Encrypted cloud backup & multi-device sync** of conversation repos
- **Managed / bundled inference credits** (bring nothing; works out of the box)
- **Cloud agent runs** — offload heavy parallel/team runs off the local machine
- **Scheduled / background agents** (the "Agent routines" feature is fixture-only today)
- **Extended history & analytics retention** (the usage event log today grows unbounded)
- Priority model routing, priority support

### 4.3 Plus / Team — "$30/seat/mo" (collaboration)
- **Shared team memory & merge queue** across members
- Team marketplace for roles/skills
- Shared usage analytics, central billing, SSO, admin controls, RBAC

### 4.4 Enterprise — custom
- Self-hosted / VPC sync server, SAML/SCIM, audit logs, compliance, SLA, dedicated support

### 4.5 Naming recommendation
The market proves **"Plus" has no consistent rank** (Google: Plus < Pro; ChatGPT: Plus <
Pro; Freebuff: Plus is mid). Options:
- **Recommended:** `Free / Pro / Team` (+ Enterprise) — unambiguous ordering.
- If a three-tier consumer ladder is required: `Free / Pro / Pro Max` (mirrors Cursor's
  Pro/Ultra and ChatGPT's Plus/Pro split without the ambiguous "Plus").
- Use `Plus` **only** if it is explicitly the *collaboration* tier and labelled as such
  (e.g. "Plus (Teams)").

### 4.6 What could be metered (and isn't today)
The only surfaces that leave the machine — i.e. the only things a paid tier *could* gate —
are: LLM calls (chat / council / research / image / documents / merge), research web
fetches, harness-limit lookups, and harness installs. **None are metered, gated, or
accounted anywhere in the codebase today.** A paid tier is therefore **greenfield** and
would require an entitlement layer (license file + a server for cloud features) that does
not currently exist. See `files/plans-view-spec.md` §"entitlement seam".

---

## 5. Sources

Vendor pricing pages (primary):
- [Cursor — Pricing](https://cursor.com/pricing)
- [GitHub Copilot — Plans & pricing](https://github.com/features/copilot/plans)
- [Claude — Plans & pricing](https://claude.com/pricing)
- [Google One — Google AI plans](https://one.google.com/about/google-ai-plans/)
- [Windsurf / Devin — Plans and pricing](https://www.windsurf.com/pricing) (redirects to devin.ai/pricing)
- [Command Code — Pricing](https://commandcode.ai/pricing)
- [Cline — Pricing](https://cline.bot/pricing)
- [Freebuff — Pricing](https://freebuff.com/pricing)
- [Codebuff — Pricing](https://www.codebuff.com/pricing)
- [OpenCode](https://opencode.ai/)
- [Aider](https://aider.chat/)

Secondary (market round-ups consulted for tier details/confirmation):
- [Cursor Pricing 2026: Hobby, Pro, Ultra, Team Plans](https://saganote.com/cursor-pricing)
- [GitHub Copilot Pricing 2026: What Free Actually Includes](https://yixscout.com/resources/columns/github-copilot-pricing-free)
- [Claude Pricing Plans 2026: Free, Pro, Max, Team and Enterprise](https://benchlm.ai/claude/pricing-plans)
- [ChatGPT Pricing 2026: Every Plan From $0 to $500](https://www.layer3labs.io/guides/chatgpt-pricing)
- [Codex Pricing (2026): Free, $8 Go, $20 Plus, Pro from $100](https://www.layer3labs.io/guides/openai-codex-pricing)
- [Gemini Pricing: Free, AI Pro & Ultra Plans (2026)](https://www.ai-toolbox.co/gemini-models/gemini-pricing-plans-2026)
- [Windsurf Pricing 2026: Plans, Quotas & What Changed](https://provenbrief.com/story/windsurf-pricing-plans-quotas-and-what-changed)
- [Command Code pricing 2026: plans, real cost, and who should pay](https://www.dapols.com/tools/command-code)
- [Cline Pricing (2026): Plans, Costs & Is It Worth It?](https://devtoolsreview.com/pricing/cline-pricing/)
- [Freebuff Pricing 2026 — Plans & Free Tier](https://needaiforthis.com/pricing/freebuff)
- [OpenCode Free: No API Key Needed (2026 Guide)](https://coderfile.io/blog/opencode-free-ai-coding-agent-2026)
