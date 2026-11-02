/** One session: header with status and actions, activity panel with a composer (left), workspace tabs (right). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@/shared/api";
import { AgentMark } from "../../shell/primitives";
import { StatusDot, Chip, Button, IconButton } from "../ui";
import { LuSendHorizontal, LuFolderOpen, LuGitBranch, LuTerminal, LuX, LuRotateCcw, LuSquare } from "react-icons/lu";
import { agentLabel } from "../rail/sessionUtils";
import { useSessionTimeline, type SentMessage } from "./useSessionTimeline";
import { useTerminalState } from "./useTerminalState";
import { baseName, relativeTime, STATUS_TEXT } from "./format";
import ConfirmDialog from "./ConfirmDialog";
import Workspace from "../workspace/Workspace";
import { useApp } from "../context";
import { terminalRuntime } from "../../shell/terminal/runtime";
import "./session.css";

export default function SessionView({ session }: { session: Session }) {
  const { wb, go } = useApp();
  // The live terminal decides what you can do: a stored "running" status can
  // outlive its process after a reload, and a resumed terminal runs again.
  const terminalState = useTerminalState(session.id);
  const isRunning = terminalState === "running" || terminalState === "starting";
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
  const isVerticalRef = useRef(isVertical);
  isVerticalRef.current = isVertical;

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
    startYRef.current = event.clientY;
    startWidthRef.current = splitWidth;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    splitterRef.current?.focus();
  }, [splitWidth]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingRef.current) return;
    const containerWidth = splitterRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const maxWidth = Math.min(500, containerWidth * 0.5);
    const delta = isVerticalRef.current ? event.clientX - startXRef.current : event.clientY - startYRef.current;
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
      // The old canvas pane killed its process on unmount; here the runtime owns it.
      await terminalRuntime.stop(session.id).catch(() => undefined);
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


  return (
    <div className="session-view">
      {/* Header */}
      <header className="session-header">
        <div className="session-header-left">
          <div className="session-agent-mark">
            <AgentMark agent={session.agent ?? "shell"} label={agentLabel(session.agent)} size="lg" />
          </div>
          <div>
            <div className="session-name">{session.name}</div>
            <div className="session-status">
              <StatusDot status={isRunning ? "running" : session.status === "running" ? "idle" : session.status} />
              <span>{isRunning ? STATUS_TEXT.running : session.status === "running" ? "Not attached" : STATUS_TEXT[session.status]}</span>
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
              <LuSquare className="ui-icon" aria-hidden="true" />
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
                {session.task ?? "Interactive session"}
              </h2>
              <dl className="session-task-meta">
                <dt>Agent</dt>
                <dd>{agentLabel(session.agent)}</dd>
                <dt>Model</dt>
                <dd>{session.model ?? "default"}</dd>
                <dt>Created</dt>
                <dd>{relativeTime(session.created_at)}</dd>
                <dt>Folder</dt>
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
                <p className="session-quiet">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="session-quiet">Nothing has happened yet.</p>
              ) : (
                <ol className="ui-lane session-lane">
                  {entries.map((entry) => (
                    <li key={entry.id} data-state={entry.tone === "bad" ? "error" : entry.tone === "ok" ? "running" : entry.tone === "info" ? "done" : undefined}>
                      <div className="session-timeline-title">
                        <span>{entry.title}</span>
                        <time className="session-timeline-time" dateTime={entry.at}>{relativeTime(entry.at)}</time>
                      </div>
                      {entry.body && <div className="session-timeline-description">{entry.body}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Composer */}
            <footer className="session-composer" aria-label="Send message to agent">
              <textarea
                ref={textareaRef}
                className="session-composer-textarea ui-textarea"
                placeholder="Type into the terminal…"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isRunning}
                aria-label="Text to send to the terminal"
                aria-describedby={!isRunning ? "composer-hint" : undefined}
              />
              {!isRunning && (
                <p id="composer-hint" className="session-composer-hint">
                  <LuTerminal aria-hidden="true" /> The terminal is not running. Open the Terminal tab to start or resume it.
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
            { label: "Close session", variant: "danger", onSelect: confirmClose },
          ]}
          onCancel={cancelClose}
          busy={closeBusy}
        >
          <p className="session-confirm-body">
            This stops the agent and closes the session. It stays in the Sessions list as finished.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
