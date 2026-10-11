"use client";

import { useState } from "react";
import { FLEET, type FleetStatus } from "@/lib/landing";

/**
 * Interactive demo of the ContextGit Code tab, sample data only.
 *
 * Three columns like the real workbench: a rail of runs, the selected run's
 * terminal, and a dock with its changes and the merge queue. Click any run in
 * the rail (or use arrow keys) to switch what the window shows.
 */

const STATUS_LABEL: Record<FleetStatus, string> = {
  running: "working",
  blocked: "blocked · overlap",
  merged: "merged into main",
  idle: "idle · waiting",
};

const DETAIL: Record<
  string,
  { agent: string; term: string; add: number; del: number; files: Array<{ path: string; add: number; del: number }> }
> = {
  "ctx/api-contract": {
    agent: "Claude Code",
    term:
      "▐▛███▜▌  Claude Code\n\n> add the subscription guard to the PRO routes\n\n⏺ Read(src/common/guards/subscription.guard.ts)\n  ⎿ Read 84 lines\n⏺ Update(...)  +3 −1\n⏺ Bash(npm run test -- subscription)\n  ⎿ PASS  12 passed (4.1s)\n\nGuard landed with its regression test.\nMerged into main · 1m 12s",
    add: 54,
    del: 4,
    files: [
      { path: "src/common/guards/subscription.guard.ts", add: 9, del: 3 },
      { path: "test/subscription.e2e-spec.ts", add: 41, del: 0 },
      { path: "docs/guards.md", add: 4, del: 1 },
    ],
  },
  "ctx/frontend": {
    agent: "OpenAI Codex",
    term:
      ">_ OpenAI Codex\n\ndirectory: ~/Projects/portal\n\n› write the e2e for the cancelled tier\n\n• Edited test/subscription.e2e-spec.ts (+41 -0)\n• Ran npm run test:e2e\n  └ PASS  cancelled tier gets 403\n\n96% context left · working (esc to interrupt)",
    add: 56,
    del: 1,
    files: [
      { path: "test/subscription.e2e-spec.ts", add: 41, del: 0 },
      { path: "src/portal/routes.ts", add: 12, del: 1 },
      { path: "src/portal/toast.ts", add: 3, del: 0 },
    ],
  },
  "ctx/tests": {
    agent: "Gemini CLI",
    term:
      "◆ Gemini CLI\n\n> cover the billing edge cases\n\n◇ Read tests/billing.spec.ts\n◇ Edit src/types/api.ts  +6 −2\n  ⎿ claim conflict: src/types/api.ts\n    also claimed by ctx/frontend\n\nWaiting for ctx/frontend to land before\nthis run may touch the file.",
    add: 37,
    del: 2,
    files: [
      { path: "src/types/api.ts", add: 6, del: 2 },
      { path: "tests/billing.spec.ts", add: 31, del: 0 },
    ],
  },
  "ctx/docs": {
    agent: "OpenCode",
    term:
      "OpenCode\n\n> document the new tiers\n\n• Wrote docs/pricing.md (+58 -0)\n• Wrote docs/faq.md (+24 -0)\n\nStaging 2 files for review…",
    add: 82,
    del: 0,
    files: [
      { path: "docs/pricing.md", add: 58, del: 0 },
      { path: "docs/faq.md", add: 24, del: 0 },
    ],
  },
  "ctx/review": {
    agent: "Shell",
    term:
      "$ git log --oneline -1\nf10c7a6 merge ctx/api-contract\n\n$ contextgit fleet\n4 runs · 1 blocked\n\nidle · waiting on ctx/frontend",
    add: 0,
    del: 0,
    files: [],
  },
};

const QUEUE: Array<{ branch: string; state: "done" | "next" | "blocked" | "queued" }> = [
  { branch: "ctx/api-contract", state: "done" },
  { branch: "ctx/frontend", state: "next" },
  { branch: "ctx/tests", state: "blocked" },
  { branch: "ctx/docs", state: "queued" },
];

