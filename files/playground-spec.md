# The Playground — MCP servers, skills, tools & plugins (research + spec)

**Prepared:** 2026-10-07
**Scope:** a new **Playground** top-level tab in the ContextGit desktop app — browse a catalog
of MCP servers, skills, tools and plugins, **install** them with one click, and **try** them
live — with three **featured first-party** tools: **CodeAtlas**, **Warden**, **model checker**.
**Companions:** `files/codebase-audit.md` (security), `files/team-mode-mcp.md` (ContextGit's own
MCP channel), `files/code-harnesses.md` (the install pipeline this reuses).
**Status:** research + design. No code yet.

---

## 1. Executive summary

1. **MCP won the integration war; the pain moved to discovery, install and trust.** Editing
   client JSON by hand is the old problem; the new one is that *any* MCP server you add controls
   tool descriptions and tool results that enter the model's trusted context — the exact surface
   for prompt injection and tool poisoning. Installation is now a **supply-chain decision**.
2. **The ecosystem standardized four answers**, and ContextGit should adopt all four:
   **registries** (official MCP Registry, Smithery, Glama, PulseMCP, mcp.so), **one-click
   bundles** (`.mcpb` — a zip + `manifest.json`, the Chrome/VSCode-extension analogue),
   **plugin marketplaces** (Claude's `/plugin install name@marketplace`, which can ship skills,
   agents, hooks *and* MCP servers together), and **try-it Inspectors/playgrounds** (call a tool
   live, view raw JSON-RPC).
3. **ContextGit is unusually well-placed.** It already (a) lists installable CLIs in a registry
   and installs them with a hidden `npm install -g` + progress/verify UI, (b) writes `.mcp.json`
   for its own MCP server, and (c) has a "rail of items + detail pane + per-item action" UI
   idiom. The Playground is mostly **reuse + a catalog + a trust gate**, not new infrastructure.
4. **Security is the differentiator, and it's why Warden is first-party.** A Playground that
   installs third-party MCP servers must **vet before install**. Warden *is* that gate
   (to confirm against its docs) — so it is not just a catalog row, it is the mechanism that
   makes the Playground safe to ship.
5. **Recommended shape:** *registry → vet → install → try*, curated-first, with "show exactly
   what will be written" before anything touches a client config.

---

## 2. Market research

### 2.1 Registries & discovery
| Registry | What it is | API / CLI | Notes |
|---|---|---|---|
| **Official MCP Registry** (`registry.modelcontextprotocol.io`) | The MCP project's own registry | HTTP API + `mcp-publisher` CLI | In **preview**; breaking changes possible; community-driven |
| **Smithery** (`smithery.ai`) | Search/connect/manage MCP servers **and skills** from the CLI | `npx skills add smithery/cli` | One-command install into Claude Desktop/Code, Cursor, Cline |
| **Glama** (`glama.ai`) | ~97,000 MCP servers, scanned & scored; **testable in the browser** | web + API | "superset of the official registry" |
| **PulseMCP**, **mcp.so**, **Composio**, **MCPfinder** | Directories / indexes (12,000+ servers across the field) | mostly web | Discovery breadth |

**Implication:** discovery is solved by others; ContextGit should **consume** registries (start
with the official one) rather than build a registry — and never blind-install what it finds.

### 2.2 Install formats
- **Client config entry** (`.mcp.json` / `command` + `args`) — what ContextGit already writes
  for its own server (`contextgit/mcp/config.py`). Generalizing this to arbitrary servers is the
  core install primitive.
- **`npx` one-shot** — no global install; a session-only server.
- **`.mcpb` MCP Bundle** — a zip + `manifest.json` describing a local server and its
  capabilities, **one-click install**, "spiritually like `.crx` / `.vsix`". Claude Desktop uses
  it (`.dxt` renamed to `.mcpb`). This is the format to support for zero-config local servers.

### 2.3 Plugin / skill marketplaces
- **Claude Code plugins**: a marketplace is a catalog of plugins; install with
  `/plugin install <name>@<marketplace>`, with **user / project / local scopes**. The official
  `anthropics/claude-plugins-official` listed ~314 plugins.
- A single plugin can add **skills, agents, hooks and MCP servers** — i.e. "plugin" is the
  superset that a Playground item may expand into. ContextGit should *know* this format even if
  its first version only installs MCP servers and skills.

