import type { CSSProperties } from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import Effects from "@/components/effects";
import WorkbenchTabs from "@/components/workbench-tabs";
import FleetCanvas from "@/components/fleet-canvas";
import WorkflowTabs from "@/components/workflow-tabs";
import HashDemo from "@/components/hash-demo";
import { AGENTS, FOOTER_LINKS, HEADER_CTA, NAV, DOC } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features — ContextGit",
  description:
    "Everything in ContextGit: the editor, browser, API and database clients, parallel agent runs, team mode and versioned conversations, in one local desktop app.",
};

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

interface Feature {
  id: string;
  no: string;
  eyebrow: string;
  title: string;
  lede: string;
  items: Array<[string, string]>;
  doc: [string, string];
}

const FEATURES: Feature[] = [
  {
    id: "one-window",
    no: "01",
    eyebrow: "One window",
    title: "The tools you open as ten apps, as ten tabs.",
    lede: "The workbench is one native window. Everything the agent reaches for lives beside the terminal that drives it.",
    items: [
      ["Terminal board", "Live terminals (xterm + node-pty) for every run."],
      ["Code tab", "Parallel runs — one terminal and one git branch each."],
      ["Editor", "Embedded VS Code (a bundled code-server sidecar) with the ContextGit graph."],
      ["Browser", "A general-purpose in-app browser: tabs, history, bookmarks, find-in-page, zoom and DevTools."],
      ["API client", "An embedded Restfox client, with a native runner as the default."],
      ["Database", "An embedded DbGate client — MySQL, Postgres, SQL Server, MongoDB, Redis, SQLite, ClickHouse and more."],
      ["Assets", "A file-asset library with its own AI agent."],
      ["Git", "History, graph, diffs and the merge preview, next to the work."],
      ["Chat, Docs, Usage", "Chat turns, document generation (Markdown, PDF, Word, PowerPoint) and one token-usage view."],
    ],
    doc: ["Design: workspace architecture", "files/workspace-architecture.md"],
  },
  {
    id: "agents",
    no: "02",
    eyebrow: "Agents",
    title: "Eleven agent CLIs, installed for you.",
    lede: "Bring the agents you already pay for. Each runs in its own terminal, billed to your own account.",
    items: [
      ["Real brand icons", "Claude Code, Codex, OpenCode, Gemini CLI, Aider, Ollama, Freebuff, Cline, Pi, Kilo Code and Command Code — plus a plain shell."],
      ["Auto-install on demand", "A missing CLI installs in the background with a progress bar. No installer terminal."],
      ["Harness usage limits", "Each CLI's own account limits, read locally and shown in the Code tab."],
      ["Bring your own key", "Any OpenAI-compatible endpoint: set the key, base URL and model and go."],
    ],
    doc: ["Design: code harnesses", "files/code-harnesses.md"],
  },
  {
    id: "parallel-runs",
    no: "03",
    eyebrow: "Parallel runs",
    title: "One worktree per run, so agents never overwrite each other.",
    lede: "Every run is an isolated checkout on its own branch. ContextGit watches the fleet and flags overlaps before anything merges.",
    items: [
      ["Isolated worktrees", "Agents edit separate checkouts of the same repository."],
      ["Fleet visibility", "Changed files, ahead/behind, conflict verdict and file overlap between runs."],
      ["Claims", "Each run claims its path scope; overlaps are flagged and a managed AGENTS.md block tells agents who owns what."],
      ["Merge queue", "Sequential, checkout-free integration with a git merge-tree pre-flight — a conflict stops the queue."],
      ["Paired merge", "Merging a run lands its diff on the git branch and its reasoning on the context branch."],
      ["Run isolation", "A private local port per run and a work-in-progress cap."],
    ],
    doc: ["Design: architecture", "files/architecture.md"],
  },
  {
    id: "team",
    no: "04",
    eyebrow: "Team mode",
    title: "A mission, split into tasks that can't collide.",
    lede: "Team mode turns one goal into a board of tasks with roles and ownership — and refuses overlapping work before anything is created.",
    items: [
      ["Tasks, roles, dependencies", "One run and worktree per task; blocked tasks wait for what they depend on."],
      ["Enforced ownership", "Two tasks can never claim the same files — refused up front, not resolved later."],
      ["Quality gate", "Finishing a task runs the project's own test/lint command in that worktree. Green lands in review; red goes back with the output."],
      ["Independent verifier", "A read-only review by a different agent CLI from its own worktree, before you approve."],
      ["MCP channel", "contextgit-mcp exposes the board as MCP tools, and .mcp.json is written for the project on launch."],
    ],
    doc: ["Design: team mode", "files/team-mode-architecture.md"],
  },
  {
    id: "versioned-context",
    no: "05",
    eyebrow: "Versioned context",
    title: "Commits, branches and merges for conversations.",
    lede: "The core: an immutable, content-addressed history for every chat — with a semantic merge that extracts what was learned and never auto-resolves a conflict.",
    items: [
      ["Conversation DAG", "SHA-256 commits over messages; branch, tag, checkout, log, diff and roll back without destroying later work."],
      ["Branch from any message", "Fork at the exact point the conversation went somewhere new; chat sessions stay isolated."],
      ["Staged turns", "Nothing lands on the branch until you press Commit, and a pending-changes diff shows exactly what will land."],
      ["Semantic merge", "Extracts decisions, facts, dead ends and open questions, detects contradictions, and shows a preview before anything is written."],
      ["Dead-end notes", "Failed attempts survive as a few lines of context instead of poisoning the next turn."],
      ["Merge quality probes", "Fixed probe questions check what a merge kept — an eval, not a promise."],
    ],
    doc: ["Design: merge engine", "files/merge-engine.md"],
  },
  {
    id: "privacy",
    no: "06",
    eyebrow: "Privacy",
    title: "Local-first. One file on your machine.",
    lede: "No account to start, no cloud, no telemetry. The only network traffic is the model calls you configured.",
    items: [
      ["One SQLite file", "Every commit, branch and run lives in a single local database file."],
      ["Only model calls leave", "And only to the provider you configured — nothing else phones home."],
      ["Open source", "Apache-2.0. Read the code, fork it, file issues."],
      ["Honest by default", "The local API binds to localhost and has no authentication today — we say so rather than claim otherwise."],
    ],
    doc: ["README", "README.md"],
  },
];

