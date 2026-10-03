import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import { LuX } from "react-icons/lu";

import { api, type Session } from "@/lib/api";
import { agentLabel, agentMonogram } from "../agents";
import { AgentMark, StatusIcon } from "../primitives";

/** ANSI palette shared by both themes so full-screen TUIs render intentional colours. */
const ANSI = {
  black: "#3a332b",
  red: "#ff6b5e",
  green: "#46b89c",
  yellow: "#e0a53a",
  blue: "#5aa9ff",
  magenta: "#d98cff",
  cyan: "#4cc9b0",
  white: "#c6bdb1",
  brightBlack: "#918879",
  brightRed: "#ff8a5c",
  brightGreen: "#6fd6bd",
  brightYellow: "#f0c05a",
  brightBlue: "#7fbcff",
  brightMagenta: "#e6aaff",
  brightCyan: "#6fdcc7",
  brightWhite: "#f4efe6",
} as const;

const TERM_THEME = {
  dark: {
    background: "#12100d",
    foreground: "#e7e0d4",
    cursor: "#e7e0d4",
    selectionBackground: "#3a332b",
    ...ANSI,
  },
  light: {
    background: "#17161d",
    foreground: "#e8e4da",
    cursor: "#e8e4da",
    selectionBackground: "#342e26",
    ...ANSI,
  },
} as const;

/**
 * A terminal-first monospace: unlike the display font it has consistent
 * metrics for box-drawing and block glyphs, so TUIs (and their ASCII logos)
 * stay on the character grid.
 */
const TERMINAL_FONT =
  "'JetBrains Mono', 'Cascadia Mono', 'DejaVu Sans Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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

    const setup = async () => {
      // Wait for the terminal webfont before xterm measures glyphs; painting
      // with fallback widths first leaves the character grid misaligned.
      try {
        await document.fonts.ready;
        await document.fonts.load('400 13px "JetBrains Mono"');
      } catch {
        // font loading is best-effort; the fallback stack still works
      }
      if (!hostRef.current || disposeRef.current) return;

      const term = new Terminal({
        fontFamily: TERMINAL_FONT,
        fontSize: 13,
        // Keep the default 1.0: any extra line height breaks vertical tiling of
        // block characters (█ ▀ ▄), which shreds full-screen TUI ASCII art.
        lineHeight: 1,
        letterSpacing: 0,
        fontWeight: "400",
        fontWeightBold: "600",
        cursorStyle: "bar",
        cursorBlink: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 4.5,
        customGlyphs: true,
        smoothScrollDuration: 0,
        // Keep the terminal text in the DOM: the WebGL renderer draws to a
        // canvas, so this is what exposes the content to screen readers and tests.
        screenReaderMode: true,
        scrollback: 10000,
        theme: TERM_THEME[theme],
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;
      fitRef.current = fit;

      // `customGlyphs` (seamless block/box drawing) and `rescaleOverlappingGlyphs`
      // only work in the canvas-based renderers — the DOM renderer draws every
      // character from the font, which shreds TUI ASCII art into seamed rows.
      // Load WebGL and fall back to DOM if the GPU context is unavailable.
      let webgl: WebglAddon | null = null;
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
        });
        term.loadAddon(webgl);
      } catch {
        webgl = null;
      }

      try {
        fit.fit();
      } catch {
        // hidden on first render; the visibility effect refits when shown
      }

      bridge?.ptyStart({
        id: ptyId,
        command,
        cols: term.cols,
        rows: term.rows,
        // The run's own worktree when it has one, else the workspace folder.
        cwd: session.worktree_path ?? undefined,
      });

      // Coalesce PTY bursts into one write per frame so large redraws do not jank.
      let pending = "";
      let frame = 0;
      const flush = () => {
        frame = 0;
        const chunk = pending;
        pending = "";
        if (chunk) term.write(chunk);
      };
      const offData = bridge?.onPtyData((id, data) => {
        if (id !== ptyId) return;
        pending += data;
        if (!frame) frame = requestAnimationFrame(flush);
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

      disposeRef.current = () => {
        if (frame) cancelAnimationFrame(frame);
        observer.disconnect();
        input.dispose();
        offData?.();
        offExit?.();
        webgl?.dispose();
        bridge?.ptyKill(ptyId);
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    };
    void setup();

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
        <AgentMark agent={session.agent ?? "shell"} label={agentMonogram(session.agent)} />
        <span>{agentLabel(session.agent)}</span>
        <span className="cg-pane-cwd">{session.name}</span>
        <span className="cg-toolbar-spacer" />
        <span className="cg-pane-staged">{stagedCount} staged</span>
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => void stageOutput()}>
          Stage output
        </button>
        <StatusIcon status={exited ? "done" : session.status} />
        <button
          type="button"
          className="cg-icon-btn"
          aria-label={`Close ${session.name}`}
          title="Close pane (the run stays in the rail)"
          onClick={onClose}
        >
          <LuX aria-hidden="true" />
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
