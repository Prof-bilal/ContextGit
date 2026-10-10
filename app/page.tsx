import type { CSSProperties } from "react";
import type { Metadata } from "next";
import HeroGraph from "@/components/hero-graph";
import MergeDialog from "@/components/merge-dialog";
import CopyButtons from "@/components/copy-buttons";
import Effects from "@/components/effects";
import FleetCanvas from "@/components/fleet-canvas";
import AppDemo from "@/components/app-demo";
import WorkbenchTabs from "@/components/workbench-tabs";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import PricingTiers from "@/components/pricing-tiers";
import { AGENTS, FOOTER_LINKS, GITHUB, HEADER_CTA, NAV } from "@/lib/site";

export const metadata: Metadata = {
  title: "ContextGit — the one window for AI development",
  description:
    "ContextGit is a local-first terminal-agent and Git context workbench: run parallel coding agents in isolated git worktrees and keep their AI context versioned.",
};

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const FAQ: Array<[string, React.ReactNode]> = [
  [
    "Isn't this just summarizing my chat?",
    <>A summary replaces history. ContextGit keeps history as immutable commits and only summarizes at merge time, with a preview, a conflict check and the full branch still intact.</>,
  ],
  [
    "Is a merge lossless?",
    <>No. A merge is a compact summary of decisions, facts, dead ends and open questions. That is why the original branch is never deleted, and why merge quality is tracked with probe questions.</>,
  ],
  [
    "Where does my data go?",
    <>Commits live in a local SQLite file. The only network traffic is the calls you make to your chosen model provider.</>,
  ],
  [
    "Which agents does it run?",
    <>Eleven agent CLIs plus a plain shell — Claude Code, Codex, OpenCode, Gemini CLI, Aider, Ollama, Freebuff, Cline, Pi, Kilo Code and Command Code. A missing CLI is installed in the background, and you bring your own model key.</>,
  ],
  [
    "Do I need an account?",
    <>No. The local app needs no account and no sign-in. Accounts only arrive with the cloud tiers, when they ship.</>,
  ],
  [
    "Does it work with my editor?",
    <>ContextGit launches the terminal agents you already use. Bring your own editor alongside it — every run is a real git worktree on disk.</>,
  ],
  [
    "Is it free?",
    <>The local app is free: unlimited projects, runs and commits. Paid tiers (cloud sync, security audit, team) are coming, and prices are not set yet. See <a href="/pricing">Pricing</a>.</>,
  ],
  [
    "Does it support teams?",
    <>Team mode is shipped locally — tasks, roles, a quality gate, an independent verifier and an MCP channel across parallel runs. Cloud sync and multi-user collaboration are on the roadmap.</>,
  ],
  [
    "Is it production-ready?",
    <>Early build. Expect rough edges. It is open source under Apache-2.0 and built in the open — <a href={GITHUB}>read the code</a> and open an issue when something breaks.</>,
  ],
];

