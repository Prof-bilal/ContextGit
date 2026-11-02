import ProjectPicker from "./workspace/ProjectPicker";
import { useWorkbench } from "./WorkbenchContext";
import { FeatureRegion } from "./FeatureBoundary";
import CheckpointDialog from "./knowledge/CheckpointDialog";

export function WorkspaceDialogs() {
  const { workspace, choose, pickLocation, createWorkspace, projectOpen, setProjectOpen, checkpointSession, setCheckpointSession, finishCloseAgentTab, setRevision } = useWorkbench();
  return <>
    {checkpointSession && <CheckpointDialog key={checkpointSession.session.id}
      session={checkpointSession.session} closing={checkpointSession.closing}
      onCancel={() => { setCheckpointSession(null); setRevision(v => v + 1); }} onFinish={() => {
        if (checkpointSession.closing) finishCloseAgentTab(checkpointSession.session);
        setCheckpointSession(null);
        setRevision(v => v + 1);
      }} />}
    {projectOpen && <FeatureRegion feature="Project picker" onDismiss={() => setProjectOpen(false)} render={() => <ProjectPicker
      workspace={workspace} onChoose={choose} onPickLocation={pickLocation}
      onCreate={createWorkspace} onClose={() => setProjectOpen(false)}
    />} />}
  </>;
}
