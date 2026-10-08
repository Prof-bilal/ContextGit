import PlaygroundRail from "../rail/PlaygroundRail";
import PlaygroundView from "../views/PlaygroundView";
import PlaygroundDetails from "../playground/PlaygroundDetails";
import { usePlayground } from "../playground/usePlayground";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function PlaygroundFeature() {
  const { activePath } = useWorkbench();
  const playgroundState = usePlayground(activePath ?? null);
  const rail = () => {
    return <PlaygroundRail state={playgroundState} />;
  };

  const view = () => {
    return <PlaygroundView state={playgroundState} />;
  };

  const dock = () => {
    return <PlaygroundDetails state={playgroundState} />;
  };
  return <FeaturePorts id="playground"
    title={"Playground"}
    rail={rail}
    view={view}
    dock={dock}
    hasModal={playgroundState.preview !== null} />;
}
