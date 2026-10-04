export interface LeadSignalData {
  kind: string;
  detail: string;
  source_id?: number | null;
}

/** Lead research output — public signals only, each tied to its source. */
export default function LeadList({
  name,
  website,
  description,
  signals,
}: {
  name: string;
  website?: string;
  description?: string;
  signals: LeadSignalData[];
}) {
  return (
    <div className="cg-lead">
      <header className="cg-block-head">
        <span className="cg-kicker">{name || "Lead"}</span>
        {website && (
          <a className="cg-view-sub" href={website} target="_blank" rel="noreferrer">
            {website}
          </a>
        )}
      </header>
      {description && <p className="cg-council-text">{description}</p>}
      {signals.length > 0 ? (
        <ul className="cg-receipts">
          {signals.map((signal, index) => (
            <li key={`${signal.kind}-${index}`} className="cg-receipt">
              <span className="cg-receipt-kind">{signal.kind}</span>
              <span className="cg-receipt-copy">
                <strong>{signal.detail}</strong>
              </span>
              {signal.source_id != null && (
                <span className="cg-mono">[{signal.source_id}]</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cg-empty-note">No public signals were found in the sources.</p>
      )}
      <p className="cg-empty-note">Public pages only — no contacts were scraped or inferred.</p>
    </div>
  );
}
