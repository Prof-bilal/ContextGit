import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import { api, type Session } from "@/lib/api";
import { agentLabel, agentMonogram } from "../agents";
import { Monogram, StatusDot } from "../primitives";

const TERM_THEME = {
  dark: { background: "#12100d", foreground: "#e7e0d4" },
  light: { background: "#17161d", foreground: "#e8e4da" },
} as const;

function newPtyId(sessionId: string): string {
  return `pty-${sessionId}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One xterm.js view bound to a node-pty process in the main process. The pane
 * owns its PTY and stays mounted (hidden) while the session is open, so the
 * process and scrollback survive layout and tab switches.
 */
export default function TerminalPane({
  session,
  visible,
  theme,
  onStaged,
  onActivate,
  onClose,
}: {
  session: Session;
  visible: boolean;
  theme: "dark" | "light";
  onStaged: () => void;
  onActivate: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const stagedRowRef = useRef(0);
  /**
   * A unique PTY id per launched process, not the session id. Otherwise a
   * process we replaced could deliver a stale data/exit event to this pane and
   * a live agent would read "process exited".
   */
  const ptyIdRef = useRef(newPtyId(session.id));
  const teardownRef = useRef<number | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const restartingRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const command = session.agent ?? "shell";

  useEffect(() => {
    const ptyId = ptyIdRef.current;
    const bridge = window.contextgit;

    if (teardownRef.current !== null) {
      window.clearTimeout(teardownRef.current);
      teardownRef.current = null;
      // React StrictMode mounts -> unmounts -> mounts in dev; that throwaway
      // cleanup must not kill the agent we just launched, so reuse it as-is.
      if (!restartingRef.current) return;
      // A real restart: drop the old terminal/process, then set up fresh.
      disposeRef.current?.();
      disposeRef.current = null;
    }
    restartingRef.current = false;

    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: "'Martian Mono', ui-monospace, monospace",
      fontSize: 12.5,
      theme: TERM_THEME[theme],
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // hidden on first render; the visibility effect refits when shown
    }

    bridge?.ptyStart({ id: ptyId, command, cols: term.cols, rows: term.rows });
    const offData = bridge?.onPtyData((id, data) => {
      if (id === ptyId) term.write(data);
    });
    const offExit = bridge?.onPtyExit((id) => {
      if (id === ptyId) setExited(true);
    });
    const input = term.onData((data) => bridge?.ptyWrite(ptyId, data));
    const observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      try {
        fit.fit();
        bridge?.ptyResize(ptyId, term.cols, term.rows);
      } catch {
        // zero-size container
      }
    });
    observer.observe(host);

    const dispose = () => {
      observer.disconnect();
      input.dispose();
      offData?.();
      offExit?.();
      bridge?.ptyKill(ptyId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    disposeRef.current = dispose;

    return () => {
      teardownRef.current = window.setTimeout(() => {
        teardownRef.current = null;
        disposeRef.current?.();
        disposeRef.current = null;
      }, 0);
    };
    // Re-runs only on an explicit restart (nonce); the agent never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERM_THEME[theme];
  }, [theme]);

  useEffect(() => {
    if (!visible) return;
    // Two frames: the first lets the grid settle, the second repaints the
    // terminal. Without the repaint a newly shown pane can stay blank until
    // the user interacts with it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const term = termRef.current;
        if (!term) return;
        try {
          fitRef.current?.fit();
          window.contextgit?.ptyResize(ptyIdRef.current, term.cols, term.rows);
          term.refresh(0, Math.max(0, term.rows - 1));
          term.focus();
        } catch {
          // still hidden
        }
      });
    });
  }, [visible, nonce]);

  const restart = () => {
    restartingRef.current = true;
    ptyIdRef.current = newPtyId(session.id);
    stagedRowRef.current = 0;
    setStagedCount(0);
    setExited(false);
    setError(null);
    setNonce((value) => value + 1);
  };

  const stageOutput = async () => {
    const term = termRef.current;
    if (!term) return;
    try {
      const buffer = term.buffer.active;
      const start = Math.min(stagedRowRef.current, Math.max(0, buffer.length - 1));
      const lines: string[] = [];
      for (let row = start; row < buffer.length; row += 1) {
        const line = buffer.getLine(row);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join("\n").trim();
      stagedRowRef.current = buffer.length;
      if (!text) return;
      await api.stage(session.id, [{ role: "tool", content: text }]);
      const staged = await api.staging(session.id);
      setStagedCount(staged.length);
      setError(null);
      onStaged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stage output");
    }
  };

  return (
    <section
      className="cg-pane"
      data-visible={visible}
      aria-label={`${session.name} terminal`}
      onMouseDown={onActivate}
    >
      <header className="cg-pane-head">
        <Monogram agent={session.agent ?? "shell"} label={agentMonogram(session.agent)} />
        <span>{agentLabel(session.agent)}</span>
        <span className="cg-pane-cwd">{session.name}</span>
        <span className="cg-toolbar-spacer" />
        <span className="cg-pane-staged">{stagedCount} staged</span>
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => void stageOutput()}>
          Stage output
        </button>
        <StatusDot status={exited ? "done" : session.status} />
        <button
          type="button"
          className="cg-icon-btn"
          aria-label={`Close ${session.name}`}
          title="Close pane (the run stays in the rail)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {exited && (
        <p className="cg-pane-exited" role="status">
          <span>Process exited.</span>
          <button type="button" className="cg-btn cg-btn-sm" onClick={restart}>
            Restart
          </button>
        </p>
      )}
      {error && (
        <p className="cg-pane-error" role="alert">
          {error}
        </p>
      )}
      <div className="cg-term-host" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
    </section>
  );
}
