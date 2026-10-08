import { useCallback, useState } from "react";
import EditorRail from "../rail/EditorRail";
import EditorView from "../views/EditorView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function EditorFeature({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
}) {
  const { tab, overlayOpen, activePath, setProjectOpen } = useWorkbench();
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
      active={embedded || tab === "editor"}
      nonce={editorNonce}
      obscured={overlayOpen}
      onStarted={bumpEditor}
      onClose={onClose}
    />
  </>;
  return <FeaturePorts id={embedded ? "code" : "editor"}
    title={embedded ? "Code editor" : "Editor"}
    rail={rail}
    view={view} />;
}
