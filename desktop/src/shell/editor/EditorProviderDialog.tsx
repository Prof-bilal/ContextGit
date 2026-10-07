import { useCallback, useEffect, useState } from "react";

import { api, type ProviderInfo } from "@/lib/api";
import AddProviderDialog from "../chat/AddProviderDialog";

/**
 * The editor's provider connector: the same modal as Chat, wired to the
 * editor's own provider store (`/api/v1/editor-providers`).
 */
export default function EditorProviderDialog({
  onChanged,
  onClose,
}: {
  /** Called after a provider is saved/removed so the rail can refresh. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const load = useCallback(async () => {
    try {
      setProviders(await api.editorProviders());
    } catch {
      // the registry may not be ready yet; the dialog still opens
    }
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AddProviderDialog
      title="Connect the editor"
      providers={providers}
      capability="chat"
      add={api.addEditorProvider}
      remove={api.deleteEditorProvider}
      test={api.testEditorProvider}
      fetchModels={api.fetchEditorProviderModels}
      onSaved={() => void load()}
      onClose={onClose}
    />
  );
}