const TEAM_BOARD = [
  { col: "blocked", tasks: ["Docs refresh — waits on API contract"] },
  { col: "ready", tasks: ["Rate-limit notes"] },
  { col: "running", tasks: ["Subscription guard", "Cancelled-tier e2e"] },
  { col: "review", tasks: ["Claims overlap check"] },
  { col: "done", tasks: ["Board seed data"] },
];

function FeatureSection({ f, index }: { f: Feature; index: number }) {
  const tint = index % 2 === 1;
  return (
    <section
      className={`section${tint ? " section-tint" : ""}`}
      id={f.id}
      data-section
      aria-labelledby={`${f.id}-title`}
    >
      <div className="wrap">
        <header className="section-head reveal">
          <p className="eyebrow"><span className="eyebrow-no">{f.no}</span>{f.eyebrow}</p>
          <h2 id={`${f.id}-title`}>{f.title}</h2>
          <p className="lede">{f.lede}</p>
        </header>

        <div className="feat-grid">
          <dl className="feat-list reveal">
            {f.items.map(([term, desc]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{desc}</dd>
              </div>
            ))}
          </dl>

          <p className="feat-doc reveal" style={d(80)}>
            <a href={DOC(f.doc[1])}>{f.doc[0]} <span aria-hidden="true">&rarr;</span></a>
          </p>
        </div>

        {f.id === "one-window" && (
          <div className="reveal" style={d(120)}><WorkbenchTabs /></div>
        )}

        {f.id === "agents" && (
          <div className="marquee reveal" style={d(120)} aria-label="Supported coding agents">
            <ul className="marquee-track">
              {[...AGENTS, ...AGENTS].map((agent, index2) => (
                <li key={`${agent}-${index2}`}>{agent}</li>
              ))}
            </ul>
          </div>
        )}

        {f.id === "parallel-runs" && (
          <div className="reveal" style={d(120)}><FleetCanvas /></div>
        )}

        {f.id === "team" && (
          <div className="team-board reveal" style={d(120)} aria-label="Example team board: five tasks across blocked, ready, running, review and done columns">
            {TEAM_BOARD.map((c) => (
              <div key={c.col} className="team-col" data-col={c.col}>
                <p className="team-col-head mono">{c.col} <span>{c.tasks.length}</span></p>
                {c.tasks.map((t) => (
                  <p key={t} className="team-card">{t}</p>
                ))}
              </div>
            ))}
          </div>
        )}

        {f.id === "versioned-context" && (
          <div className="reveal" style={d(120)}>
            <div className="verbs" data-tabs>
              <div className="verb-list" role="tablist" aria-label="Operations" aria-orientation="vertical">
                <button type="button" role="tab" id="tab-commit" aria-controls="panel-commit" aria-selected="true" tabIndex={0}><span className="verb-name">commit</span><span className="verb-git mono">git commit</span></button>
                <button type="button" role="tab" id="tab-branch" aria-controls="panel-branch" aria-selected="false" tabIndex={-1}><span className="verb-name">branch</span><span className="verb-git mono">git branch</span></button>
                <button type="button" role="tab" id="tab-diff" aria-controls="panel-diff" aria-selected="false" tabIndex={-1}><span className="verb-name">diff</span><span className="verb-git mono">git diff</span></button>
                <button type="button" role="tab" id="tab-merge" aria-controls="panel-merge" aria-selected="false" tabIndex={-1}><span className="verb-name">merge</span><span className="verb-git mono">git merge</span></button>
                <button type="button" role="tab" id="tab-rollback" aria-controls="panel-rollback" aria-selected="false" tabIndex={-1}><span className="verb-name">roll back</span><span className="verb-git mono">git checkout</span></button>
              </div>

              <div className="verb-panels">
                <div role="tabpanel" id="panel-commit" aria-labelledby="tab-commit" tabIndex={0}>
                  <p className="verb-desc">A commit stores only the messages added since its parent, plus model, token count and author. Its id is a SHA-256 of that content, so history cannot change under you.</p>
                  <pre className="term"><code><span className="t-prompt">$</span> contextgit commit -m &quot;Spec the limit&quot;{"\n"}[main 7be04d8] Spec the limit{"\n"}<span className="t-dim"> 2 messages, 640 tokens, parent a3f9c21</span></code></pre>
                </div>
                <div role="tabpanel" id="panel-branch" aria-labelledby="tab-branch" tabIndex={0} hidden>
                  <p className="verb-desc">Fork from any commit. The new branch starts with exactly the context at that point, with no leftover tangents.</p>
                  <pre className="term"><code><span className="t-prompt">$</span> contextgit branch redis-bucket 1d6c9a0{"\n"}<span className="t-prompt">$</span> contextgit checkout redis-bucket{"\n"}Switched to branch &apos;redis-bucket&apos; at 1d6c9a0{"\n"}<span className="t-dim"> 5 messages, 1,440 tokens in context</span></code></pre>
                </div>
                <div role="tabpanel" id="panel-diff" aria-labelledby="tab-diff" tabIndex={0} hidden>
                  <p className="verb-desc">Compare two branches from their common ancestor on three levels: the messages, the meaning, and the token cost.</p>
                  <pre className="term"><code><span className="t-prompt">$</span> contextgit diff main redis-bucket{"\n"}common ancestor  1d6c9a0{"\n\n"}messages   main <span className="t-add">+2</span>   redis-bucket <span className="t-add">+8</span>{"\n"}tokens     main <span className="t-add">+476</span> redis-bucket <span className="t-add">+3,192</span>{"\n\n"}semantic (redis-bucket){"\n  "}<span className="t-add">+ decision</span>  Token bucket in Redis, one Lua call per request{"\n  "}<span className="t-add">+ fact    </span>  Clock skew tolerated up to 50 ms{"\n  "}<span className="t-del">- open    </span>  Where do counters live?  <span className="t-dim">(answered)</span></code></pre>
                </div>
                <div role="tabpanel" id="panel-merge" aria-labelledby="tab-merge" tabIndex={0} hidden>
                  <p className="verb-desc">Conversations do not merge line by line. ContextGit extracts what the branch learned and proposes a summary for you to approve.</p>
                  <pre className="term"><code><span className="t-prompt">$</span> contextgit merge redis-bucket{"\n"}common ancestor  1d6c9a0{"\n"}extracting decisions, facts, dead ends, open questions{"\n"}<span className="t-del">1 conflict</span>  logging policy (main vs redis-bucket){"\n\n"}Preview written. Resolve with --keep source|target,{"\n"}or edit the summary. Nothing is applied until you approve.</code></pre>
                </div>
                <div role="tabpanel" id="panel-rollback" aria-labelledby="tab-rollback" tabIndex={0} hidden>
                  <p className="verb-desc">Check out any earlier commit and keep going from there. Later commits stay put, so rolling back never destroys work.</p>
                  <pre className="term"><code><span className="t-prompt">$</span> contextgit checkout 7be04d8{"\n"}HEAD at 7be04d8 &quot;Spec the limit&quot;{"\n"}<span className="t-dim">Later commits are untouched. Nothing was deleted.</span>{"\n"}<span className="t-prompt">$</span> contextgit branch spec-v2{"\n"}<span className="t-prompt">$</span> contextgit checkout spec-v2</code></pre>
                </div>
                <p className="fineprint">Illustrative output. Command names and flags may change before release.</p>
              </div>
              <WorkflowTabs />
            </div>
            <div className="hash-demo reveal" style={d(160)}>
              <h3 className="minor">Change one character, get a different commit</h3>
              <HashDemo />
            </div>
          </div>
        )}

        {f.id === "privacy" && (
          <ul className="principles reveal" style={d(120)}>
            <li><h3 className="principle-title">No account</h3><p>Install and go. Accounts only arrive with the cloud tiers.</p></li>
            <li><h3 className="principle-title">No cloud</h3><p>Nothing syncs unless you turn it on, and that is a paid tier later.</p></li>
            <li><h3 className="principle-title">Your model, your key</h3><p>Calls go straight from your machine to the provider you configured.</p></li>
            <li><h3 className="principle-title">Apache-2.0</h3><p>The whole repository is open source. Audit it before you trust it.</p></li>
          </ul>
        )}
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>

      <SiteHeader links={NAV} cta={HEADER_CTA} logoHref="/" />

      <main id="main">
        <section className="section page-hero" data-section aria-labelledby="features-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="chip">Features</span><span>Everything that ships today</span></p>
              <h1 id="features-title" className="page-h1">One local app, from terminal to merge.</h1>
              <p className="lede">
                No promises about future releases — every line below is in the repository and
                documented. Grouped the way the product is built: the window, the agents, the
                runs, the team, the context and the data.
              </p>
              <p className="hero-actions reveal" style={d(80)}>
                <a className="btn btn-primary" href="/download">Get the desktop app <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-ghost" href="/pricing">Pricing</a>
              </p>
            </header>
          </div>
        </section>

        {FEATURES.map((f, i) => (
          <FeatureSection key={f.id} f={f} index={i} />
        ))}

        <section className="section section-tint" id="built" data-section aria-labelledby="built-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">07</span>How it&apos;s built</p>
              <h2 id="built-title">Immutable commits, one source of truth.</h2>
              <p className="lede">The same ideas that make git trustworthy, applied to messages. The core library owns every rule; the CLI, the API and the UI are thin wrappers.</p>
            </header>

            <div className="internals-grid">
              <div className="layers reveal" role="img" aria-label="Architecture layers. The Electron desktop UI and the CLI sit on a FastAPI layer. FastAPI sits on the core library. The core library uses storage on SQLite, an LLM adapter, and the merge engine. Dependencies point downward only.">
                <div className="layer-row layer-two" aria-hidden="true"><span className="layer">Desktop UI (Electron)</span><span className="layer">CLI (typer)</span></div>
                <p className="layer-link mono" aria-hidden="true">calls</p>
                <div className="layer-row" aria-hidden="true"><span className="layer">FastAPI &middot; HTTP and SSE</span></div>
                <p className="layer-link mono" aria-hidden="true">calls</p>
                <div className="layer-row" aria-hidden="true"><span className="layer layer-core">Core library &middot; commits, branches, HEAD</span></div>
                <p className="layer-link mono" aria-hidden="true">uses</p>
                <div className="layer-row layer-three" aria-hidden="true"><span className="layer">Storage<br /><span className="layer-sub">SQLite</span></span><span className="layer">LLM adapter<br /><span className="layer-sub">one file per provider</span></span><span className="layer">Merge engine<br /><span className="layer-sub">diff + summarize</span></span></div>
                <p className="layer-foot">Dependencies point down only. Core never imports from the API, the CLI or the UI.</p>
              </div>

              <ul className="principles principles-tight reveal" style={d(80)}>
                <li><h3 className="principle-title">Streaming</h3><p>Chat replies stream over server-sent events and append token by token.</p></li>
                <li><h3 className="principle-title">Provider-agnostic</h3><p>Every call goes through one adapter. A new provider is one new file.</p></li>
                <li><h3 className="principle-title">Tested</h3><p>Pytest suite over core, storage, merge, API, CLI, gitops, team, verify and MCP.</p></li>
                <li><h3 className="principle-title">Documented</h3><p>Design docs live in <code>files/</code> in the repository, next to the code.</p></li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section section-end" data-section aria-labelledby="features-cta-title">
          <div className="wrap">
            <div className="cta reveal">
              <h2 id="features-cta-title" className="cta-title">See it running on your own project.</h2>
              <p className="cta-lede">Clone it, run the backend and the desktop app, and open a repo. Five minutes to the first agent run.</p>
              <div className="cta-actions">
                <a className="btn btn-signal" href="/download">Download <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-link-cta" href="/#context">See versioned context <span aria-hidden="true">&rarr;</span></a>
              </div>
              <p className="fineprint cta-fine">Early build. Expect rough edges. Open source, Apache-2.0.</p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
      <Effects />
    </>
  );
}
