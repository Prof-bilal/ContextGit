import { useState } from "react";
import BrowserRail from "../rail/BrowserRail";
import BrowserView from "../views/BrowserView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function BrowserFeature() {
  const { tab, overlayOpen } = useWorkbench();
  const [browserRequest, setBrowserRequest] = useState<{ url: string; nonce: number } | null>(null);
  const rail = () => {
    return <BrowserRail onOpen={(url) => setBrowserRequest({ url, nonce: Date.now() })} />;
  };

  const view = () => <>
    <BrowserView
      active={tab === "browser"}
      request={browserRequest}
      obscured={overlayOpen}
    />
  </>;
  return <FeaturePorts id="browser"
    title={"Page"}
    rail={rail}
    view={view} />;
}
