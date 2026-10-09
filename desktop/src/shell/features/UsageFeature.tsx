import { useState } from "react";
import UsageView from "../views/UsageView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";

const USAGE_PERIODS: Array<{ label: string; days: number | undefined }> = [
  { label: "All time", days: undefined },
  { label: "Last 7 days", days: 7 },
  { label: "Today", days: 1 },
];

export default function UsageFeature({
  onClose,
}: {
  onClose?: () => void;
}) {
  const { providers } = useWorkbench();
  const [usageDays, setUsageDays] = useState<number | undefined>(undefined);
  const rail = () => {
    return (
      <nav className="cg-rail" aria-label="Usage period">
        <div className="cg-rail-head">
          <h2>Period</h2>
        </div>
        {USAGE_PERIODS.map((period) => (
          <button
            key={period.label}
            type="button"
            className="cg-row"
            aria-current={usageDays === period.days}
            onClick={() => setUsageDays(period.days)}
          >
            <span className="cg-row-title">{period.label}</span>
          </button>
        ))}
      </nav>
    );
  };

  const view = () => {
    return <UsageView days={usageDays} providers={providers} />;
  };
  const footer = () => onClose ? (
    <footer className="cg-bottombar" aria-label="Usage actions">
      <span className="cg-bb-info">
        <strong>Usage</strong>
        <span className="cg-view-sub">Provider activity across the workspace.</span>
      </span>
      <span className="cg-bb-actions cg-bb-end">
        <button type="button" className="cg-btn" onClick={onClose}>Back to agents</button>
      </span>
    </footer>
  ) : null;
  return <FeaturePorts id="issues"
    title={"Usage"}
    rail={rail}
    view={view}
    footer={footer} />;
}
