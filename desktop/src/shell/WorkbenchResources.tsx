import { createContext, useContext, type ReactNode } from "react";
import { createIsolatedResource } from "./isolatedResource";
import { useSessions } from "./terminal/useSessions";
import { useTeam } from "./team/useTeam";
import { useProjects } from "./workspace/useProjects";
import { useTrash } from "./storage/useTrash";
import { useRepo } from "./git/useRepo";
import { useProviders } from "./chat/useProviders";

const unavailable = async (): Promise<never> => { throw new Error("This data source is unavailable. Try again before making changes."); };
const refreshUnavailable = async () => { };
const useSessionsSource = createIsolatedResource<ReturnType<typeof useSessions>>("Sessions", useSessions, {
  sessions: [], loaded: false, removedIds: [], error: null, refresh: refreshUnavailable,
  create: unavailable, remove: unavailable, setAutoCommit: unavailable, stop: unavailable,
});
const useTeamSource = createIsolatedResource<ReturnType<typeof useTeam>>("Team data", useTeam, {
  board: null, error: null, refresh: refreshUnavailable, act: unavailable,
});
const useProjectsSource = createIsolatedResource<ReturnType<typeof useProjects>>("Projects", useProjects, {
  projects: [], workspace: null, activePath: null, error: null, choose: unavailable,
  pickLocation: unavailable, create: unavailable, use: unavailable, forget: unavailable, reload: refreshUnavailable,
});
const useTrashSource = createIsolatedResource<ReturnType<typeof useTrash>>("Storage data", useTrash, {
  sessions: [], branches: [], error: null, refresh: refreshUnavailable,
});
const useRepoSource = createIsolatedResource<ReturnType<typeof useRepo>>("Repository", useRepo, {
  snapshot: null, loading: true, error: null, refresh: refreshUnavailable,
});
const useProvidersSource = createIsolatedResource<ReturnType<typeof useProviders>>("Providers", useProviders, {
  providers: [], loading: true, error: null, refresh: refreshUnavailable,
  add: unavailable, remove: unavailable, test: unavailable, fetchModels: unavailable,
});

type Resources = {
  sessions: ReturnType<typeof useSessions>;
  team: ReturnType<typeof useTeam>;
  projects: ReturnType<typeof useProjects>;
  trash: ReturnType<typeof useTrash>;
  repo: ReturnType<typeof useRepo>;
  providers: ReturnType<typeof useProviders>;
};
const Context = createContext<Resources | null>(null);

export function WorkbenchResources({ children }: { children: ReactNode }) {
  const sessions = useSessionsSource();
  const team = useTeamSource();
  const projects = useProjectsSource();
  const trash = useTrashSource();
  const repo = useRepoSource();
  const providers = useProvidersSource();
  return <Context.Provider value={{
    sessions: sessions.value, team: team.value, projects: projects.value,
    trash: trash.value, repo: repo.value, providers: providers.value
  }}>
    <div className="cg-resource-errors" aria-label="Data source errors">
      {sessions.host}{team.host}{projects.host}{trash.host}{repo.host}{providers.host}
    </div>
    {children}
  </Context.Provider>;
}

function useResources() {
  const value = useContext(Context);
  if (!value) throw new Error("Workbench resources are missing");
  return value;
}
export const useSessionResource = () => useResources().sessions;
export const useTeamResource = () => useResources().team;
export const useProjectResource = () => useResources().projects;
export const useTrashResource = () => useResources().trash;
export const useRepoResource = () => useResources().repo;
export const useProviderResource = () => useResources().providers;
