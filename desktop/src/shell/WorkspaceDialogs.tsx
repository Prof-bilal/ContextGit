import ModelPicker from "./ModelPicker";
import AddProviderDialog from "./chat/AddProviderDialog";
import ProjectPicker from "./workspace/ProjectPicker";
import { useWorkbench } from "./WorkbenchContext";
import { FeatureRegion } from "./FeatureBoundary";

export function WorkspaceDialogs() {
  const { workspace, choose, pickLocation, createWorkspace, projectOpen, setProjectOpen,
    providers, addProvider, removeProvider, testProvider, fetchProviderModels, model, setModel,
    pickerOpen, setPickerOpen, providerDialog, setProviderDialog, openProviderDialog } = useWorkbench();
  return <>
    {pickerOpen && <FeatureRegion feature="Model picker" onDismiss={() => setPickerOpen(false)} render={() => <ModelPicker
      providers={providers} selection={model} onSelect={setModel}
      onAddProvider={() => openProviderDialog("chat")} onClose={() => setPickerOpen(false)}
    />} />}
    {providerDialog && <FeatureRegion feature="Provider dialog" onDismiss={() => setProviderDialog(null)} render={() => <AddProviderDialog
      providers={providers} initialId={providerDialog.initialId} capability={providerDialog.capability}
      add={addProvider} remove={removeProvider} test={testProvider} fetchModels={fetchProviderModels}
      onSaved={() => undefined} onClose={() => setProviderDialog(null)}
    />} />}
    {projectOpen && <FeatureRegion feature="Project picker" onDismiss={() => setProjectOpen(false)} render={() => <ProjectPicker
      workspace={workspace} onChoose={choose} onPickLocation={pickLocation}
      onCreate={createWorkspace} onClose={() => setProjectOpen(false)}
    />} />}
  </>;
}
