import type { CSSProperties } from "react";
import HeroGraph from "@/components/hero-graph";
import MiniGraph from "@/components/mini-graph";
import WorkflowTabs from "@/components/workflow-tabs";
import MergeDialog from "@/components/merge-dialog";
import HashDemo from "@/components/hash-demo";
import CopyButtons from "@/components/copy-buttons";
import Effects from "@/components/effects";
import FleetCanvas from "@/components/fleet-canvas";
import AppDemo from "@/components/app-demo";
import ThemeToggle from "@/components/theme-toggle";

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const AGENT_MARQUEE = ["Claude Code", "Codex", "Gemini CLI", "OpenCode", "Aider", "Ollama", "Shell"];

export default function Page() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="topbar">
        <div className="topbar-inner">
          <a className="logo" href="#top" aria-label="ContextGit, back to top">
            <svg className="logo-mark" viewBox="0 0 32 32" width={28} height={28} aria-hidden="true" focusable="false">
              <rect width={32} height={32} rx={7} fill="currentColor" />
              <path d="M9 8v16M9 12c0 6 14 2 14 8" fill="none" stroke="var(--paper)" strokeWidth={2.4} strokeLinecap="round" />
              <circle cx={9} cy={8} r={2.6} fill="var(--paper)" />
              <circle cx={9} cy={24} r={2.6} fill="var(--paper)" />
              <circle cx={23} cy={20} r={3} fill="var(--signal)" />
            </svg>
            <span className="logo-word">Context<span className="logo-git">Git</span></span>
          </a>
          <details className="menu">
            <summary>Sections</summary>
            <ol className="menu-list">
              <li><a href="#top">Overview</a></li>
              <li><a href="#fleet">Control tower</a></li>
              <li><a href="#problem">The problem</a></li>
              <li><a href="#workflow">Workflow</a></li>
              <li><a href="#merge">Merge engine</a></li>
              <li><a href="#interface">Interface</a></li>
              <li><a href="#internals">Internals</a></li>
              <li><a href="#status">Status</a></li>
              <li><a href="#install">Install</a></li>
            </ol>
          </details>
          <ThemeToggle />
          <a className="btn btn-primary btn-sm" href="#install">Install</a>
        </div>
      </header>

      <nav className="rail" aria-label="Page sections">
        <ol>
          <li><a href="#top" data-label="Overview"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">01</span><span className="rail-label">Overview</span></a></li>
          <li><a href="#fleet" data-label="Control tower"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">02</span><span className="rail-label">Control tower</span></a></li>
          <li><a href="#problem" data-label="The problem"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">03</span><span className="rail-label">The problem</span></a></li>
          <li><a href="#workflow" data-label="Workflow"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">04</span><span className="rail-label">Workflow</span></a></li>
          <li><a href="#merge" data-label="Merge engine"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">05</span><span className="rail-label">Merge engine</span></a></li>
          <li><a href="#interface" data-label="Interface"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">06</span><span className="rail-label">Interface</span></a></li>
          <li><a href="#internals" data-label="Internals"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">07</span><span className="rail-label">Internals</span></a></li>
          <li><a href="#status" data-label="Status"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">08</span><span className="rail-label">Status</span></a></li>
          <li><a href="#install" data-label="Install"><span className="rail-node" aria-hidden="true"></span><span className="rail-no">09</span><span className="rail-label">Install</span></a></li>
        </ol>
      </nav>

      <span className="sr-only" id="copy-status" role="status" aria-live="polite"></span>

      <main id="main">

        <section className="hero" id="top" data-section aria-labelledby="hero-title">
          <div className="hero-bg" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          <div className="wrap">
            <p className="eyebrow reveal"><span className="chip">Local-first</span><span>Version control for AI work</span></p>
            <h1 id="hero-title" className="reveal" style={d(60)}>
              <span className="h1-a">Run a team of agents.</span>
              <span className="h1-b">Keep every branch that worked.</span>
            </h1>
            <p className="lede hero-lede reveal" style={d(120)}>
              ContextGit gives each coding agent its own git worktree, flags collisions before they merge, and records every conversation as branchable commits. A dead end costs one branch, not the whole context.
            </p>
            <div className="hero-actions reveal" style={d(180)}>
              <a className="btn btn-primary" href="#status">Get the desktop app <span aria-hidden="true">&rarr;</span></a>
              <a className="btn btn-ghost" href="#merge">Watch a merge resolve</a>
              <div className="install">
                <code>pip install contextgit</code>
                <button type="button" className="btn btn-ghost btn-copy" data-copy="pip install contextgit" aria-label="Copy install command">Copy</button>
              </div>
            </div>
            <p className="fineprint reveal" style={d(220)}>Runs on your machine. Early build, so expect rough edges.</p>

            <p className="demo-label reveal" style={d(240)}>Interactive demo <span className="demo-note">· sample data</span></p>
            <div className="reveal" style={d(260)}>
              <AppDemo />
            </div>
            <div className="marquee reveal" style={d(320)} aria-label="Works with common coding agents">
              <ul className="marquee-track">
                {[...AGENT_MARQUEE, ...AGENT_MARQUEE].map((agent, index) => (
                  <li key={`${agent}-${index}`}>{agent}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="section section-tint" id="fleet" data-section aria-labelledby="fleet-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">02</span>Control tower</p>
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
                  <span>Merging a run lands its diff and its reasoning in one step.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="problem" data-section aria-labelledby="problem-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">03</span>The problem</p>
              <h2 id="problem-title">A chat is one line. Real thinking is a tree.</h2>
              <p className="lede">You explore, backtrack, compare and decide. Every chat app flattens that into a single scroll, and the cost shows up around message 30.</p>
            </header>

            <div className="problem-grid">
              <div className="problem-aside reveal">
                <h3 className="minor">Where it hurts</h3>
                <ul className="plain">
                  <li><strong>Agentic coding.</strong> One wrong turn poisons the next fifty tool calls.</li>
                  <li><strong>Research.</strong> Two hypotheses share one context and bleed into each other.</li>
                  <li><strong>Prompt work.</strong> You cannot A/B a change without losing your place.</li>
                </ul>
                <p className="aside-note">Same conversation below, shown message by message: a plain chat on the left of each row, ContextGit on the right.</p>
              </div>

              <div className="table-wrap reveal" style={d(80)}>
                <table className="diverge">
                  <caption className="sr-only">Six moments in a long LLM conversation, and what ContextGit does at each one</caption>
                  <thead>
                    <tr><th scope="col">Message</th><th scope="col">In a plain chat</th><th scope="col">In ContextGit</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" className="mono">14</th>
                      <td>You land on a design you like and keep talking. That state is gone the moment you send the next message.</td>
                      <td><code className="verb">tag</code> the commit as known-good and return to it in one step.</td>
                    </tr>
                    <tr>
                      <th scope="row" className="mono">17</th>
                      <td>You want to try Redis and in-process counters. In one thread, the second attempt inherits the first.</td>
                      <td><code className="verb">branch</code> from the same commit. Each idea gets a clean context.</td>
                    </tr>
                    <tr>
                      <th scope="row" className="mono">22</th>
                      <td>In-memory counters fail under failover. The attempt stays in the thread, spending tokens forever.</td>
                      <td><code className="verb">note</code> records the dead end and why it failed, in a few lines.</td>
                    </tr>
                    <tr>
                      <th scope="row" className="mono">27</th>
                      <td>The model suggests in-memory counters again. It has no reason to remember they failed.</td>
                      <td><code className="verb">merge</code> carries dead ends into the target branch inside the summary.</td>
                    </tr>
                    <tr>
                      <th scope="row" className="mono">31</th>
                      <td>The model proposes 1,000 requests per minute. You set 100 at message 9. Nothing flags it.</td>
                      <td><code className="verb">conflict</code> detection shows both decisions side by side before anything lands.</td>
                    </tr>
                    <tr>
                      <th scope="row" className="mono">38</th>
                      <td>The context is 94% full. Your options are starting over or pasting a lossy summary.</td>
                      <td><code className="verb">export</code> the branch as a plain prompt, or merge the work into one compact commit.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-tint" id="workflow" data-section aria-labelledby="workflow-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">04</span>Workflow</p>
              <h2 id="workflow-title">Five verbs you already know.</h2>
              <p className="lede">Commit, branch, diff, merge, roll back. The CLI mirrors git, so the first session needs no manual.</p>
            </header>

            <div className="verbs reveal" data-tabs>
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

        <section className="section" id="interface" data-section aria-labelledby="interface-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">06</span>Interface</p>
              <h2 id="interface-title">Three panels, one conversation tree.</h2>
              <p className="lede">The desktop app puts sessions, history and an inspector on one screen — with parallel agent terminals in the sidebar. Click a commit and the chat becomes that moment.</p>
            </header>

            <figure className="app reveal" aria-labelledby="app-cap">
              <div className="app-grid" aria-hidden="true">
                <div className="panel panel-graph">
                  <p className="panel-title mono">Graph</p>
                  <MiniGraph />
                </div>
                <div className="panel panel-chat">
                  <p className="panel-title mono">Chat <span className="panel-sub">redis-bucket &middot; 4c07a1e</span></p>
                  <div className="msg msg-user">
                    <p className="msg-role mono">you</p>
                    <p>Skew between regions can reach 40 ms. Does the token bucket still hold?</p>
                  </div>
                  <div className="msg msg-ai">
                    <p className="msg-role mono">assistant</p>
                    <p id="typed">Yes, if refill reads Redis server time instead of the client clock. Compute tokens inside the Lua script with TIME, so every region sees one clock. Skew then only affects how fast a key&apos;s state replicates, and the bucket tolerates up to 50 ms of that.</p>
                  </div>
                  <div className="composer"><span className="composer-input">Message redis-bucket</span><span className="composer-send mono">Send</span></div>
                </div>
                <div className="panel panel-inspect">
                  <p className="panel-title mono">Inspector</p>
                  <dl className="kv">
                    <div><dt>Commit</dt><dd className="mono">4c07a1e</dd></div>
                    <div><dt>Branch</dt><dd className="mono">redis-bucket</dd></div>
                    <div><dt>Messages</dt><dd>4 in commit, 9 in context</dd></div>
                  </dl>
                  <div className="budget">
                    <p className="budget-label"><span>Token budget</span><span className="mono">4,632 / 8,000</span></p>
                    <div className="budget-bar"><span style={{ width: "58%" }}></span></div>
                  </div>
                  <p className="insp-sum">Refill reads Redis server time. Tolerates 50 ms of replication skew. Counters only, no per-request logging.</p>
                  <p className="health"><span className="health-tag mono">health &middot; planned</span>Possible contradiction with 7be04d8: burst of 20 versus a strict 100 per minute.</p>
                </div>
              </div>
              <figcaption id="app-cap">Illustrative layout. Graph on the left, chat at the selected commit in the middle, tokens, summary and warnings on the right.</figcaption>
            </figure>

            <dl className="actions-list reveal">
              <div><dt className="mono">Branch from any message</dt><dd>Fork at the exact message where the conversation went somewhere new.</dd></div>
              <div><dt className="mono">Compare mode</dt><dd>Send one prompt to two branches and read the answers side by side.</dd></div>
              <div><dt className="mono">Cherry-pick</dt><dd>Bring a single commit from one branch onto another.</dd></div>
              <div><dt className="mono">Tag a commit</dt><dd>Label a known-good state and return to it in one click.</dd></div>
              <div><dt className="mono">Token budget bar</dt><dd>See what a branch costs before you send the next message.</dd></div>
              <div><dt className="mono">Export as plain prompt</dt><dd>Take any branch&apos;s context into any other tool.</dd></div>
            </dl>

            <p className="build-note reveal">Built to stay usable at 500 commits by collapsing linear chains. The graph is fully keyboard navigable, and branches carry text labels, never color alone.</p>
          </div>
        </section>

        <section className="section section-tint" id="internals" data-section aria-labelledby="internals-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">07</span>Internals</p>
              <h2 id="internals-title">Immutable commits, one source of truth.</h2>
              <p className="lede">The same ideas that make git trustworthy, applied to messages. The core library owns every rule. The CLI and the API are thin wrappers.</p>
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

              <div className="hash-demo reveal" style={d(80)}>
                <h3 className="minor">Change one character, get a different commit</h3>
                <HashDemo />
              </div>
            </div>

            <ul className="principles reveal">
              <li><h3 className="principle-title">Local-first</h3><p>Everything lives in one SQLite file on your machine. Only the LLM calls leave it.</p></li>
              <li><h3 className="principle-title">Provider-agnostic</h3><p>Every call goes through one adapter. A new provider is one new file.</p></li>
              <li><h3 className="principle-title">Streaming</h3><p>Chat replies stream over server-sent events and append token by token.</p></li>
              <li><h3 className="principle-title">Out of scope, for now</h3><p>Multi-user auth, cloud sync and real-time collaboration.</p></li>
            </ul>
          </div>
        </section>

        <section className="section" id="status" data-section aria-labelledby="status-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">08</span>Status</p>
              <h2 id="status-title">Merge quality is measured, not assumed.</h2>
              <p className="lede">Before and after every merge, a fixed set of probe questions checks what the summary kept. A lost fact becomes a failing eval.</p>
            </header>

            <div className="eval reveal">
              <div className="table-wrap">
                <table className="eval-table">
                  <caption>Example probe run: one merge, four questions</caption>
                  <thead>
                    <tr><th scope="col">Probe question</th><th scope="col">Answer on source branch</th><th scope="col">Answer on main after merge</th><th scope="col">Result</th></tr>
                  </thead>
                  <tbody>
                    <tr><th scope="row">Where do counters live?</th><td>Redis, per region</td><td>Redis, per region</td><td><span className="result result-ok"><span aria-hidden="true">&#10003;</span> Retained</span></td></tr>
                    <tr><th scope="row">What skew is tolerated?</th><td>50 ms</td><td>50 ms</td><td><span className="result result-ok"><span aria-hidden="true">&#10003;</span> Retained</span></td></tr>
                    <tr><th scope="row">Is per-request logging on?</th><td>No, counters only</td><td>No, counters only</td><td><span className="result result-ok"><span aria-hidden="true">&#10003;</span> Retained</span></td></tr>
                    <tr><th scope="row">What was rejected, and why?</th><td>Sliding window log, memory grows</td><td>No mention</td><td><span className="result result-lost"><span aria-hidden="true">&#10005;</span> Lost</span></td></tr>
                  </tbody>
                </table>
              </div>
              <p className="eval-summary">3 of 4 retained. The lost dead end fails the eval, and the merge prompt is revised until it passes. Real runs live in <code className="mono">tests/evals/</code>.</p>
            </div>

            <div className="roadmap-head reveal">
              <h3 className="minor">Status</h3>
              <p className="roadmap-honest">What has shipped, and what is next. Team mode is planned, not built.</p>
            </div>

            <ol className="roadmap reveal">
              <li className="phase" data-status="done">
                <p className="phase-meta mono">Shipped &middot; <span className="phase-status">Core</span></p>
                <h4 className="phase-title">Conversation git</h4>
                <ul className="tasks">
                  <li>Data model, SHA-256 commits, SQLite storage</li>
                  <li>init, commit, branch, checkout, log, diff</li>
                  <li>Semantic merge with a conflict preview</li>
                  <li>CLI, FastAPI, and the desktop app</li>
                </ul>
              </li>
              <li className="phase" data-status="done">
                <p className="phase-meta mono">Shipped &middot; <span className="phase-status">Agents</span></p>
                <h4 className="phase-title">Parallel runs</h4>
                <ul className="tasks">
                  <li>One git worktree and branch per run</li>
                  <li>Fleet visibility: changed files and overlaps</li>
                  <li>Claims, scopes, and a managed AGENTS.md block</li>
                  <li>Merge queue with a conflict pre-check</li>
                  <li>Paired code and context merge</li>
                </ul>
              </li>
              <li className="phase" data-status="next">
                <p className="phase-meta mono">Next &middot; <span className="phase-status">Team</span></p>
                <h4 className="phase-title">Team mode</h4>
                <ul className="tasks">
                  <li>Tasks, roles and dependencies</li>
                  <li>A shared board and an MCP channel</li>
                  <li>An independent verifier before merge</li>
                  <li>Per-worktree ports, budgets and limits</li>
                </ul>
              </li>
              <li className="phase" data-status="planned">
                <p className="phase-meta mono">Later &middot; <span className="phase-status">Polish</span></p>
                <h4 className="phase-title">Polish</h4>
                <ul className="tasks">
                  <li>Cherry-pick, tags, export and import</li>
                  <li>Context health checks</li>
                  <li>Multi-model per branch</li>
                </ul>
              </li>
            </ol>
            <p className="parking reveal"><span className="mono">Parking lot</span> Token-aware merge suggestions &middot; plugin API for other chat apps &middot; an A2A bridge for remote peers</p>
          </div>
        </section>

        <section className="section section-end" id="install" data-section aria-labelledby="install-title">
          <div className="wrap">
            <header className="section-head reveal">
              <p className="eyebrow"><span className="eyebrow-no">09</span>Questions</p>
              <h2 id="install-title">Before you try it.</h2>
            </header>

            <div className="faq reveal">
              <details>
                <summary>Isn&apos;t this just summarizing my chat?</summary>
                <p>A summary replaces history. ContextGit keeps history as immutable commits and only summarizes at merge time, with a preview, a conflict check and the full branch still intact.</p>
              </details>
              <details>
                <summary>Is a merge lossless?</summary>
                <p>No. A merge is a compact summary of decisions, facts, dead ends and open questions. That is why the original branch is never deleted, and why merge quality is tracked with probe questions.</p>
              </details>
              <details>
                <summary>Where does my data go?</summary>
                <p>Commits live in a local SQLite file. The only network traffic is the calls you make to your chosen LLM provider.</p>
              </details>
              <details>
                <summary>Which models does it work with?</summary>
                <p>Any model with an adapter. Every LLM call goes through one provider interface, so supporting a new provider means writing one new file. Phase 1 ships a fake provider for tests and one real adapter.</p>
              </details>
              <details>
                <summary>Can I use it with the chat app I already have?</summary>
                <p>Not yet. A plugin API for other chat apps is on the parking lot, and any branch can already be exported as a plain prompt.</p>
              </details>
              <details>
                <summary>Does it support teams?</summary>
                <p>Not for now. Multi-user auth, cloud sync and real-time collaboration are out of scope until the single-user core is solid.</p>
              </details>
            </div>

            <div className="cta reveal">
              <h2 className="cta-title">Keep the branch that worked. Drop the one that did not.</h2>
              <p className="cta-lede">Start with the CLI. Add the graph when you want to see the tree.</p>
              <div className="cta-actions">
                <div className="install install-night">
                  <code>pip install contextgit</code>
                  <button type="button" className="btn btn-copy-cta" data-copy="pip install contextgit" aria-label="Copy install command">Copy</button>
                </div>
                <a className="btn btn-link-cta" href="#status">Read the roadmap <span aria-hidden="true">&rarr;</span></a>
              </div>
              <p className="fineprint cta-fine">Pre-release. Everything stays on your machine except the model calls you make.</p>
            </div>
          </div>
        </section>

      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div>
            <p className="footer-brand">ContextGit</p>
            <p className="footer-tag">Version control for LLM conversations.</p>
          </div>
          <ul className="footer-links">
            <li><a href="#problem">The problem</a></li>
            <li><a href="#workflow">Workflow</a></li>
            <li><a href="#merge">Merge engine</a></li>
            <li><a href="#interface">Interface</a></li>
            <li><a href="#internals">Internals</a></li>
            <li><a href="#status">Status</a></li>
          </ul>
          <p className="footer-fine">Local-first. Your history stays in a SQLite file on your machine.</p>
        </div>
      </footer>

      <CopyButtons />
      <Effects />
    </>
  );
}
