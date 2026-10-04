export interface ComparisonRowData {
  competitor: string;
  pricing?: string;
  positioning?: string;
  features?: string[];
  target?: string;
  weaknesses?: string[];
  sources?: number[];
}

/** Competitive research output: a matrix, not prose. */
export default function ComparisonTable({
  rows,
  howWeDiffer,
}: {
  rows: ComparisonRowData[];
  howWeDiffer?: string;
}) {
  if (rows.length === 0) {
    return <p className="cg-empty-note">No competitors were extracted from the sources.</p>;
  }
  return (
    <div className="cg-compare">
      <table className="cg-matrix">
        <thead>
          <tr>
            <th scope="col">Competitor</th>
            <th scope="col">Pricing</th>
            <th scope="col">Positioning</th>
            <th scope="col">Features</th>
            <th scope="col">Target</th>
            <th scope="col">Weaknesses</th>
            <th scope="col">Sources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.competitor}>
              <th scope="row">{row.competitor}</th>
              <td>{row.pricing ?? ""}</td>
              <td>{row.positioning ?? ""}</td>
              <td>{(row.features ?? []).join("; ")}</td>
              <td>{row.target ?? ""}</td>
              <td>{(row.weaknesses ?? []).join("; ")}</td>
              <td className="cg-mono">
                {(row.sources ?? []).map((id) => `[${id}]`).join(" ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {howWeDiffer && <p className="cg-empty-note">How we differ: {howWeDiffer}</p>}
    </div>
  );
}
