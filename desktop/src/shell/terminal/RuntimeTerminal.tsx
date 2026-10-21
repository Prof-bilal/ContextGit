import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalRuntime } from "./runtime";
import { projectApi } from "@/shared/api";
import HarnessInstall from "./HarnessInstall";
import { harnessFor } from "@/shared/harnesses";

/** An optional view into an already running CLI. Closing it only disposes xterm. */
export default function RuntimeTerminal({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(
    (listener) => terminalRuntime.subscribe(sessionId, listener),
    () => terminalRuntime.snapshot(sessionId),
  );
  const session = terminalRuntime.session(sessionId);
  const [install, setInstall] = useState(false);
  const [context, setContext] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!session) return;
    const api = projectApi(session.project_path ?? undefined);
    const load = () => {
      void api
        .contextWindow?.(sessionId)
        .then((value) =>
          setContext(
            `${value.used_tokens.toLocaleString()} / ${value.limit_tokens?.toLocaleString() ?? "?"} context tokens (estimated)`,
          ),
        )
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [sessionId, session?.project_path]);
  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      scrollback: 2000,
      theme: {
        background: "#100e10",
        foreground: "#eee4df",
        cursor: "#ff6a32",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    const offOutput = terminalRuntime.subscribeOutput(sessionId, (data) => terminal.write(data));
    let previousError: string | undefined;
    const paintStatus = () => {
      const next = terminalRuntime.snapshot(sessionId);
      if (next.error && next.error !== previousError) terminal.write(`\r\n${next.error}\r\n`);
      previousError = next.error;
    };
    paintStatus();
    const off = terminalRuntime.subscribe(sessionId, paintStatus);
    const input = terminal.onData((text) => {
      void terminalRuntime.send(sessionId, text).catch(() => {});
    });
    const resize = new ResizeObserver(() => {
      try {
        fit.fit();
        terminalRuntime.resize(sessionId, terminal.cols, terminal.rows);
      } catch {
        /* hidden */
      }
    });
    resize.observe(host.current);
    fit.fit();
    terminal.focus();
    return () => {
      off();
      offOutput();
      input.dispose();
      resize.disconnect();
      terminal.dispose();
    };
  }, [sessionId]);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
    >
      <div className="sp-terminal-controls">
        <span>
          {snapshot.state} · {context}
        </span>
        <button
          onClick={() =>
            void terminalRuntime
              .checkpoint(sessionId)
              .then(() => setMessage("Checkpoint saved"))
              .catch((cause) => setMessage(String(cause)))
          }
        >
          Save checkpoint
        </button>
        {["exited", "error"].includes(snapshot.state) && (
          <button onClick={() => void terminalRuntime.retry(sessionId)}>
            Retry agent
          </button>
        )}
        {snapshot.state === "error" &&
          harnessFor(session?.agent)?.npmPackage && (
            <button onClick={() => setInstall(true)}>Install CLI</button>
          )}
        <span>{message}</span>
      </div>
      {install && session && (
        <HarnessInstall
          command={session.agent ?? "shell"}
          onReady={() => {
            setInstall(false);
            void terminalRuntime.retry(sessionId);
          }}
        />
      )}
      <div ref={host} style={{ flex: 1, minHeight: 0, padding: 10 }} />
    </div>
  );
}
