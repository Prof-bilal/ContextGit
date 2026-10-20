import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { terminalRuntime } from "./runtime";

const TERMINAL_FONT =
  "'JetBrains Mono', 'Cascadia Mono', 'DejaVu Sans Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function terminalBytes(value: string): string {
  return value
    .replace(/\\u001b/g, "\u001b")
    .replace(/\\x1b/g, "\u001b")
    .replace(
      /(^|[^\u001b])\[((?:0|1|2|3|4|9|10|38|48)(?:;\d+)*?)m/g,
      "$1\u001b[$2m",
    );
}

/** A real, interactive xterm view embedded inside a team worker card. */
export default function EmbeddedTerminal({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize: 12.5,
      lineHeight: 1.2,
      letterSpacing: 0,
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
    termRef.current = terminal;
    let previous = "";
    let pending = "";
    let frame = 0;
    const flush = () => {
      frame = 0;
      const chunk = pending;
      pending = "";
      if (chunk) terminal.write(chunk);
    };
    const paint = () => {
      const next = terminalRuntime.snapshot(sessionId);
      if (next.output.startsWith(previous)) {
        pending += terminalBytes(next.output.slice(previous.length));
      } else {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        pending = "";
        terminal.reset();
        terminal.write(terminalBytes(next.output));
      }
      previous = next.output;
      if (pending && !frame) frame = requestAnimationFrame(flush);
    };
    paint();
    const unsubscribe = terminalRuntime.subscribe(sessionId, paint);
    const input = terminal.onData((data) => {
      void terminalRuntime.send(sessionId, data).catch(() => {});
    });
    let resizeFrame = 0;
    let resizeTimer = 0;
    const doFit = () => {
      if (!host.current) return;
      // Skip fit churn while the card is collapsed or still measuring.
      if (host.current.clientWidth < 200 || host.current.clientHeight < 120)
        return;
      try {
        fit.fit();
        terminalRuntime.resize(sessionId, terminal.cols, terminal.rows);
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
    doFit();
    // Focus only on explicit user click — auto-focus on mount steals
    // keystrokes from the canvas command bar and other cards.

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      if (resizeTimer) window.clearTimeout(resizeTimer);
      termRef.current = null;
      unsubscribe();
      input.dispose();
      resize.disconnect();
      terminal.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={host}
      className="sp-embedded-terminal nodrag nowheel"
      aria-label="Interactive agent terminal. Click to focus, wheel to scroll."
      title="Click to focus · wheel scrolls · drag the card edges to enlarge for opencode"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        termRef.current?.focus();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        // Keep wheel inside xterm: stop ReactFlow zoom/pan from hijacking
        // opencode's scrollback and alt-screen scrolling.
        event.stopPropagation();
      }}
      onWheelCapture={(event) => event.stopPropagation()}
    />
  );
}
