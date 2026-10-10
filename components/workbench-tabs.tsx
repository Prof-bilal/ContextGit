"use client";

import { useState } from "react";

/**
 * A compact mock of the beta workbench. Sample data only.
 */

type TabId = "code" | "git";

const TABS: Array<{ id: TabId; label: string; blurb: string }> = [
  {
    id: "code",
    label: "Code",
    blurb: "A terminal board: one live shell and one git branch per agent run.",
  },
  {
    id: "git",
    label: "Git",
    blurb: "History, graph, diffs and the merge preview, next to the work.",
  },
];

function Panel({ id }: { id: TabId }) {
  if (id === "code") {
    return (
      <pre className="wb-term mono">{`$ contextgit fleet
  ctx/frontend     codex     +56 −1   working
  ctx/api-contract claude    +56 −4   merged
  ctx/tests        gemini    +37 −2   blocked

> write the e2e for the cancelled tier
• Edited test/subscription.e2e-spec.ts (+41 -0)
• Ran npm run test:e2e  └ PASS`}</pre>
    );
  }
  return (
    <pre className="wb-term mono">{`* f10c7a6  Merge redis-bucket        main
* 5d2f8e1  Add audit logging         main
|\\
| * 4c07a1e  Cross-region clock skew  redis-bucket
| * 9e41b7d  Redis token bucket       redis-bucket
* | 1d6c9a0  Compare storage options  main
  * e3a9d04  Dead end: fails on failover  in-memory`}</pre>
  );
}

export default function WorkbenchTabs() {
  const [active, setActive] = useState<TabId>("code");
  const current = TABS.find((t) => t.id === active)!;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive(TABS[(i + 1) % TABS.length].id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive(TABS[(i - 1 + TABS.length) % TABS.length].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(TABS[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(TABS[TABS.length - 1].id);
    }
  };

  return (
    <div className="wb">
      <div className="wb-strip" role="tablist" aria-label="Workbench tabs" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`wb-tab-${t.id}`}
            aria-controls={`wb-panel-${t.id}`}
            aria-selected={t.id === active}
            tabIndex={t.id === active ? 0 : -1}
            className="wb-tab"
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wb-panels">
        {TABS.map((t) => (
          <div
            key={t.id}
            className="wb-panel"
            role="tabpanel"
            id={`wb-panel-${t.id}`}
            aria-labelledby={`wb-tab-${t.id}`}
            tabIndex={0}
            hidden={t.id !== active}
          >
            <Panel id={t.id} />
          </div>
        ))}
      </div>
      <p className="wb-blurb" aria-live="polite">
        <strong>{current.label}</strong> — {current.blurb}
      </p>
    </div>
  );
}
