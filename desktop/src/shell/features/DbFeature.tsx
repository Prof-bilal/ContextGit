import { Field } from "../primitives";
import DbRail from "../rail/DbRail";
import DbView from "../views/DbView";
import { useDatabase } from "../db/useDatabase";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";


export default function DbFeature() {
  const { overlayOpen } = useWorkbench();
  const dbState = useDatabase();
  const rail = () => {
    return <DbRail state={dbState} />;
  };

  const view = () => {
    return <DbView state={dbState} obscured={overlayOpen} />;
  };

  const dock = () => {
    {
      const info = dbState.open;
      return info ? (
        <div className="cg-fields">
          <Field label="Connection">{info.name}</Field>
          <Field label="Engine">{info.engine}</Field>
          <Field label="Server">
            <span className="cg-mono">{info.server_version ?? "—"}</span>
          </Field>
          <Field label="Database">{info.database ?? "—"}</Field>
          <Field label="Writes">{info.readonly ? "refused (read-only)" : "allowed"}</Field>
          <Field label="Schema">{dbState.tables.length} tables/views</Field>
        </div>
      ) : (
        <p className="cg-empty-note">
          Connect to a database and its details land here.
        </p>
      );
    }
  };
  return <FeaturePorts id="db"
    title={"Database"}
    rail={rail}
    view={view}
    dock={dock} />;
}
