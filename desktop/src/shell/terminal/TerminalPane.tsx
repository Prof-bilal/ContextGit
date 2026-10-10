import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type IMarker } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import { LuX } from "react-icons/lu";

import { api, type Session } from "@/lib/api";
import { harnessFor } from "../../../shared/harnesses";
import { roleFor, roleSkills } from "../../../shared/roles";
import { agentLabel, agentMonogram } from "../agents";
import { AgentMark, StatusIcon } from "../primitives";
import HarnessInstall from "./HarnessInstall";

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
  initialInput,
  taskId,
  onStaged,
  onStatus,
  onActivate,
  onClose,
}: {
  session: Session;
  visible: boolean;
  theme: "dark" | "light";
  /** One line typed into the terminal once it is up (team mode's briefing). */
  initialInput?: string;
  /** The team task this run owns, exported so the MCP tools know it. */
  taskId?: string;
  onStaged: () => void;
  /** Called when this pane changes the run's status (or checkpoints it). */
  onStatus?: () => void;
  onActivate: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Markers move when scrollback is trimmed; a raw row number stops advancing
  // once the buffer reaches its configured maximum length.
  const stagedMarkerRef = useRef<IMarker | null>(null);
  const stagingRef = useRef(false);
  /**
   * A unique PTY id per launched process, not the session id. Otherwise a
   * process we replaced could deliver a stale data/exit event to this pane and
   * a live agent would read "process exited".
   */
  const ptyIdRef = useRef(newPtyId(session.id));
  const teardownRef = useRef<number | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const restartingRef = useRef(false);
  const command = session.agent ?? "shell";
  const role = roleFor(session.role);
  const loadedSkills = session.skills.length > 0
    ? session.skills
    : role
      ? roleSkills(role).map((skill) => skill.label)
      : [];
  const roleBriefing = initialInput ?? (role && loadedSkills.length > 0
    ? `You are acting as a ${role.label} on "${session.name}". Apply these skills on this run: ${loadedSkills.join(", ")}. Read AGENTS.md for your file scope and the other runs.`
    : undefined);
  /** True when this harness must be installed (npm) before its terminal starts. */
  const needsInstall = Boolean(harnessFor(command)?.npmPackage);
  const [nonce, setNonce] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [stagingOutput, setStagingOutput] = useState(false);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureChoices, setCaptureChoices] = useState<{ id: string; title: string }[]>([]);
  const [nativeChoice, setNativeChoice] = useState("");
  /**
   * A harness CLI that ships via npm is installed on demand before its PTY
   * starts; `installReady` gates the terminal effect until the binary exists.
   */
  const [installReady, setInstallReady] = useState(!needsInstall);
  /**
   * The session object is replaced whenever the backend updates it (status,
   * auto-checkpoint), but the terminal effect runs once per launch — so read the
   * latest through a ref instead of the closed-over value.
   */
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    // Wait for the on-demand install to finish before creating the terminal.
    if (needsInstall && !installReady) return;
    const ptyId = ptyIdRef.current;
    const bridge = window.contextgit;
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      teardownRef.current = window.setTimeout(() => {
        teardownRef.current = null;
        disposeRef.current?.();
        disposeRef.current = null;
      }, 0);
    };

    if (teardownRef.current !== null) {
      window.clearTimeout(teardownRef.current);
      teardownRef.current = null;
      // React StrictMode mounts -> unmounts -> mounts in dev; that throwaway
      // cleanup must not kill the agent we just launched, so reuse it as-is.
      if (!restartingRef.current && disposeRef.current) return cleanup;
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
      if (cancelled || !hostRef.current || disposeRef.current) return;

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
        sessionId: session.id,
        command,
        cols: term.cols,
        rows: term.rows,
        // The run's own worktree when it has one, else the workspace folder.
        cwd: session.worktree_path ?? session.project_path ?? undefined,
        // Team mode hands the agent its task as the first line it sees.
        input: roleBriefing,
        // Isolation + identity: its own port, and the task the MCP tools default to.
        env: {
          ...(session.port ? { PORT: String(session.port) } : {}),
          CONTEXTGIT_RUN: session.name,
          ...(taskId ? { CONTEXTGIT_TASK: taskId } : {}),
        },
      });

      // A live process means a running run: keep the rail's status dot honest.
      void api
        .updateSession(sessionRef.current.id, { status: "running" })
        .then(() => onStatus?.())
        .catch(() => {
          // status is best-effort; the terminal still works
        });

      /** Persist the outcome, and checkpoint staged output when asked to. */
      const finishRun = async (code: number | undefined) => {
        const current = sessionRef.current;
        try {
          await api.updateSession(current.id, { status: code === 0 ? "done" : "error" });
          onStatus?.();
        } catch {
          // status is best-effort
        }
        if (!current.auto_commit) return;
        try {
          if (current.agent === "opencode") {
            const result = await api.captureConversation(current.id);
            if (result.status !== "ready") {
              setError(result.detail ?? "Conversation capture failed.");
              setCaptureChoices(result.candidates ?? []);
              return;
            }
          }
          const staged = await api.staging(current.id);
          if (staged.length === 0) return;
          await api.commitStaged(current.id, `checkpoint: ${current.name}`);
          onStaged();
          onStatus?.();
        } catch {
          // an automatic checkpoint must never break the pane
        }
      };

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
      const offExit = bridge?.onPtyExit((id, code) => {
        if (id !== ptyId) return;
        setExited(true);
        void finishRun(code);
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

    return cleanup;
    // Re-runs on an explicit restart (nonce) or once an install clears the gate;
    // the agent itself never changes for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, installReady, needsInstall]);

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
    stagedMarkerRef.current?.dispose();
    stagedMarkerRef.current = null;
    setStagedCount(0);
    setExited(false);
    setError(null);
    setNonce((value) => value + 1);
  };

  const stageOutput = async () => {
    const term = termRef.current;
    if (!term || stagingRef.current) return;
    stagingRef.current = true;
    setStagingOutput(true);
    let checkpoint: IMarker | undefined;
    try {
      if (session.agent === "opencode") {
        const result = await api.captureConversation(session.id);
        if (result.status !== "ready") {
          setError(result.detail ?? "Conversation capture failed.");
          setCaptureChoices(result.candidates ?? []);
          return;
        }
        setStagedCount(result.messages?.length ?? 0);
        setCaptureChoices([]);
        setError(null);
        onStaged();
        return;
      }
      const buffer = term.buffer.active;
      const marker = stagedMarkerRef.current;
      const start = marker && !marker.isDisposed ? Math.max(0, marker.line) : 0;
      const lines: string[] = [];
      for (let row = start; row < buffer.length; row += 1) {
        const line = buffer.getLine(row);
        if (line) lines.push(line.translateToString(true));
      }
      const text = lines.join("\n").trim();
      if (!text) return;
      checkpoint = term.registerMarker(buffer.length - 1 - buffer.baseY - buffer.cursorY);
      await api.stage(session.id, [{ role: "tool", content: text }]);
      // A restart during the request must not attach the old buffer's marker
      // to the replacement terminal. Advance only after persistence succeeds.
      if (termRef.current !== term) return;
      stagedMarkerRef.current?.dispose();
      stagedMarkerRef.current = checkpoint ?? null;
      checkpoint = undefined;
      const staged = await api.staging(session.id);
      setStagedCount(staged.length);
      setError(null);
      onStaged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stage output");
    } finally {
      checkpoint?.dispose();
      stagingRef.current = false;
      setStagingOutput(false);
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
        {role && <span className="cg-pane-role" title={`Role: ${role.label}`}>{role.label}</span>}
        <span className="cg-toolbar-spacer" />
        <span className="cg-pane-staged">{stagedCount} staged</span>
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => void stageOutput()} disabled={stagingOutput}>
          {stagingOutput ? "Staging…" : session.agent === "opencode" ? "Stage conversation" : "Stage output"}
        </button>
        <StatusIcon status={exited ? "done" : session.status} />
        <button
          type="button"
          className="cg-icon-btn"
          aria-label={`Close ${session.name}`}
          title="Close terminal and stop the process"
          onClick={onClose}
        >
          <LuX aria-hidden="true" />
        </button>
      </header>
      {role && loadedSkills.length > 0 && (
        <div className="cg-pane-context" data-testid="run-skills" aria-label={`Skills for ${role.label}`}>
          <span className="cg-pane-context-label">Skills loaded</span>
          <div className="cg-pane-skill-list">
            {loadedSkills.map((skill) => <span className="cg-pane-skill" key={skill}>{skill}</span>)}
          </div>
        </div>
      )}
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
      {captureChoices.length > 0 && (
        <div className="cg-pane-exited">
          <label>
            Link the conversation you used:
            <select aria-label="OpenCode conversation" value={nativeChoice} onChange={(event) => setNativeChoice(event.target.value)}>
              <option value="">Select a conversation…</option>
              {captureChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title} · {choice.id}</option>)}
            </select>
          </label>
          <button className="cg-btn cg-btn-sm" disabled={!nativeChoice || stagingOutput} onClick={() => {
            void api.bindConversation(session.id, nativeChoice).then(() => stageOutput()).catch((cause) => {
              setError(cause instanceof Error ? cause.message : "Could not link conversation");
            });
          }}>Link and stage</button>
        </div>
      )}
      {needsInstall && !installReady ? (
        <HarnessInstall command={command} onReady={() => setInstallReady(true)} />
      ) : (
        <div className="cg-term-host" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
      )}
    </section>
  );
}
