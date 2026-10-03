import { useRef } from "react";

export type TabId = "chat" | "code" | "agent" | "git";

export interface TabDef {
  id: TabId;
  label: string;
}

export default function TopNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="cg-segmented" role="tablist" aria-label="Workspace views">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`cg-tab-${tab.id}`}
          className="cg-segment"
          aria-selected={active === tab.id}
          aria-controls={`cg-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(index, 1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(index, -1);
            } else if (event.key === "Home") {
              event.preventDefault();
              onChange(tabs[0].id);
              refs.current[0]?.focus();
            } else if (event.key === "End") {
              event.preventDefault();
              const last = tabs.length - 1;
              onChange(tabs[last].id);
              refs.current[last]?.focus();
            }
          }}
        >
          <span className="cg-segment-dot" aria-hidden="true" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
