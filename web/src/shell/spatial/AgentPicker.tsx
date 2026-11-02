import { useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import { HARNESSES, harnessFor } from "@/shared/harnesses";
import { AgentMark } from "../primitives";

export default function AgentPicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = harnessFor(value) ?? HARNESSES[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };
  const show = () => {
    setActive(Math.max(0, HARNESSES.findIndex((agent) => agent.id === value)));
    setOpen(true);
  };

  return (
    <div className="sp-agent-picker" ref={host}>
      <button ref={trigger} type="button" className="sp-agent-picker-trigger"
        aria-label="CLI" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? id : undefined} disabled={disabled}
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); show();
          }
        }}
      >
        <AgentMark agent={selected.id} label={selected.monogram} />
        <span>{selected.label}</span>
        <LuChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="sp-agent-picker-menu">
          <div className="sp-agent-picker-heading">Choose an agent <span>{HARNESSES.length} CLIs</span></div>
          <div ref={list} id={id} className="sp-agent-picker-list" role="listbox"
            aria-label="Agent CLI" tabIndex={0} aria-activedescendant={`${id}-${active}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation(); setOpen(false); trigger.current?.focus();
              } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? HARNESSES.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + HARNESSES.length) % HARNESSES.length);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault(); choose(HARNESSES[active].id);
              } else if (event.key === "Tab") setOpen(false);
            }}
          >
            {HARNESSES.map((agent, index) => (
              <div key={agent.id} id={`${id}-${index}`} role="option"
                aria-selected={agent.id === value} data-highlighted={active === index}
                className="sp-agent-picker-option" onPointerMove={() => setActive(index)}
                onClick={() => choose(agent.id)}
              >
                <AgentMark agent={agent.id} label={agent.monogram} />
                <span><strong>{agent.label}</strong><small>{agent.command ?? "Default shell"}</small></span>
                {agent.id === value && <LuCheck className="sp-agent-picker-check" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
