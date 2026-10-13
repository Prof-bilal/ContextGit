import PaneCanvas from "./PaneCanvas";
import { useWorkbench } from "../WorkbenchContext";

/** The Code controller can fail and retry without unmounting these live panes. */
export default function TerminalHost() {
  const { sessions, openIds, theme, kickoff, openSession, closeTerminal,
    setRevision, refresh, teamBoard } = useWorkbench();
  const tasks = Array.isArray(teamBoard?.tasks) ? teamBoard.tasks : [];
  const taskIds = Object.fromEntries(tasks.filter(task => task && typeof task.id === "string").flatMap(task => [
    ...(task.session_id ? [[task.session_id, task.id] as const] : []),
    ...(task.verifier_session_id ? [[task.verifier_session_id, task.id] as const] : []),
  ]));
  return <PaneCanvas sessions={sessions} openIds={openIds}
    theme={theme} kickoff={kickoff} taskIds={taskIds}
    onSelect={openSession} onClose={closeTerminal}
    onStaged={() => setRevision(value => value + 1)} onStatus={() => void refresh()} />;
}
