import { useMemo, useState, type MouseEvent } from "react";
import { LuFolder, LuLoaderCircle, LuPlus, LuX } from "react-icons/lu";

import type { Session } from "../../shared/api";
import type { Workspace } from "../../shared/workspace";

type ProjectTabsProps = {
  projects: Workspace[];
  activePath: string | null;
  sessions: Session[];
  openIds: string[];
  onUseProject: (path: string) => Promise<unknown> | void;
  onForgetProject: (path: string) => Promise<unknown> | void;
  onChooseProject: () => void;
};

function projectSessionCount(sessions: Session[], path: string): number {
  return sessions.filter((session) => session.project_path === path).length;
}

/** A lightweight workspace switcher for projects with active agent work. */
export default function ProjectTabs({
  projects,
  activePath,
  sessions,
  openIds,
  onUseProject,
  onForgetProject,
  onChooseProject,
}: ProjectTabsProps) {
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(
    () => new Map(projects.map((project) => [project.path, projectSessionCount(sessions, project.path)])),
    [projects, sessions],
  );

  const switchProject = async (path: string) => {
    if (path === activePath || busyPath) return;
    setBusyPath(path);
    setError(null);
    try {
      await onUseProject(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch project");
    } finally {
      setBusyPath(null);
    }
  };

  const closeProject = async (event: MouseEvent<HTMLButtonElement>, path: string) => {
    event.stopPropagation();
    if (busyPath) return;
    setBusyPath(path);
    setError(null);
    try {
      await onForgetProject(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not close project tab");
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div className="cg-project-tabs-wrap" aria-label="Open projects">
      <div className="cg-project-tabs" role="tablist" aria-label="Project tabs">
        {projects.map((project) => {
          const active = project.path === activePath;
          const busy = project.path === busyPath;
          const count = counts.get(project.path) ?? 0;
          const running = sessions.filter(session => session.project_path === project.path && openIds.includes(session.id) && session.status === "running").length;
          const offline = count - running;
          return (
            <div key={project.path} className="cg-project-tab-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${project.name}, ${running} running, ${offline} offline agents`}
                className="cg-project-tab"
                data-active={active}
                onClick={() => void switchProject(project.path)}
              >
                {busy ? <LuLoaderCircle className="cg-project-tab-spinner" aria-hidden="true" /> : <LuFolder aria-hidden="true" />}
                <span className="cg-project-tab-name">{project.name}</span>
                {count > 0 && <span className="cg-project-tab-count" data-offline={running === 0} aria-label={`${running} running, ${offline} offline`} title={`${running} running, ${offline} offline`}><span className="cg-project-count-dot" aria-hidden="true" />{count}</span>}
              </button>
              <button
                type="button"
                className="cg-project-tab-close"
                aria-label={`Close ${project.name} tab`}
                title="Close project tab"
                onClick={(event) => void closeProject(event, project.path)}
              >
                <LuX aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <button type="button" className="cg-project-tab-add" aria-label="Open project" title="Open project" onClick={onChooseProject}>
          <LuPlus aria-hidden="true" />
        </button>
      </div>
      {error && <span className="cg-project-tabs-error" role="alert">{error}</span>}
    </div>
  );
}