### 2.4 Playground / Inspector UX (what "try" should feel like)
- Browser playgrounds (`mcpplayground.tech`, `mcpize.com/playground`) let you **browse a
  registry, inspect tools/resources, call a tool with custom arguments, and read the raw
  JSON-RPC frames — no install**. A local equivalent (MCP Inspector) does the same over stdio.
- **ContextGit's "Try" pane should mirror this**: pick a tool, fill its JSON args, call, show
  request/response.

### 2.5 Security & trust (the reason this feature needs a gate)
- **Tool poisoning**: malicious instructions hidden in tool *descriptions*.
- **Indirect prompt injection** through tool *results* (the model trusts what a tool returns).
- **Rug pulls** (a server changes behaviour after you trust it), **confused-deputy**, credential
  theft, and lateral movement across connected servers; see the OWASP MCP Top 10.
- Defenses that exist: **static scanners** (`mcp-scan` — inspects tool definitions pre-install;
  Safety Warden / `mcp-warden` — pin the tool surface, fail on drift, guard at runtime), and
  **runtime firewalls**.
- **ContextGit's stance:** every third-party item is **vetted before install** and its intended
  config change is shown before it is written.

---

## 3. The Playground — product spec

### 3.1 Surface
A new top-level desktop tab **`playground`**. Wiring is the standard three-touch pattern:
`TopNav.tsx` (`TabId` union, lines 3-16) + `Shell.tsx` (`TAB_IDS` 102, `tabs[]` 1003,
`rail()` 1077, `view()` 1211, `bottomBar()` 1730, `overlayOpen` 1976).

### 3.2 Layout
Reuse the rail + detail idiom (`views/EndpointsView.tsx`, `chat/AddProviderDialog.tsx`,
`endpoints/useEndpoints.ts`):
- **Rail** — categories: **Featured** (first-party) · **MCP servers** · **Skills** · **Tools** ·
  **Plugins** · **Installed**, with a search box and filter chips (trust, capability).
- **Detail** — the selected item: name, vendor, **trust badge**, summary, capability/tool list,
  install method, and actions **Install**, **Try**, **Docs**.
- **Try** — a mini MCP Inspector: list the server's tools, edit JSON args, call, show the
  JSON-RPC request/response. Read-only, sandboxed, bounded output.
- **Install preview** — a modal/dock showing *exactly* what will be written (the `.mcp.json`
  entry / client-config diff) and the vet verdict, with a confirm button.

### 3.3 Data model (typed registry, mirrors `desktop/shared/harnesses.ts`)
```ts
type PlaygroundKind = "mcp" | "skill" | "tool" | "plugin";
type Trust = "first-party" | "verified" | "community";

interface PlaygroundItem {
  id: string;
  label: string;
  kind: PlaygroundKind;
  vendor: string;
  summary: string;
  featured?: boolean;
  trust: Trust;
  install:
    | { kind: "npm"; pkg: string; args?: string[] }        // reuse the harness npm pipeline
    | { kind: "mcpb"; url: string }                        // zip + manifest.json
    | { kind: "mcp-config"; command: string; args: string[] } // write a .mcp.json entry
    | { kind: "skill"; path: string };                     // copy a skill into the workspace
  docsUrl?: string;
  tools?: { name: string; description: string }[];         // for the Try pane
}
```

### 3.4 Catalog source
- **v1: a curated static catalog in-repo** (`desktop/shared/playground.ts`) — offline,
  reviewable, safe. This is the recommendation.
- **Later: optional live search** against the official MCP Registry API (feature-flagged),
  with results always routed through the vet gate before install.

### 3.5 Install methods (reuse, don't reinvent)
| Method | Mechanism | Reuses |
|---|---|---|
| npm tool/server | hidden `npm install -g <pkg>` (or `--save-dev`), progress + PATH verify + cancel | `electron/harness.ts`, `HarnessInstall.tsx`, IPC `ctx:harness-*` |
| MCP config entry | merge `mcpServers.<id>` into the project's `.mcp.json` (never clobber) | `contextgit/mcp/config.py` (`ensure_mcp_config`) |
| `.mcpb` bundle | download + unpack + write manifest-derived config | new, but modelled on `scripts/fetch-*.mjs` |
| Skill | copy a skill file/dir into the workspace skills path | `desktop/shared/roles.ts` skill model |

### 3.6 Persistence
- **App-wide installed manifest:** `userData/playground.json`, mirroring `electron/main.ts`'s
  `projects.json` read/save pattern.
- **Per-project state:** localStorage, e.g. `cg-playground:${projectPath}` (same idiom as
  `cg-run-command:${projectPath}`).

---

## 4. First-party featured tools

