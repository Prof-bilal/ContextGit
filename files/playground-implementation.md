# Playground implementation and verified ecosystem references

Checked 2026-10-08. Companion to `playground-spec.md`; the draft's provider names,
versions and security assumptions must not be treated as verified installation instructions.

## Research decisions

- **Warden:** the user identified https://warden.blog/ and its linked source,
  https://github.com/Prof-bilal/Warden. This is the OS sandbox CLI
  `warden-sandbox-cli`, not WARDEN at modelmarket.dev or a similarly named scanner.
  https://warden.blog/docs/install and https://warden.blog/docs/cli document
  lazy binary download, explicit policy grants and `warden doctor`. The website
  advertises 0.1.17; npm's `/latest` metadata returned **0.1.16**. Pin the published
  version; do not promise that installing its npm launcher verifies its backend.
- **ModelCheck:** the user identified https://model-checker-jet.vercel.app/.
  Its linked repository is https://github.com/Prof-bilal/ModelChecker. The root
  README describes a CLI plus a landing page, not a hosted evaluation backend.
  `cli/README.md` documents `modelcheck-cli`, the `modelcheck` executable and
  local evidence reports. npm returned **0.1.2**, with `dist/index.js` as its bin.
  Try uses `--help`; running a paid model evaluation is not implicit in installation.
- **CodeAtlas:** https://www.codeatlas.live/docs/mcp documents client config
  auto-wiring and daemon setup. npm returned **@codeatlas/mcp 5.3.0**, bin
  `dist/mcp-server.js`. Its lifecycle scripts must not run in ContextGit's installer:
  their effects would exceed the displayed project config preview. Install into
  a dedicated app directory and write only the reviewed Warden policy/config.
- **MCP Inspector:** https://github.com/modelcontextprotocol/inspector provides
  web, CLI and terminal inspection. Its current v2 API differs from older recipes.
  Reuse its workflow concept; this implementation needs no separate Inspector
  service, npm dependency or unauthenticated proxy port.
- **Discovery/bundles:** the official Registry API lives at
  https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md.
  https://github.com/modelcontextprotocol/mcpb documents zip bundles with manifests.
  Neither registry presence nor a bundle manifest is an execution safety verdict.
  Keep the catalog offline for this release.
- **Skills/plugins:** https://agentskills.io/specification defines SKILL.md;
  https://code.claude.com/docs/en/plugin-marketplaces documents Claude marketplaces.
  Extend the real `shared/roles.ts` vocabulary by exporting the bundled briefs as
  project-local `.agents/skills/<id>/SKILL.md`. Claude plugins can ship executable
  hooks and require a separate installer/review adapter; the marketplace entry
  links to the authoritative docs instead of pretending to install them.
- **Scanning:** https://github.com/snyk/agent-scan documents Snyk Agent Scan
  (formerly MCP Scan), an experimental CLI output contract, cloud credentials,
  and the fact that scanning can execute configured servers. It is not a safe
  drop-in pre-install process. Warden provides containment, not a comprehensive
  tool-poisoning verdict. Playground's description checks are explicitly limited
  heuristics; they are not a substitute for audited scanner integration.
- **Available development plugins/skills:** the plugin-management discovery found
  Context7, Codex Security and Superpowers among candidates. Existing web research,
  local code tools, TypeScript, pytest and Playwright cover this repository task;
  no extra plugin connection or agent skill installation was needed. The installed
  plugin-management skill was used for discovery only.
- **MCP SDK audit correction:** the installed SDK successfully imports
  `mcp.server.mcpserver.MCPServer`; the existing protocol integration tests pass.
  The draft's broken-import finding is stale in this checkout.

## Implemented release

### Development catalog expansion

Maintainer documentation and published npm metadata were checked on 2026-10-08.
The new locally installable MCP entries are Filesystem, Knowledge Graph Memory,
Sequential Thinking and Context7. The first three use the upstream
`@modelcontextprotocol/server-*` packages at **2026.8.31**; Context7 uses
`@upstash/context7-mcp` **4.2.0**. Source and setup references:
https://github.com/modelcontextprotocol/servers and https://github.com/upstash/context7.
Filesystem receives project read access; Memory receives only a dedicated state
directory; Sequential Thinking receives neither project nor network access;
Context7 receives access to `context7.com` and forwards no API keys. Its Try panel
explicitly states that queries leave the machine and anonymous limits apply.

