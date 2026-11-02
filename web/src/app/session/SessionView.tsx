/** OWNER: session agent. Header + activity panel (left) + Workspace (right). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, SessionStatus } from "@/shared/api";
import { AgentMark } from "../../shell/primitives";
import { StatusDot, Chip, Button, IconButton, EmptyState } from "../ui";
import { LuSendHorizontal, LuFolderOpen, LuGitBranch, LuTerminal, LuX, LuRotateCcw, LuSparkles } from "react-icons/lu";
import { useSessionTimeline, type SentMessage } from "./useSessionTimeline";
import { useTerminalState } from "./useTerminalState";
import { baseName, relativeTime, STATUS_TEXT } from "./format";
import ConfirmDialog from "./ConfirmDialog";
import Workspace from "../workspace/Workspace";
import { useApp } from "../context";
import { terminalRuntime } from "../../shell/terminal/runtime";
import { ptyIdForSession } from "../../shell/terminal/pty";
import "./session.css";

export default function SessionView({ session }: { session: Session }) {
  const { wb, go } = useApp();
  const terminalState = useTerminalState(session.id);
  const isRunning = session.status === "running";
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [splitWidth, setSplitWidth] = useState(() => {
    const stored = localStorage.getItem("contextgit:session-split");
    return stored ? Math.max(300, Math.min(parseInt(stored, 10), 800)) : 380;
  });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [composerText, setComposerText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startWidthRef = useRef(0);
  const saveSplitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isVertical, setIsVertical] = useState(() => window.innerWidth > 900);

  // Update isVertical on resize
  useEffect(() => {
    const handleResize = () => setIsVertical(window.innerWidth > 900);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Persist split width with debounce
  useEffect(() => {
    if (saveSplitTimeoutRef.current) clearTimeout(saveSplitTimeoutRef.current);
    saveSplitTimeoutRef.current = setTimeout(() => {
      localStorage.setItem("contextgit:session-split", String(splitWidth));
    }, 300);
    return () => {
      if (saveSplitTimeoutRef.current) clearTimeout(saveSplitTimeoutRef.current);
    };
  }, [splitWidth]);

  // Handle composer send
  const handleSend = useCallback(async () => {
    const text = composerText.trim();
    if (!text || !isRunning) return;
    try {
      await terminalRuntime.send(session.id, text + "\r");
      setSentMessages((prev) => [...prev, { id: crypto.randomUUID(), at: new Date().toISOString(), text }]);
      setComposerText("");
      textareaRef.current?.focus();
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }, [composerText, isRunning, session.id]);

  // Handle keyboard in composer
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Handle split resize
  const handleSplitterMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = splitWidth;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    splitterRef.current?.focus();
  }, [splitWidth]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingRef.current) return;
    const containerWidth = splitterRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const maxWidth = Math.min(500, containerWidth * 0.5);
    const delta = isVertical ? event.clientX - startXRef.current : event.clientY - startYRef.current;
    const newWidth = Math.max(300, Math.min(startWidthRef.current + delta, maxWidth));
    setSplitWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleSplitterKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const containerWidth = splitterRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const maxWidth = Math.min(500, containerWidth * 0.5);
    const step = 20;
    let newWidth = splitWidth;
    if (isVertical) {
      if (event.key === "ArrowRight") newWidth = Math.min(splitWidth + step, maxWidth);
      else if (event.key === "ArrowLeft") newWidth = Math.max(splitWidth - step, 300);
      else return;
    } else {
      if (event.key === "ArrowDown") newWidth = Math.min(splitWidth + step, maxWidth);
      else if (event.key === "ArrowUp") newWidth = Math.max(splitWidth - step, 300);
      else return;
    }
    event.preventDefault();
    setSplitWidth(newWidth);
  }, [splitWidth, isVertical]);

  // Stop session - use terminalRuntime.stop to properly kill PTY
  const handleStop = useCallback(async () => {
    try {
      await terminalRuntime.stop(session.id);
    } catch (error) {
      console.error("Failed to stop session:", error);
    }
  }, [session.id]);

  // Close session - use wb.closeTerminal to properly close
  const confirmClose = useCallback(async () => {
    setCloseBusy(true);
    try {
      await wb.closeTerminal(session);
      go({ kind: "home" });
    } catch (error) {
      console.error("Failed to close session:", error);
    } finally {
      setCloseBusy(false);
      setShowCloseConfirm(false);
    }
  }, [wb, session, go]);

  const cancelClose = useCallback(() => {
    setShowCloseConfirm(false);
  }, []);

  // Timeline
  const { entries, detail, team, error, loaded, refresh } = useSessionTimeline(session, sentMessages);

  // Task card meta
  const worktreePath = session.worktree_path ?? session.project_path;
  const gitBranch = session.git_branch ?? session.branch;

  // Header chips
  const projectName = session.project_path ? baseName(session.project_path) : "Unknown project";
  const branchName = session.git_branch ?? session.branch ?? "main";

  // Get tone for timeline entries
  const getToneStatus = (tone?: "ok" | "bad" | "info" | "accent"): SessionStatus => {
    switch (tone) {
      case "ok": return "running";
      case "bad": return "error";
      case "info": return "done";
      case "accent": return "running";
      default: return "idle";
    }
  };

  return (
    <div className="session-view">
      {/* Header */}
      <header className="session-header">
        <div className="session-header-left">
          <div className="session-agent-mark">
            <AgentMark agent={session.agent ?? "shell"} label={session.agent ?? "shell"} size="lg" />
          </div>
          <div>
            <div className="session-name">{session.name}</div>
            <div className="session-status">
              <StatusDot status={session.status} />
              <span>{STATUS_TEXT[session.status]}</span>
            </div>
          </div>
          <div className="session-chips">
            <Chip icon={<LuFolderOpen />} title={session.project_path ?? "Unknown project"}>{projectName}</Chip>
            <Chip icon={<LuGitBranch />} title={session.worktree_path ? `${gitBranch} (worktree)` : gitBranch}>{branchName}</Chip>
          </div>
        </div>
        <div className="session-header-right">
          {isRunning && (
            <Button variant="danger" size="sm" onClick={handleStop}>
              <LuX className="ui-icon" aria-hidden="true" />
              Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowCloseConfirm(true)}>
            <LuX className="ui-icon" aria-hidden="true" />
            Close
          </Button>
        </div>
      </header>

      {/* Split view */}
      <div className="session-split" style={{ "--session-split-width": `${splitWidth}px` } as React.CSSProperties}>
        {/* Activity panel */}
        <aside className="session-activity" role="complementary" aria-label="Session activity">
          <div className="session-activity-content app-scroll">
            {/* Task card */}
            <section className="session-task-card" aria-labelledby="task-heading">
              <h2 id="task-heading" className="session-task-title">
                {session.task ?? "No task — interactive session"}
              </h2>
              <dl className="session-task-meta">
                <dt><LuTerminal aria-hidden="true" /> CLI</dt>
                <dd>{session.agent ?? "shell"}</dd>
                <dt><LuSparkles aria-hidden="true" /> Model</dt>
                <dd>{session.model ?? "default"}</dd>
                <dt><LuRotateCcw aria-hidden="true" /> Created</dt>
                <dd>{relativeTime(session.created_at)}</dd>
                <dt><LuFolderOpen aria-hidden="true" /> Working directory</dt>
                <dd title={worktreePath ?? "Unknown"}>
                  {worktreePath ?? "Unknown"}
                </dd>
              </dl>
            </section>

            {/* Timeline */}
            <section className="session-timeline" aria-label="Activity timeline">
              {error && !loaded && (
                <div className="session-timeline-error">
                  <p>Failed to load timeline: {error}</p>
                  <Button variant="primary" size="sm" onClick={refresh}>
                    <LuRotateCcw aria-hidden="true" /> Retry
                  </Button>
                </div>
              )}
              {!error && !loaded ? (
                <EmptyState title="Loading..." />
              ) : entries.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                entries.map((entry) => (
                  <article key={entry.id} className="session-timeline-entry">
                    <time className="session-timeline-time" dateTime={entry.at}>
                      {relativeTime(entry.at)}
                    </time>
                    <div className="session-timeline-body">
                      <div className="session-timeline-title">
                        {entry.tone && <StatusDot status={getToneStatus(entry.tone)} />}
                        <span>{entry.title}</span>
                      </div>
                      {entry.body && (
                        <div className="session-timeline-description">{entry.body}</div>
                      )}
                    </div>
                  </article>
                ))
              )}
            </section>

            {/* Composer */}
            <footer className="session-composer" aria-label="Send message to agent">
              <textarea
                ref={textareaRef}
                className="session-composer-textarea ui-textarea"
                placeholder="Send a message to the agent…"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isRunning}
                aria-label="Message to agent"
                aria-describedby={!isRunning ? "composer-hint" : undefined}
              />
              {!isRunning && (
                <p id="composer-hint" className="session-composer-hint">
                  <LuTerminal aria-hidden="true" /> Agent is not running. Start it from the canvas to send messages.
                </p>
              )}
              <div className="session-composer-actions">
                <IconButton
                  label="Send"
                  icon={<LuSendHorizontal aria-hidden="true" />}
                  onClick={handleSend}
                  disabled={!isRunning || !composerText.trim()}
                  aria-disabled={!isRunning || !composerText.trim()}
                />
              </div>
            </footer>
          </div>
        </aside>

        {/* Splitter */}
        <div
          ref={splitterRef}
          className="session-splitter"
          role="separator"
          aria-orientation={isVertical ? "vertical" : "horizontal"}
          aria-valuenow={splitWidth}
          aria-valuemin={300}
          aria-valuemax={Math.min(500, (splitterRef.current?.parentElement?.clientWidth ?? window.innerWidth) * 0.5)}
          tabIndex={0}
          onMouseDown={handleSplitterMouseDown}
          onKeyDown={handleSplitterKeyDown}
          aria-label="Resize activity panel"
        />

        {/* Workspace */}
        <section className="session-workspace" aria-label="Workspace">
          <Workspace session={session} />
        </section>
      </div>

      {/* Close confirmation dialog */}
      {showCloseConfirm && (
        <ConfirmDialog
          title="Close session?"
          actions={[
            { label: "Close", variant: "danger", onSelect: confirmClose },
            { label: "Cancel", variant: "default", onSelect: cancelClose },
          ]}
          onCancel={cancelClose}
          busy={closeBusy}
        >
          <p className="session-confirm-body">
            This will stop the agent and close the session view. You can reopen it from the rail.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