### 4.1 CodeAtlas — code intelligence MCP server
`@codeatlas/mcp` — a **51–54-tool** MCP server that exposes a live architectural map of a
repository plus an AI code review built on the same model, as JSON-RPC over stdio. Highlights:
- **Zero-config install (v4.0.0):** `npm install --save-dev @codeatlas/mcp` inside a repo
  auto-wires **7 MCP clients** (Claude Desktop, Cursor, Claude Code CLI, Codex CLI, Gemini CLI,
  VS Code Copilot Chat, Continue), starts a per-OS daemon (launchd/systemd/Task Scheduler), and
  serves a browser surface at `http://localhost:7842`.
- Indexes a snapshot at `.codeatlas/state.db`; polyglot (Python, Java, Kotlin, Go, Rust, Ruby,
  PHP, Swift, Dart, C#, JS/TS); BYO LLM (OpenRouter/OpenAI/Anthropic/Ollama).
- Reports large token reductions vs. full-file walks (5×–200× in its benchmarks).
- Has its own `doctor` / `teardown` / `setup` CLI and `--read-only` mode.

**Playground entry:** `trust: "first-party"`, `featured: true`, `kind: "mcp"`, install via the
npm pipeline (dev-dep in the current project), Try pane lists its tools, and a deep link to the
`localhost:7842` surface. Prefer `--read-only` when the user only wants the map.

### 4.2 Warden — MCP security firewall (the vet gate)
WARDEN is a **zero-dependency MCP security firewall**: *"four gates vet a third-party server
before a tool definition reaches your model"*, reportedly tested against **1,108 public MCP
servers** with false positives published. Related implementations exist (Safety Warden proxy /
auditor; DSE's `mcp-warden` supply-chain gate; the `warden-mcp` PyPI static `mcp-scan`
companion that inspects tool definitions for tool-poisoning/prompt-injection, secrets in schemas,
dangerous capabilities, and the "lethal-trifecta" combo).
*(Exact Warden product surface to confirm — its site timed out during research.)*

**Playground role — two parts:**
1. **Featured item** — install/configure it like any first-party tool.
2. **Load-bearing gate** — Warden vets **every** third-party MCP item in the Playground before
   install, and the verdict is shown in the install preview. This is what makes shipping an
   installer defensible.

### 4.3 model checker — *(first-party; exact form to confirm)*
A first-party tool to check/benchmark models. **Playground entry:** `featured: true`. Its detail
pane is the model-check surface (pick providers/models, run a check, see results and deltas).
Its install/run shape slots into the model in §3.3 as `kind: "tool"` (in-app) or `"mcp"` (a
server) once confirmed. **Open question for the user** (see §8).

---

## 5. Architecture & reuse map

| Need | Reuse (file) |
|---|---|
| Install npm tools: detect on PATH, hidden install, progress, cancel, verify | `desktop/shared/harnesses.ts`, `desktop/electron/harness.ts`, `terminal/HarnessInstall.tsx`, IPC `ctx:harness-check/install/cancel/progress` |
| Write MCP client config (merge, never clobber) | `contextgit/mcp/config.py` `ensure_mcp_config` |
| Catalog → safe view model | `contextgit/llm/spec.py` + `llm/registry.py` (`ProviderInfo`: `configured`, `has_key`, `key_hint` — never the secret) |
| Rail + detail + per-item action UI | `views/EndpointsView.tsx`, `chat/AddProviderDialog.tsx`, `endpoints/useEndpoints.ts` |
| Persist installed items | `electron/main.ts` `projects.json` (`ProjectStore` read/save) → `userData/playground.json` |
| Tab wiring | `TopNav.tsx` TabId (3-16); `Shell.tsx` 102/1003/1077/1211/1730/1976 |
| Backend MCP surface | `contextgit/mcp/` (server/tools/config) — **fix the audit's broken import first** (`mcp.server.mcpserver`; see `files/codebase-audit.md`) |

### Existing "skill" ambiguity to resolve
Two skill concepts exist today: **role skills** (`desktop/shared/roles.ts`, ~40 skills injected
into run briefings, backed by `sessions.role/skills`) and the **Agent-tab `SKILL_CATALOG`**
(`desktop/src/shell/agent/mission.ts`, fixture-only). The Playground should own **one Skills
catalog** and state which it extends (recommend: extend role skills, since they're real and
persisted).

---

## 6. Security (this feature installs third-party code)

- **Vet before install.** Every third-party item passes **Warden** (or `mcp-scan`-style static
  checks): tool-poisoning/prompt-injection in descriptions, secrets in schemas, dangerous
  capabilities, the lethal-trifecta combo. Show the verdict.
- **Show exactly what will be written** — the `.mcp.json` / client-config diff — before writing.
- **Curated-first.** No blind installs from live registry results; live results are always
  vetted and require explicit confirmation.
- **Try pane is sandboxed & read-only** where possible: no shell, bounded output, only the
  item's declared tool schema.
- **Never store secret values** for an item's credentials — reuse the `verify/env.py` discipline
  (names + sha256 only).
- **Hard prerequisites from the audit** (`files/codebase-audit.md`):
  - **S1 (CRITICAL):** the local API has **no auth**. An install/try surface must sit behind the
    per-launch token fix — installing third-party code over an unauthenticated loopback control
    plane is indefensible.
  - **S2/S3:** the gate runner uses `shell=True`; the Playground must not add a new RCE path.
  - **Fix the broken MCP import** (`mcp.server.mcpserver`) before building on `contextgit/mcp/`.

---

## 7. Roadmap

1. **v1 — Catalog + install.** Playground tab; curated static catalog; Featured first-party
   (CodeAtlas, Warden, model checker); install via the npm pipeline; `userData/playground.json`
   persistence; "what will be written" preview. No live registry.
2. **v2 — Try + vet gate.** Mini-Inspector Try pane for installed/served items; Warden vet wired
   into install; per-project `.mcp.json` writing for arbitrary servers.
3. **v3 — Ecosystem.** Optional live search (official MCP Registry / Smithery / Glama); `.mcpb`
   bundle install; skills/plugins install (Claude marketplace format); update/teardown.

---

## 8. Open questions

1. **model checker** — what is it, technically? An MCP server, a CLI, or an in-app surface? This
   determines its `kind` and Try pane.
2. **Warden** — confirm the exact install/run surface (proxy vs library vs CLI) and whether the
   vet gate runs locally or calls a service.
3. **Catalog license/trust** — who curates the "community" tier, and what earns "verified"?

---

## 9. Sources

MCP registries & discovery:
- [Official MCP Registry](https://registry.modelcontextprotocol.io/) · [API docs](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md) · [Publish quickstart](https://modelcontextprotocol.io/registry/quickstart)
- [Smithery CLI docs](https://smithery.ai/docs/concepts/cli) · [Smithery MCP guide 2026](https://skiln.co/blog/smithery-mcp-guide-2026)
- [Glama — MCP registry](https://glama.ai/)
- [Best MCP Server Directories 2026](https://www.innvesti.com/reports/best-mcp-server-directories-2026/) · [Where to find MCP servers 2026](https://automationswitch.com/ai-workflows/where-to-find-mcp-servers-2026)

Install formats:
- [modelcontextprotocol/mcpb — Desktop Extensions](https://github.com/modelcontextprotocol/mcpb) · [Anthropic: Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions) · [Build with MCPB](https://claude.com/docs/connectors/building/mcpb)

Plugin marketplaces & skills:
- [Claude Code — Install and manage plugins](https://code.claude.com/docs/en/plugins/install) · [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) · [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)

Playground / Inspector:
- [MCP Playground](https://www.mcpplayground.tech/) · [MCP Inspector online](https://mcpplaygroundonline.com/mcp-inspector-online) · [mcpize playground](https://mcpize.com/playground)

Security & trust:
- [MCP Security Risks 2026: Prompt Injection and Tool Poisoning](https://www.decryptiondigest.com/blog/model-context-protocol-security-risks) · [MCP Security Guide 2026](https://baeseokjae.github.io/posts/mcp-security-guide-2026/) · [Tool Poisoning & Confused Deputy 2026](https://appscale.blog/en/blog/mcp-security-tool-poisoning-prompt-injection-confused-deputy-2026) · [OWASP MCP Top 10 / mcp-scan](https://mcpplaygroundonline.com/blog/mcp-security-tool-poisoning-owasp-top-10-mcp-scan)

First-party tools:
- [CodeAtlas MCP server docs](https://www.codeatlas.live/docs/mcp) · [@codeatlas/mcp on npm](https://www.npmjs.com/package/@codeatlas/mcp)
- [WARDEN — the MCP firewall](https://warden.modelmarket.dev/)
- [Safety Warden — MCP security](https://mcpmarket.com/server/safety-warden) · [mcp-warden](https://www.thedataexperts.us/mcp-warden/) · [warden-mcp on PyPI](https://pypi.org/project/warden-mcp/)
