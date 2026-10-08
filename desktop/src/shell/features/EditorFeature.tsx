import { useCallback, useState } from "react";
import EditorRail from "../rail/EditorRail";
import EditorView from "../views/EditorView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function EditorFeature({
  onClose,
}: {
  onClose?: () => void;
}) {
  const { overlayOpen, activePath, setProjectOpen } = useWorkbench();
  const [editorNonce, setEditorNonce] = useState(0);

  const bumpEditor = useCallback(() => setEditorNonce((value) => value + 1), []);
  const rail = () => {
    return (
      <EditorRail
        reloadKey={editorNonce}
        activePath={activePath}
        onStarted={bumpEditor}
        onOpenFolder={() => setProjectOpen(true)}
      />
    );
  };

  const view = () => <>
    <EditorView
      active
      nonce={editorNonce}
      obscured={overlayOpen}
      onStarted={bumpEditor}
      onClose={onClose}
    />
  </>;
  return <FeaturePorts id="code"
    title="Code editor"
    rail={rail}
    view={view} />;
}
