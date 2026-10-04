import { FLEET } from "@/lib/landing";

/**
 * A windowed mock of the ContextGit Code tab. Static on purpose: it is a
 * described image of the real flow (mode switch, runs rail, terminal panes,
 * run inspector + merge queue), not a claim of live interactivity.
 */
export default function AppDemo() {
  return (
    <div
      className="app-demo"
      role="img"
      aria-label="The ContextGit Code tab: a Single and Team switch in the title bar, a rail of runs grouped by agent with status lights, terminal panes for two agents mid-run, and an inspector with the run details and the merge queue."
    >
      <div className="app-demo-bar">
        <span className="app-demo-brand">
          Context<b>Git</b>
        </span>
        <span className="app-demo-modes" aria-hidden="true">
          <span data-on="false">Single</span>
          <span data-on="true">Team</span>
        </span>
        <span className="app-demo-spacer" />
        <span className="app-demo-hint mono">⌘K</span>
        <span className="app-demo-toggle" aria-hidden="true" />
      </div>

      <div className="app-demo-body">
        <aside className="app-demo-rail">
          <p className="app-demo-heading">
            Runs <span className="app-demo-count">{FLEET.length}</span>
          </p>
          {FLEET.map((run) => (
            <div key={run.branch} className="app-demo-run" data-status={run.status}>
              <span className="app-demo-mark" aria-hidden="true">
                {run.mark}
              </span>
              <span className="app-demo-run-copy">
                <span className="app-demo-run-name">{run.branch.replace("ctx/", "")}</span>
                <span className="app-demo-run-meta mono">
                  {run.role} · {run.files} files
                </span>
              </span>
              <span className="app-demo-dot" aria-hidden="true" />
            </div>
          ))}
        </aside>

        <div className="app-demo-canvas">
          <div className="app-demo-pane">
            <div className="app-demo-phead">
              <span className="app-demo-mark" data-agent="claude" aria-hidden="true">
                C
              </span>
              <span className="app-demo-pname">ctx/frontend</span>
              <span className="app-demo-spacer" />
              <span className="app-demo-chip mono">12 staged</span>
              <span className="app-demo-dot" data-status="running" aria-hidden="true" />
            </div>
            <pre className="app-demo-term mono">
              {"▐▛███▜▌  Claude Code\n\n> tighten the subscription guard\n\n⏺ Read(src/common/guards/subscription.guard.ts)\n  ⎿ Read 84 lines\n⏺ Update(...)  +3 −1\n  ⎿ Running npm run test -- subscription\nTesting… (esc to interrupt)"}
            </pre>
          </div>
          <div className="app-demo-pane">
            <div className="app-demo-phead">
              <span className="app-demo-mark" data-agent="codex" aria-hidden="true">
                X
              </span>
              <span className="app-demo-pname">ctx/api-contract</span>
              <span className="app-demo-spacer" />
              <span className="app-demo-chip mono">merged</span>
              <span className="app-demo-dot" data-status="merged" aria-hidden="true" />
            </div>
            <pre className="app-demo-term mono">
              {">_ OpenAI Codex\n\ndirectory: ~/Projects/portal\n\n› write the e2e for the cancelled tier\n\n• Edited test/subscription.e2e-spec.ts (+41 -0)\n• Ran npm run test:e2e\n  └ PASS  cancelled tier gets 403\n96% context left"}
            </pre>
          </div>
        </div>

        <aside className="app-demo-dock">
          <p className="app-demo-heading">Run</p>
          <div className="app-demo-kv">
            <span>Branch</span>
            <code className="mono">ctx/frontend</code>
          </div>
          <div className="app-demo-kv">
            <span>Status</span>
            <span className="app-demo-state">
              <span className="app-demo-dot" data-status="running" aria-hidden="true" />
              working
            </span>
          </div>
          <div className="app-demo-kv">
            <span>Staged</span>
            <span className="mono">12</span>
          </div>

          <p className="app-demo-heading">Merge queue</p>
          <ul className="app-demo-queue">
            <li data-state="done">
              <span className="mono">ctx/api-contract</span>
            </li>
            <li data-state="next">
              <span className="mono">ctx/frontend</span>
            </li>
            <li data-state="blocked">
              <span className="mono">ctx/tests</span>
            </li>
          </ul>
          <span className="app-demo-btn">Integrate code + context</span>
        </aside>
      </div>
    </div>
  );
}
