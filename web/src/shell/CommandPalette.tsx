import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LuSearch } from "react-icons/lu";
import Modal from "./Modal";

export type PaletteCommand = { id: string; label: string; detail?: string; icon: ReactNode; run: () => unknown | Promise<unknown> };

export default function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const listId = useId();
  const filtered = commands.filter(command => `${command.label} ${command.detail ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 100);
  const index = Math.min(selected, Math.max(0, filtered.length - 1));
  useEffect(() => { mounted.current = true; input.current?.focus(); return () => { mounted.current = false; }; }, []);
  useEffect(() => { document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" }); }, [index, listId, query]);
  const execute = async (command: PaletteCommand) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await command.run(); if (mounted.current) onClose(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Command failed"); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Modal title="Command palette" onClose={onClose}>
    <div className="cg-command-search">
      <LuSearch aria-hidden="true" />
      <input ref={input} role="combobox" aria-label="Search commands" aria-expanded="true" aria-autocomplete="list" aria-controls={listId}
        aria-activedescendant={filtered.length ? `${listId}-${index}` : undefined}
        placeholder="Search commands, projects, or sessions…" value={query} readOnly={busy}
        onChange={event => { setQuery(event.target.value); setSelected(0); }}
        onKeyDown={event => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Home") setSelected(0);
            else if (event.key === "End") setSelected(Math.max(0, filtered.length - 1));
            else setSelected(filtered.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length : 0);
          } else if (event.key === "Enter") { event.preventDefault(); if (filtered[index]) void execute(filtered[index]); }
        }} />
    </div>
    <div className="cg-command-results" id={listId} role="listbox" aria-label="Commands" aria-busy={busy}>
      {filtered.map((command, item) => <div key={command.id} id={`${listId}-${item}`} role="option" aria-selected={index === item}
        className="cg-command-option" aria-disabled={busy} onMouseEnter={() => setSelected(item)} onMouseDown={event => event.preventDefault()}
        onClick={() => void execute(command)}>
        <span aria-hidden="true">{command.icon}</span><span><strong>{command.label}</strong>{command.detail && <small>{command.detail}</small>}</span>
      </div>)}
    </div>
    {!filtered.length && <p className="cg-empty-note" role="status">No matching commands.</p>}
    {busy && <p className="cg-empty-note" role="status">Running command…</p>}
    {error && <p className="cg-form-warn" role="alert">{error}</p>}
    <p className="cg-command-help">↑ ↓ to select · Enter to run · Esc to close</p>
  </Modal>;
}
