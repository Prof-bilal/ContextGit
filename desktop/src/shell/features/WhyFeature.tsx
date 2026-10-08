import WhyRail from "../rail/WhyRail";
import WhyView, { WhyFindingDetail } from "../views/WhyView";
import { useWhy } from "../why/useWhy";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function WhyFeature() {
  const { activePath, model, whyRequest } = useWorkbench();
  const whyState = useWhy(
    activePath ?? null,
    { providerId: model.providerId, modelId: model.modelId },
    whyRequest,
  );
  const rail = () => {
    return <WhyRail state={whyState} />;
  };

  const view = () => {
    return <WhyView state={whyState} />;
  };

  const dock = () => {
    {
      const finding = whyState.answer?.findings[0];
      return finding ? (
        <WhyFindingDetail finding={finding} />
      ) : (
        <p className="cg-empty-note">
          Ask why a file or line exists and the reasoning lands here.
        </p>
      );
    }
  };
  return <FeaturePorts id="why"
    title={"Why"}
    rail={rail}
    view={view}
    dock={dock} />;
}
