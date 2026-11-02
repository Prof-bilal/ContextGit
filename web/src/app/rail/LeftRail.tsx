import { useApp } from "../context";
import { IconButton } from "../ui";
import { LuPlus, LuMessagesSquare, LuWorkflow, LuSparkles, LuBrain, LuSettings } from "react-icons/lu";

export default function LeftRail({ backendAvailable }: { backendAvailable: boolean }) {
  const { wb, view, go, drawerOpen, setDrawerOpen } = useApp();

  const runningSessionsCount = wb.sessions.filter(
    s => s.kind === "terminal" && s.status === "running"
  ).length;

  return (
    <nav className="app-rail rail" aria-label="Main">
      <IconButton label="CG" icon={<span>CG</span>} onClick={() => go({ kind: "home" })} />
      <IconButton label="New session" icon={<LuPlus />} onClick={() => go({ kind: "home" })} />
      <IconButton
        label="Sessions"
        icon={<><LuMessagesSquare /><span className="rail-badge">{runningSessionsCount}</span></>}
        onClick={() => setDrawerOpen(!drawerOpen)}
      />
      <IconButton
        label="Canvas"
        current={view.kind === "canvas"}
        icon={<LuWorkflow />}
        onClick={() => go({ kind: "canvas" })}
      />
      <IconButton
        label="Skills"
        current={view.kind === "skills"}
        icon={<LuSparkles />}
        onClick={() => go({ kind: "skills" })}
      />
      <IconButton
        label="Memory"
        current={view.kind === "memory"}
        icon={<LuBrain />}
        onClick={() => go({ kind: "memory" })}
      />
      <IconButton
        label="Settings"
        current={view.kind === "settings"}
        icon={<LuSettings />}
        onClick={() => go({ kind: "settings" })}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "auto",
        }}
      >
        <span
          className="rail-status-dot"
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: backendAvailable ? "var(--app-ok)" : "var(--app-bad)",
          }}
          title={backendAvailable ? "Backend available" : "Backend down"}
        />
      </div>
    </nav>
  );
}