import { Field } from "../primitives";
import ApiRail from "../rail/ApiRail";
import ApiView from "../views/ApiView";
import { useApiClient } from "../api/useApiClient";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function ApiFeature() {
  const { overlayOpen } = useWorkbench();
  const apiClient = useApiClient();
  const rail = () => {
    return <ApiRail client={apiClient} />;
  };

  const view = () => {
    return <ApiView client={apiClient} obscured={overlayOpen} />;
  };

  const dock = () => {
    {
      const sent = apiClient.response;
      return sent ? (
        <div className="cg-fields">
          <Field label="Status">
            {sent.status} {sent.reason}
          </Field>
          <Field label="Time">{sent.elapsed_ms} ms</Field>
          <Field label="Size">{sent.size} bytes</Field>
          <Field label="Headers">{Object.keys(sent.headers).length}</Field>
          <Field label="URL">
            <span className="cg-mono">{sent.url}</span>
          </Field>
        </div>
      ) : (
        <p className="cg-empty-note">Send a request to inspect the response here.</p>
      );
    }
  };
  return <FeaturePorts id="api"
    title={"Response"}
    rail={rail}
    view={view}
    dock={dock} />;
}
