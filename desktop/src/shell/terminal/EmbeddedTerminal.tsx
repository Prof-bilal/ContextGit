import { useEffect, useRef, useSyncExternalStore } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { terminalRuntime } from "./runtime";

const TERMINAL_FONT =
  "'JetBrains Mono', 'Cascadia Mono', 'DejaVu Sans Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** A real, interactive xterm view embedded inside a team worker card. */
export default function EmbeddedTerminal({ sessionId, onResume }: { sessionId: string; onResume?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const state = useSyncExternalStore(
    listener => terminalRuntime.subscribe(sessionId, listener),
    () => terminalRuntime.snapshot(sessionId),
  );

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: 13,
      // Full-screen TUIs tile block characters across adjacent rows.
      lineHeight: 1,
      letterSpacing: 0,
      rescaleOverlappingGlyphs: true,
      scrollback: 5000,
      cursorBlink: true,
      cursorStyle: "block",
      scrollOnUserInput: true,
      convertEol: false,
      customGlyphs: true,
      drawBoldTextInBrightColors: true,
      theme: {
        background: "#151112",
        foreground: "#ddd0ca",
        cursor: "#ff6a32",
        selectionBackground: "#74402f88",
        black: "#171314",
        brightBlack: "#6f615c",
        red: "#ff765f",
        green: "#8fd66d",
        yellow: "#e5c65f",
        blue: "#82aaff",
        magenta: "#c792ea",
        cyan: "#75d8d6",
        white: "#eee4df",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      });
      terminal.loadAddon(webgl);
    } catch {
      webgl?.dispose();
      webgl = null;
    }
    termRef.current = terminal;
    let pending = "";
    let frame = 0;
    const flush = () => {
      frame = 0;
      const chunk = pending;
      pending = "";
      if (chunk) terminal.write(chunk);
    };
    const write = (data: string) => {
      pending += data;
      if (pending && !frame) frame = requestAnimationFrame(flush);
    };
    const input = terminal.onData((data) => {
      void terminalRuntime.send(sessionId, data).catch(() => {});
    });
    let resizeFrame = 0;
    let resizeTimer = 0;
    let disposed = false;
    let previousCols = 0;
    let previousRows = 0;
    const doFit = () => {
      if (disposed || !host.current) return;
      // Skip fit churn while the card is collapsed or still measuring.
      if (host.current.clientWidth < 200 || host.current.clientHeight < 120)
        return;
      try {
        fit.fit();
        if (terminal.cols !== previousCols || terminal.rows !== previousRows) {
          terminalRuntime.resize(sessionId, terminal.cols, terminal.rows);
          previousCols = terminal.cols;
          previousRows = terminal.rows;
        }
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
      } catch {
        // The card may be temporarily hidden while its team is collapsed.
      }
    };
    const resize = new ResizeObserver(() => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        doFit();
        // Trailing pass catches the settled size after a drag/zoom gesture.
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(doFit, 120);
      });
    });
    resize.observe(host.current);
    // Replay escape sequences into the measured grid, then let the CLI redraw
    // at its new PTY size. Never rewrite ANSI bytes or terminal query replies.
    doFit();
    const unsubscribe = terminalRuntime.subscribeOutput(sessionId, write);
    void document.fonts.ready.then(() => {
      if (!disposed) doFit();
    });
    // Focus only on explicit user click — auto-focus on mount steals
    // keystrokes from the canvas command bar and other cards.

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      termRef.current = null;
      unsubscribe();
      input.dispose();
      resize.disconnect();
      webgl?.dispose();
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div
      className="sp-embedded-terminal nodrag nopan nowheel"
      aria-label="Interactive agent terminal. Click to focus, wheel to scroll."
      title="Click to type · Scroll inside the terminal"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        termRef.current?.focus();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onWheel={(event) => {
        // Bubble only: capture would stop the event before xterm receives it,
        // breaking scrollback and TUI mouse reporting. The nowheel class also
        // keeps ReactFlow's native zoom/pan handlers out of the terminal.
        event.stopPropagation();
      }}
    >
      {/* Keep React controls outside the DOM owned by xterm. Its mouse
          handlers must never receive a Resume button's events. */}
      <div ref={host} className="sp-terminal-screen" />
      {onResume && ["idle", "error", "exited"].includes(state.state) && (
        <div className="sp-terminal-resume">
          {state.error && <span role="alert">{state.error}</span>}
          <button type="button" onClick={event => {event.stopPropagation();onResume();}}>
            {state.state === "idle" ? "Resume terminal" : "Restart terminal"}
          </button>
        </div>
      )}
    </div>
  );
}
