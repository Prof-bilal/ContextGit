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
import { AGENTS, FOOTER_LINKS, GITHUB, HEADER_CTA, NAV } from "@/lib/site";

export const metadata: Metadata = {
  title: "ContextGit — run agents, keep the work",
  description:
    "ContextGit is a local-first desktop workbench for terminal AI agents and Git: run agents, review diffs, checkpoint progress, and recover the work.",
};

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const FAQ: Array<[string, React.ReactNode]> = [
  [
    "What does ContextGit do?",
    <>It gives terminal-agent work a visible, recoverable home: each run has its own workspace, changes are reviewable as Git diffs, and useful states can be checkpointed, branched, merged, or rolled back.</>,
  ],
  [
    "Does it replace my editor or agent?",
    <>No. ContextGit launches the terminal agents you already use and works alongside the editor you already have. The beta focuses on terminal sessions and Git context.</>,
  ],
  [
    "Where does my data go?",
    <>Commits live in a local SQLite file. The only network traffic is the calls you make to your chosen model provider.</>,
  ],
  [
    "Which agents does it run?",
    <>It can launch installed shell and terminal agents, including Claude Code, Codex, OpenCode, Gemini CLI, Aider, Ollama, Cline, Pi, Kilo Code, Command Code, and a plain shell. Terminal support, usage reporting, and transcript capture are separate capabilities.</>,
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
    "Is transcript capture supported?",
    <>Capture is verified per agent. OpenCode is the first fully verified integration; other agents remain usable as terminals until their capture path is tested.</>,
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
          <li><a href="#workbench" data-label="How it works"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">02</span><span className="rail-label">How it works</span></a></li>
          <li><a href="#agents" data-label="Agents"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">03</span><span className="rail-label">Agents</span></a></li>
          <li><a href="#context" data-label="Recovery"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">04</span><span className="rail-label">Recovery</span></a></li>
          <li><a href="#merge" data-label="Review"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">05</span><span className="rail-label">Review</span></a></li>
          <li><a href="#trust" data-label="Trust"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">06</span><span className="rail-label">Trust</span></a></li>
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
            <p className="eyebrow reveal"><span className="chip">Beta · 0.1.0</span><span>Local-first terminal + Git workbench</span></p>
            <h1 id="hero-title" className="reveal" style={d(60)}>
              <span className="h1-a">Run your AI agents.</span>
              <span className="h1-b">Keep the work.</span>
            </h1>
            <p className="lede hero-lede reveal" style={d(120)}>
              ContextGit is a local-first desktop workbench for terminal AI agents and Git. Give every run its own workspace, review the diff, checkpoint progress, and recover the decisions that mattered.
            </p>
            <div className="hero-actions reveal" style={d(180)}>
              <a className="btn btn-primary" href="/download">Download the beta <span aria-hidden="true">&rarr;</span></a>
              <a className="btn btn-ghost" href="#workbench">See how it works</a>
            </div>
            <p className="fineprint reveal" style={d(200)}>Unsigned beta for Windows, macOS, and Linux. No account required. Open source under Apache-2.0.</p>

            <ul className="trust-strip reveal" style={d(220)}>
              <li>Local-first</li>
              <li>Apache-2.0</li>
              <li>Bring your agent</li>
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
              <p className="eyebrow"><span className="eyebrow-no">02</span>How it works</p>
              <h2 id="workbench-title">From agent run to recoverable work.</h2>
              <p className="lede">
                Keep the terminal workflow you already know. ContextGit adds the missing layer around it: isolated runs, visible changes, and Git-backed checkpoints.
              </p>
            </header>

            <div className="reveal" style={d(60)}>
              <WorkbenchTabs />
            </div>

            <ul className="pillars reveal" style={d(120)}>
              <li>
                <h3 className="pillar-title">Run</h3>
                <p>Launch an installed terminal agent in its own workspace.</p>
              </li>
              <li>
                <h3 className="pillar-title">Review</h3>
                <p>See the terminal output, changed files, branch, and diff together.</p>
              </li>
              <li>
                <h3 className="pillar-title">Recover</h3>
                <p>Checkpoint, branch, merge, or roll back without losing the original work.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="section section-tint" id="agents" data-section aria-labelledby="fleet-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">03</span>Agents</p>
              <h2 id="fleet-title">Use the agents you already have.</h2>
              <p className="lede">
                Each run gets its own worktree and branch. ContextGit shows what changed and flags overlap before anything merges.
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
                  <strong>Bring your own setup</strong>
                  <span>Use your installed CLI and model provider. ContextGit does not ask you to switch agents or create another account.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="context" data-section aria-labelledby="context-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">04</span>Recovery</p>
              <h2 id="context-title">Useful work should never disappear into a chat scroll.</h2>
              <p className="lede">
                Checkpoints give agent work a concrete history. Branch from a useful moment, compare approaches, keep a dead end for reference, and return to a known-good state.
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
              <p className="eyebrow"><span className="eyebrow-no">05</span>Review before merge</p>
              <h2 id="merge-title">You stay in control of what lands.</h2>
              <p className="lede">ContextGit shows the proposed changes and context before a merge. Conflicts are surfaced for you to decide; the original branch stays intact.</p>
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

        <section className="section section-tint" id="trust" data-section aria-labelledby="trust-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">06</span>Trust</p>
              <h2 id="trust-title">Simple to understand. Local by default.</h2>
              <p className="lede">
                The beta needs no ContextGit account. Your history is stored locally, and the app works with the Git and terminal setup you already use.
              </p>
            </header>
            <ul className="pillars trust-pillars reveal" style={d(80)}>
              <li><h3 className="pillar-title">No account</h3><p>Start locally without a ContextGit sign-in.</p></li>
              <li><h3 className="pillar-title">Your provider</h3><p>Use the model keys and agent accounts you already chose.</p></li>
              <li><h3 className="pillar-title">Honest support</h3><p>Terminal support, usage reporting, and transcript capture are labeled separately.</p></li>
            </ul>
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
              <h2 className="cta-title">Start with a local beta.</h2>
              <p className="cta-lede">Run an agent, inspect the diff, and keep the checkpoint. Download the unsigned beta for Windows, macOS, or Linux.</p>
              <div className="cta-actions">
                <a className="btn btn-signal" href="/download">Download beta <span aria-hidden="true">&rarr;</span></a>
                <a className="btn btn-link-cta" href={GITHUB}>View on GitHub <span aria-hidden="true">&rarr;</span></a>
              </div>
              <p className="fineprint cta-fine">Verify the SHA-256 checksum before installing. Expect rough edges and tell us what broke.</p>
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
