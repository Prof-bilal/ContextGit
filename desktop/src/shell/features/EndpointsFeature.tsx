import EndpointsRail from "../rail/EndpointsRail";
import EndpointsView from "../views/EndpointsView";
import EndpointOrigin from "../endpoints/EndpointOrigin";
import { useEndpoints } from "../endpoints/useEndpoints";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function EndpointsFeature() {
  const { activePath, model, setWhyRequest, setTab } = useWorkbench();
  const endpointsState = useEndpoints(activePath ?? null, {
    providerId: model.providerId,
    modelId: model.modelId,
  });
  const rail = () => {
    return <EndpointsRail state={endpointsState} />;
  };

  const view = () => {
    return (
      <EndpointsView
        state={endpointsState}
        onWhy={(path, line) => {
          setWhyRequest({ path, line, nonce: Date.now() });
          setTab("code");
        }}
      />
    );
  };

  const dock = () => {
    return endpointsState.active ? (
      <EndpointOrigin endpoint={endpointsState.active} />
    ) : (
      <p className="cg-empty-note">Pick an endpoint to see where it came from.</p>
    );
  };
  return <FeaturePorts id="endpoints"
    title={"Origin"}
    rail={rail}
    view={view}
    dock={dock} />;
}