export default function AppDemo() {
  const [active, setActive] = useState("ctx/frontend");
  const [note, setNote] = useState("");

  const run = FLEET.find((r) => r.branch === active) ?? FLEET[1];
  const detail = DETAIL[run.branch];

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const i = FLEET.findIndex((r) => r.branch === active);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setActive(FLEET[(i + 1) % FLEET.length].branch);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive(FLEET[(i - 1 + FLEET.length) % FLEET.length].branch);
    }
  };

  return (
    <section className="app-demo" aria-label="Interactive demo of the ContextGit Code tab">
      <div className="app-demo-bar">
        <span className="app-demo-brand">
          Context<b>Git</b>
        </span>
        <span className="app-demo-modes" aria-hidden="true">
          <span data-on="true">Single</span>
          <span data-on="false">Team</span>
        </span>
        <span className="app-demo-spacer" />
        <span className="app-demo-hint mono">Sample data · click a run</span>
        <span className="app-demo-toggle" aria-hidden="true" />
      </div>

      <div className="app-demo-body">
        <aside className="app-demo-rail">
          <p className="app-demo-heading">
            Runs <span className="app-demo-count">{FLEET.length}</span>
          </p>
          <div className="app-demo-runs" role="toolbar" aria-orientation="vertical" aria-label="Agent runs" onKeyDown={onKeyDown}>
            {FLEET.map((r) => {
              const d = DETAIL[r.branch];
              const on = r.branch === active;
              return (
                <button
                  key={r.branch}
                  type="button"
                  aria-pressed={on}
                  className="app-demo-run"
                  data-status={r.status}
                  onClick={() => {
                    setActive(r.branch);
                    setNote("");
                  }}
                >
                  <span className="app-demo-mark" aria-hidden="true">
                    {r.mark}
                  </span>
                  <span className="app-demo-run-copy">
                    <span className="app-demo-run-name">{r.branch.replace("ctx/", "")}</span>
                    <span className="app-demo-run-meta mono">
                      {r.role} · {d.add > 0 ? `+${d.add} −${d.del}` : "no changes"}
                    </span>
                  </span>
                  <span className="app-demo-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </aside>

        <div className="app-demo-canvas" aria-live="polite">
          <div className="app-demo-pane">
            <div className="app-demo-phead">
              <span className="app-demo-mark" aria-hidden="true">
                {run.mark}
              </span>
              <span className="app-demo-pname">{run.branch}</span>
              <span className="app-demo-spacer" />
              <span className="app-demo-chip mono">{detail.agent}</span>
              <span className="app-demo-dot" data-status={run.status} aria-hidden="true" />
            </div>
            <pre className="app-demo-term mono">{detail.term}</pre>
          </div>
        </div>

        <aside className="app-demo-dock">
          <p className="app-demo-heading">Run</p>
          <div className="app-demo-kv">
            <span>Branch</span>
            <code className="mono">{run.branch}</code>
          </div>
          <div className="app-demo-kv">
            <span>Status</span>
            <span className="app-demo-state">
              <span className="app-demo-dot" data-status={run.status} aria-hidden="true" />
              {STATUS_LABEL[run.status]}
            </span>
          </div>
          <div className="app-demo-kv">
            <span>Changes</span>
            <span className="mono">
              {detail.add > 0 ? `+${detail.add} −${detail.del}` : "—"}
            </span>
          </div>

          <p className="app-demo-heading">
            Changed files <span className="app-demo-count">{detail.files.length}</span>
          </p>
          <ul className="app-demo-files">
            {detail.files.length === 0 ? (
              <li className="app-demo-file-empty mono">working tree clean</li>
            ) : (
              detail.files.map((f) => (
                <li key={f.path}>
                  <span className="app-demo-file-path mono">{f.path}</span>
                  <span className="app-demo-file-stat mono">
                    <b data-sign="+">+{f.add}</b> <b data-sign="−">−{f.del}</b>
                  </span>
                </li>
              ))
            )}
          </ul>

          <p className="app-demo-heading">Merge queue</p>
          <ul className="app-demo-queue">
            {QUEUE.map((q) => (
              <li
                key={q.branch}
                data-state={q.state}
                data-active={q.branch === active}
                className={q.branch === active ? "is-selected" : undefined}
              >
                <span className="mono">{q.branch}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="app-demo-btn"
            onClick={() => setNote("Sample data — nothing was merged.")}
          >
            Integrate code + context
          </button>
          <p className="app-demo-note" role="status">
            {note}
          </p>
        </aside>
      </div>
    </section>
  );
}
