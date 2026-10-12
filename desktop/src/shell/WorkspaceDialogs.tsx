import ProjectPicker from "./workspace/ProjectPicker";
import { useWorkbench } from "./WorkbenchContext";
import { FeatureRegion } from "./FeatureBoundary";

export function WorkspaceDialogs() {
  const { workspace, choose, pickLocation, createWorkspace, projectOpen, setProjectOpen } = useWorkbench();
  return <>
    {projectOpen && <FeatureRegion feature="Project picker" onDismiss={() => setProjectOpen(false)} render={() => <ProjectPicker
      workspace={workspace} onChoose={choose} onPickLocation={pickLocation}
      onCreate={createWorkspace} onClose={() => setProjectOpen(false)}
    />} />}
  </>;
}