export default function Page() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>

      <SiteHeader links={NAV} cta={HEADER_CTA} logoHref="#top" />

      <nav className="rail" aria-label="Page sections">
        <ol>
          <li><a href="#top" data-label="Overview"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">01</span><span className="rail-label">Overview</span></a></li>
          <li><a href="#workbench" data-label="One window"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">02</span><span className="rail-label">One window</span></a></li>
          <li><a href="#fleet" data-label="Control tower"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">03</span><span className="rail-label">Control tower</span></a></li>
          <li><a href="#context" data-label="Versioned context"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">04</span><span className="rail-label">Versioned context</span></a></li>
          <li><a href="#merge" data-label="Merge engine"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">05</span><span className="rail-label">Merge engine</span></a></li>
          <li><a href="#pricing" data-label="Pricing"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">06</span><span className="rail-label">Pricing</span></a></li>
          <li><a href="#install" data-label="Questions"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">07</span><span className="rail-label">Questions</span></a></li>
        </ol>
      </nav>

      <span className="sr-only" id="copy-status" role="status" aria-live="polite"></span>

      <main id="main">

        <section className="hero" id="top" data-section aria-labelledby="hero-title">
          <div className="hero-bg" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          <div className="wrap">
            <p className="eyebrow reveal"><span className="chip">Local-first</span><span>The one window for AI development</span></p>
            <h1 id="hero-title" className="reveal" style={d(60)}>
              <span className="h1-a">Build in one window.</span>
              <span className="h1-b">Keep the context that worked.</span>
            </h1>
            <p className="lede hero-lede reveal" style={d(120)}>
              ContextGit puts your coding agents and Git context in one local-first desktop app. Each agent gets its own git worktree, so parallel runs never collide, and every AI conversation is a branchable history you can merge.
            </p>
            <div className="hero-actions reveal" style={d(180)}>
              <a className="btn btn-primary" href={GITHUB}>Get the desktop app <span aria-hidden="true">&rarr;</span></a>
              <a className="btn btn-ghost" href="/features">See features</a>
              <div className="install">
                <code>pip install contextgit</code>
                <button type="button" className="btn btn-ghost btn-copy" data-copy="pip install contextgit" aria-label="Copy install command">Copy</button>
              </div>
            </div>
            <p className="fineprint reveal" style={d(200)}>Early build. Expect rough edges. Open source, Apache-2.0, and built in the open.</p>

            <ul className="trust-strip reveal" style={d(220)}>
              <li>Local-first</li>
              <li>Apache-2.0</li>
              <li>11 agent CLIs</li>
              <li>No account</li>
              <li>Only your model calls leave the machine</li>
            </ul>

            <p className="demo-label reveal" style={d(240)}>Interactive demo <span className="demo-note">· sample data · click a run</span></p>
            <div className="reveal" style={d(260)}>
              <AppDemo />
            </div>
            <div className="marquee reveal" style={d(320)} aria-label="Works with common coding agents">
              <ul className="marquee-track">
                {[...AGENTS, ...AGENTS].map((agent, index) => (
                  <li key={`${agent}-${index}`}>{agent}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="workbench" data-section aria-labelledby="workbench-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">02</span>One window</p>
              <h2 id="workbench-title">Everything the agent reaches for, in the same window.</h2>
              <p className="lede">
                A working day is a dozen apps: an editor, several terminals, an API client, a
                database tool, a browser with DevTools. ContextGit ships them as tabs in one
                native window — so switching tools stops costing you focus.
              </p>
            </header>

            <div className="reveal" style={d(60)}>
              <WorkbenchTabs />
            </div>

            <ul className="pillars reveal" style={d(120)}>
              <li>
                <h3 className="pillar-title">One window</h3>
                <p>Agents, terminals and Git context. No lost reasoning.</p>
              </li>
              <li>
                <h3 className="pillar-title">Agents that don&apos;t collide</h3>
                <p>One worktree per run, claimed files, a merge queue, an independent verifier.</p>
              </li>
              <li>
                <h3 className="pillar-title">Context you can version</h3>
                <p>Branch a conversation, diff it, merge what was learned, roll back.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="section section-tint" id="fleet" data-section aria-labelledby="fleet-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">03</span>Control tower</p>
              <h2 id="fleet-title">One project, many agents, no collisions.</h2>
              <p className="lede">
                Each run gets its own worktree and branch. ContextGit shows what every agent
                changed and flags the moment two of them reach for the same file, before
                anything merges.
              </p>
            </header>

            <div className="fleet-grid">
              <div className="reveal"><FleetCanvas /></div>
              <ul className="fleet-facts reveal" style={d(80)}>
                <li>
                  <strong>Isolated worktrees</strong>
                  <span>Every run edits its own checkout. Agents never overwrite each other&apos;s files.</span>
                </li>
                <li>
                  <strong>Claims and scopes</strong>
                  <span>Each run claims the paths it owns. Overlaps are flagged, and a managed <code>AGENTS.md</code> block tells every agent who owns what.</span>
                </li>
                <li>
                  <strong>A merge queue</strong>
                  <span>Branches merge one at a time, re-checked against the moved target, so a conflict stops the queue instead of breaking main.</span>
                </li>
                <li>
                  <strong>Code and context together</strong>
                  <span>Merging a run lands its diff on the git branch and its reasoning on the context branch, in one step.</span>
                </li>
                <li>
                  <strong>Team mode</strong>
                  <span>A mission split into tasks with roles, file scopes and dependencies — each with a quality gate and an independent verifier before anything lands.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="context" data-section aria-labelledby="context-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">04</span>Versioned context</p>
              <h2 id="context-title">A chat is one line. Real thinking is a tree.</h2>
              <p className="lede">
                You explore, backtrack, compare and decide — every chat app flattens that into
                one scroll. ContextGit gives each conversation commits, branches, diffs and
                rollbacks, so a dead end costs one branch, not the whole context window.
              </p>
            </header>

            <figure className="console reveal" aria-labelledby="console-cap">
              <div className="console-bar">
                <span className="mono">contextgit log --graph</span>
                <span className="mono console-repo">rate-limiter-design</span>
              </div>
              <div className="console-body">
                <div className="graph-wrap">
                  <HeroGraph />
                  <ul className="legend" aria-label="Legend">
                    <li><span className="key key-main" aria-hidden="true"></span>main</li>
                    <li><span className="key key-redis" aria-hidden="true"></span>redis-bucket</li>
                    <li><span className="key key-memory" aria-hidden="true"></span>in-memory (abandoned)</li>
                    <li><span className="key key-merge" aria-hidden="true"></span>merge commit</li>
                  </ul>
                </div>
                <aside className="inspector" id="hero-inspector" aria-live="polite" aria-label="Selected commit"></aside>
              </div>
              <figcaption id="console-cap">Select any commit. Its context is rebuilt by walking parents. A merge commit carries a summary, not the whole branch.</figcaption>
            </figure>
            <noscript><p className="fineprint">The interactive commit graph needs JavaScript. It shows nine commits across three branches, ending in a merge of redis-bucket into main.</p></noscript>

            <dl className="actions-list reveal">
              <div><dt className="mono">Branch from any message</dt><dd>Fork at the exact message where the conversation went somewhere new.</dd></div>
              <div><dt className="mono">Compare mode</dt><dd>Send one prompt to two branches and read the answers side by side.</dd></div>
              <div><dt className="mono">Cherry-pick</dt><dd>Bring a single commit from one branch onto another.</dd></div>
              <div><dt className="mono">Tag a commit</dt><dd>Label a known-good state and return to it in one click.</dd></div>
              <div><dt className="mono">Staged turns</dt><dd>Nothing lands on the branch until you press Commit; a pending diff shows what will land.</dd></div>
              <div><dt className="mono">Export as plain prompt</dt><dd>Take any branch&apos;s context into any other tool.</dd></div>
            </dl>
          </div>
        </section>

        <section className="section section-night" id="merge" data-section aria-labelledby="merge-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">05</span>Merge engine</p>
              <h2 id="merge-title">The hard part: merging meaning, not lines.</h2>
              <p className="lede">A branch is not a patch. ContextGit pulls out decisions, facts, dead ends and open questions, flags contradictions, and never resolves a conflict without you.</p>
            </header>

            <div className="merge-grid">
              <div className="merge-steps reveal">
                <h3 className="minor">The algorithm</h3>
                <ol className="steps" id="merge-steps">
                  <li data-done="true"><span className="step-no mono">1</span>Find the common ancestor.</li>
                  <li data-done="true"><span className="step-no mono">2</span>Collect source commits since the ancestor.</li>
                  <li data-done="true"><span className="step-no mono">3</span>Extract decisions, facts, dead ends and open questions.</li>
                  <li data-done="true"><span className="step-no mono">4</span>Detect conflicts against the target branch.</li>
                  <li data-done="true"><span className="step-no mono">5</span>Write a compact summary and show a preview.</li>
                  <li data-done="false" id="step-apply"><span className="step-no mono">6</span>On approval, create a merge commit with two parents.</li>
                </ol>
                <p className="steps-note">Prompts are versioned text files. Output is structured JSON, validated before it reaches the preview.</p>
              </div>

              <form className="dialog reveal" id="merge-dialog" style={d(80)} noValidate aria-labelledby="dialog-title" data-state="idle">
                <div className="dialog-head">
                  <h3 id="dialog-title" className="dialog-title">Merge <span className="mono">redis-bucket</span> into <span className="mono">main</span></h3>
                  <p className="mono dialog-meta">ancestor 1d6c9a0 &middot; 2 source commits</p>
                </div>

                <div className="extract">
                  <div className="extract-col">
                    <h4 className="extract-title"><span className="extract-tag mono">decisions</span></h4>
                    <ul>
                      <li>Token bucket in Redis, one Lua call per request.</li>
                      <li>Refill rate comes from the key&apos;s plan, read once a minute.</li>
                    </ul>
                  </div>
                  <div className="extract-col">
                    <h4 className="extract-title"><span className="extract-tag mono">facts</span></h4>
                    <ul>
                      <li>Clock skew across regions is tolerated up to 50 ms.</li>
                      <li>The Lua script is atomic per key.</li>
                    </ul>
                  </div>
                  <div className="extract-col">
                    <h4 className="extract-title"><span className="extract-tag mono">dead ends</span></h4>
                    <ul>
                      <li>Sliding window log: memory grows with traffic.</li>
                    </ul>
                  </div>
                  <div className="extract-col">
                    <h4 className="extract-title"><span className="extract-tag mono">open</span></h4>
                    <ul>
                      <li>Fail open or fail closed when Redis is unreachable?</li>
                    </ul>
                  </div>
                </div>

                <fieldset className="conflict" id="conflict" tabIndex={-1}>
                  <legend><span className="conflict-flag mono">1 conflict</span> Logging policy</legend>
                  <div className="sides">
                    <label className="side">
                      <input type="radio" name="resolution" value="target" />
                      <span className="side-body">
                        <span className="side-label mono">Keep target &middot; main &middot; 5d2f8e1</span>
                        <span className="side-text">Log every allow and deny decision for audit.</span>
                      </span>
                    </label>
                    <label className="side">
                      <input type="radio" name="resolution" value="source" />
                      <span className="side-body">
                        <span className="side-label mono">Keep source &middot; redis-bucket &middot; 4c07a1e</span>
                        <span className="side-text">Counters only. No per-request logging, to protect p99.</span>
                      </span>
                    </label>
                    <label className="side side-wide">
                      <input type="radio" name="resolution" value="edit" />
                      <span className="side-body">
                        <span className="side-label mono">Edit the summary line</span>
                        <span className="side-text">Write the line that goes into the merge commit.</span>
                      </span>
                    </label>
                  </div>
                  <div className="edit-field" id="edit-field" hidden>
                    <label htmlFor="edit-summary">Summary line for the merge commit</label>
                    <textarea id="edit-summary" rows={2} defaultValue="Log deny decisions only. Allow decisions are counted, not logged." />
                  </div>
                </fieldset>

                <p className="dialog-error" id="merge-error" role="alert" hidden></p>

                <div className="dialog-actions">
                  <button type="submit" className="btn btn-signal" id="merge-apply">Apply merge</button>
                  <button type="button" className="btn btn-ghost-night" id="merge-reset">Reset preview</button>
                </div>

                <div className="dialog-done" id="merge-done" tabIndex={-1} role="status" hidden>
                  <p className="done-title mono">f10c7a6 &middot; merge commit created</p>
                  <dl className="done-grid">
                    <div><dt>Parents</dt><dd className="mono">5d2f8e1, 4c07a1e</dd></div>
                    <div><dt>Context on main</dt><dd>2,318 tokens</dd></div>
                    <div><dt>If concatenated</dt><dd>5,108 tokens</dd></div>
                  </dl>
                  <p className="done-note">The redis-bucket branch and its commits are untouched. Deleting a branch never deletes commits.</p>
                </div>
                <MergeDialog />
              </form>
            </div>
          </div>
        </section>

        <section className="section section-tint" id="pricing" data-section aria-labelledby="pricing-teaser-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">06</span>Pricing</p>
              <h2 id="pricing-teaser-title">Free on your machine. Paid to scale.</h2>
              <p className="lede">
                The whole local workbench is free, forever — unlimited projects, runs and
                commits, no account. Pro adds the security audit, cloud sync and cloud agents;
                Team adds collaboration. No numbers yet — early access.
              </p>
            </header>

            <div className="reveal"><PricingTiers compact limit={4} /></div>

            <p className="pricing-more reveal" style={d(80)}>
              <a className="btn btn-primary" href="/pricing">See full pricing <span aria-hidden="true">&rarr;</span></a>
            </p>
          </div>
        </section>

        <section className="section section-end" id="install" data-section aria-labelledby="install-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">07</span>Questions</p>
              <h2 id="install-title">Before you try it.</h2>
            </header>

            <div className="faq reveal">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>

            <div className="cta reveal">
              <h2 className="cta-title">One window. Every agent. Context you can keep.</h2>
              <p className="cta-lede">Run it from source in five minutes, or start with the CLI. It all stays on your machine.</p>
              <div className="cta-actions">
                <a className="btn btn-signal" href="/download">Download <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-link-cta" href={GITHUB}>View on GitHub <span aria-hidden="true">&rarr;</span></a>
              </div>
              <p className="fineprint cta-fine">Early build. Everything stays on your machine except the model calls you make.</p>
            </div>
          </div>
        </section>

      </main>

      <SiteFooter links={FOOTER_LINKS} />

      <CopyButtons />
      <Effects />
    </>
  );
}
