import { useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuFolderOpen } from "react-icons/lu";

type Project = { name: string; path: string };

export default function ProjectMenu({ projects, value, onChange, disabled = false }: {
  projects: Project[];
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
  const selected = projects.find((project) => project.path === value);
  const expanded = open && !disabled && projects.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);

  useEffect(() => {
    if (expanded) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, id]);

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
    trigger.current?.focus();
  };
  const show = () => {
    setActive(Math.max(0, projects.findIndex((project) => project.path === value)));
    setOpen(true);
  };

  return (
    <div className="sp-agent-picker sp-project-menu" ref={host}>
      <button ref={trigger} type="button" className="sp-agent-picker-trigger sp-project-menu-trigger"
        aria-label="Run project" aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? id : undefined} disabled={disabled || !projects.length}
        onClick={() => expanded ? setOpen(false) : show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); show();
          }
        }}
      >
        <span>{selected?.name ?? "Choose a project"}</span>
        <LuChevronDown aria-hidden="true" />
      </button>
      {expanded && (
        <div className="sp-agent-picker-menu">
          <div className="sp-agent-picker-heading">Choose a project <span>{projects.length} projects</span></div>
          <div ref={list} id={id} className="sp-agent-picker-list" role="listbox"
            aria-label="Projects" tabIndex={0} aria-activedescendant={`${id}-${active}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation(); setOpen(false); trigger.current?.focus();
              } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? projects.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + projects.length) % projects.length);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                const project = projects[active];
                if (project) choose(project.path);
              } else if (event.key === "Tab") setOpen(false);
            }}
          >
            {projects.map((project, index) => (
              <div key={project.path} id={`${id}-${index}`} role="option"
                aria-selected={project.path === value} data-highlighted={active === index}
                className="sp-agent-picker-option" onPointerMove={() => setActive(index)}
                onClick={() => choose(project.path)} title={project.path}
              >
                <span className="sp-project-menu-icon"><LuFolderOpen aria-hidden="true" /></span>
                <span><strong>{project.name}</strong><small>{project.path}</small></span>
                {project.path === value && <LuCheck className="sp-agent-picker-check" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
