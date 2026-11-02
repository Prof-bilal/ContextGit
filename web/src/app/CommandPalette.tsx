import { useEffect, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent, type ChangeEvent } from "react";
import { useApp } from "./context";
import { projectTerminalSessions, agentLabel, STATUS_LABEL } from "./rail/sessionUtils";
import "./palette.css";

interface Command {
  id: string;
  title: string;
  secondary?: string;
  action: () => void;
  keywords: string[];
}

export default function CommandPalette() {
  const { wb, go, setDrawerOpen } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [commands, setCommands] = useState<Command[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildCommands = useCallback(() => {
    const cmds: Command[] = [
      {
        id: "new-session",
        title: "New session",
        action: () => {
          go({ kind: "home" });
          setTimeout(() => {
            const event = new CustomEvent("contextgit:focus-prompt");
            window.dispatchEvent(event);
          }, 0);
        },
        keywords: ["new", "session", "create"],
      },
      {
        id: "open-sessions",
        title: "Open sessions",
        action: () => setDrawerOpen(true),
        keywords: ["open", "sessions", "drawer", "list"],
      },
      {
        id: "go-canvas",
        title: "Go to Canvas",
        action: () => go({ kind: "canvas" }),
        keywords: ["canvas", "spatial", "map"],
      },
      {
        id: "go-skills",
        title: "Go to Skills",
        action: () => go({ kind: "skills" }),
        keywords: ["skills", "library"],
      },
      {
        id: "go-memory",
        title: "Go to Memory",
        action: () => go({ kind: "memory" }),
        keywords: ["memory", "library"],
      },
      {
        id: "go-settings",
        title: "Go to Settings",
        action: () => go({ kind: "settings" }),
        keywords: ["settings", "preferences", "config"],
      },
      {
        id: "open-project-folder",
        title: "Open project folder…",
        action: () => wb.choose(),
        keywords: ["open", "project", "folder", "choose", "directory"],
      },
    ];

    if (wb.projects) {
      wb.projects.forEach((project) => {
        if (project.path !== wb.activePath) {
          cmds.push({
            id: `switch-project-${project.path}`,
            title: `Switch to project ${project.name}`,
            action: () => wb.useProject(project.path),
            keywords: ["switch", "project", project.name.toLowerCase()],
          });
        }
      });
    }

    const sessions = projectTerminalSessions(wb.sessions, wb.activePath);
    sessions.forEach((session) => {
      const agent = agentLabel(session.agent);
      const status = STATUS_LABEL[session.status];
      cmds.push({
        id: `open-session-${session.id}`,
        title: `Open session: ${session.name || "Unnamed"}`,
        secondary: `${agent} • ${status}`,
        action: () => go({ kind: "session", sessionId: session.id }),
        keywords: ["open", "session", session.name?.toLowerCase() || "", agent.toLowerCase(), status.toLowerCase()],
      });
    });

    setCommands(cmds);
  }, [wb, go, setDrawerOpen]);

  useEffect(() => {
    buildCommands();
  }, [buildCommands]);

  const filteredCommands = commands.filter((cmd) => {
    if (!query) return true;
    const q = query.toLowerCase();
    const titleMatch = cmd.title.toLowerCase().includes(q);
    const secondaryMatch = cmd.secondary?.toLowerCase().includes(q) ?? false;
    const keywordMatch = cmd.keywords.some((k) => k.toLowerCase().includes(q));
    return titleMatch || secondaryMatch || keywordMatch;
  });

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (!open) return;

      if (e.key === "Escape") {
        closePalette();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filteredCommands[activeIndex];
        if (cmd) {
          cmd.action();
          closePalette();
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
    },
    [open, filteredCommands, activeIndex]
  );

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key === "k";
      if (!isCtrlK) return;

      const active = document.activeElement;
      const isInXterm = active?.closest(".xterm");

      if (isInXterm) return;

      e.preventDefault();
      if (!open) {
        previousFocusRef.current = active as HTMLElement;
        setOpen(true);
        setQuery("");
        setActiveIndex(0);
        setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        closePalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setActiveIndex(0);
  };

  const handleItemClick = (cmd: Command) => {
    cmd.action();
    closePalette();
  };

  const handleItemMouseEnter = (index: number) => {
    setActiveIndex(index);
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={closePalette} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette-card" onClick={(e) => e.stopPropagation()}>
        <div className="palette-header">
          <label htmlFor="palette-input" className="palette-label">
            <kbd className="palette-kbd">Ctrl</kbd><kbd className="palette-kbd">K</kbd>
          </label>
          <input
            ref={inputRef}
            id="palette-input"
            type="text"
            className="palette-input"
            placeholder="Type a command…"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            autoFocus
            aria-autocomplete="list"
            aria-controls="palette-list"
            aria-activedescendant={filteredCommands[activeIndex]?.id}
          />
        </div>
        <ul
          id="palette-list"
          className="palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {filteredCommands.slice(0, 8).map((cmd, index) => (
            <li
              key={cmd.id}
              id={cmd.id}
              className="palette-item"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => handleItemClick(cmd)}
              onMouseEnter={() => handleItemMouseEnter(index)}
            >
              <span className="palette-title">{cmd.title}</span>
              {cmd.secondary && <span className="palette-secondary">{cmd.secondary}</span>}
            </li>
          ))}
          {filteredCommands.length === 0 && (
            <li className="palette-empty" role="option" aria-disabled="true">
              No commands match
            </li>
          )}
          {filteredCommands.length > 8 && (
            <li className="palette-more" role="option" aria-disabled="true">
              … and {filteredCommands.length - 8} more
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