Biome **2.5.15** (`@biomejs/biome`) and Smithery CLI **4.11.1** (`@smithery/cli`)
are isolated npm installs with help-only diagnostics. Their published executable
paths were checked in package archives. Biome's platform binary comes through
optional dependencies; Smithery's lifecycle scripts remain disabled. References:
https://biomejs.dev/installation/quick-start/ and https://smithery.ai/docs/concepts/cli.

Guided MCP entries cover GitHub, Playwright, Chrome DevTools, Serena, Firecrawl,
Sentry, Linear and Supabase. Their catalog links point to maintainer documentation.
Authentication, browser profiles, native dependencies and broader permission needs
make these setup guides rather than automatic connection claims. Native uv and
ripgrep installation and Snyk Agent Scan also have explicit setup guidance.

Eight concrete plugin guides cover Anthropic's Frontend Design, Code Review,
Feature Development, Plugin Development, Security Guidance, TypeScript LSP,
Pyright LSP, and Obra's Superpowers. Official marketplace membership was checked
against https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json.
Commands are displayed for the user's Claude Code client; ContextGit does not
execute plugin hooks or imply cross-client compatibility.

The revised interface adds featured cards, category counts, source icons,
installation and permission summaries, guided setup steps, example tool inputs,
and a side-by-side request/response inspector. Installation progress is tied to
the selected item, fixing the misleading installed message shown in the supplied
screenshot. An opaque content background improves contrast over the wallpaper.

The top-level Playground tab has Featured, MCP servers, Skills, Tools, Plugins and
Installed categories, text/capability search, publisher filtering, detail panes,
docs actions, per-project selection and an app manifest under
`userData/playground/playground.json`. Featured is a placement label, not a trust
certification. External publishers remain Community until a documented verification
policy exists; bundled role skills and the ContextGit MCP server are First-party.

The main process derives all commands and paths from the fixed catalog and active
workspace. Renderer IPC supplies only catalog IDs and a one-use preview token.
The preview expires after five minutes, binds to the active project and original
file contents, and exposes only the modified MCP entry so unrelated credentials
never enter the renderer. Existing servers are preserved; conflicting entries,
malformed JSON, symlink paths and custom skill overwrites fail closed. npm installs
are pinned, isolated, script-disabled, streamed, cancellable and bin-verified through
the existing harness pipeline. npm's generated lockfile and transitive dependency
contents are not known before download; the preview declares their affected paths.

Try opens a short-lived MCP stdio connection with a minimal environment and fixed
read-tool allowlists. It performs initialize/tools-list/tools-call, checks tool
argument shape against the declared schema, blocks obvious suspicious descriptions,
disables server-initiated client requests and enforces a 20-second/256-KB bound.
Output is inert text in React, never model context. Diagnostics have a 64-KB cap.
Third-party installed MCPs run only through Warden with catalog-specific grants.
CodeAtlas receives project read access and `.codeatlas` write access, with empty
network/environment grants. This is containment, not proof of
third-party safety. Warden must have a functioning host backend; Linux requires
both bubblewrap and strace. ContextGit's bundled read tools run directly.

Electron now generates a random launch token and passes it to its own API process.
All API routes except the health probe require Bearer auth when the token is set;
CORS preflight is still supported. Normal calls, streams, document downloads and
the editor graph carry the token. An occupied dev API port is rejected rather than
silently attaching the desktop to an unauthenticated existing server. Standalone
API users can enable the same protection with `CONTEXTGIT_API_TOKEN`.

## Deliberate release boundaries

No live registry installer, MCPB extraction, arbitrary commands, plugin hooks,
remote skill copying, credential storage, model evaluation UI, automatic updates or
uninstall are included. Windows npm installation is explicitly blocked while the
shell-free `.cmd` execution adapter is unresolved; bundled skills and config writes
remain usable. Packaged ContextGit MCP installation requires `contextgit-mcp` on
PATH because the packaged HTTP binary does not currently include a stdio launcher.
CodeAtlas/Warden execution needs a functional host sandbox; no unsandboxed fallback
is provided. Installing packages does not launch a daemon or open CodeAtlas's local
web UI. A full tool-definition pin/drift gate and audited third-party security scanner
remain later work, not claims made by this release.

## Validation commands

- `npm run build --prefix desktop`
- `npx tsc --noEmit`
- `.venv/bin/pytest -q`
- `npm run test:playground --prefix desktop`
- `npm run test:e2e -- --grep Playground`

The Playground unit suite covers preservation, credential-safe previews,
confirmation replay, project/config drift, symlinks, bundled skill installs,
blocked providers, a real MCP handshake and bounded/poisoned output. Electron
acceptance tests cover discovery, installation confirmation, project-local skill
persistence, a real read-only MCP call and launch-token authentication.
