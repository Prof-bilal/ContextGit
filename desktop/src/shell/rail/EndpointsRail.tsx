import type { EndpointsState } from "../endpoints/useEndpoints";

const CONFIDENCE: Array<{ id: EndpointsState["confidence"]; label: string }> = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

function dot(confidence: string): string {
  if (confidence === "high") return "cg-ep-dot cg-api-ok";
  if (confidence === "medium") return "cg-ep-dot cg-api-warn";
  return "cg-ep-dot cg-api-bad";
}

/** Every endpoint of the project, with how sure we are about each finding. */
export default function EndpointsRail({ state }: { state: EndpointsState }) {
  const {
    endpoints,
    active,
    query,
    setQuery,
    confidence,
    setConfidence,
    select,
    loading,
  } = state;

  return (
    <nav className="cg-rail" aria-label="Project endpoints">
      <div className="cg-rail-head">
        <h2>Endpoints</h2>
        <span className="cg-count">{endpoints.length}</span>
      </div>
      <label className="cg-rail-search">
        <input
          value={query}
          placeholder="Filter by path, method or handler"
          aria-label="Filter endpoints"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className="cg-segmented cg-ep-filter"
        aria-label="Discovery confidence"
      >
        {CONFIDENCE.map((item) => (
          <button
            key={item.id}
            type="button"
            className="cg-segment"
            aria-selected={confidence === item.id}
            onClick={() => setConfidence(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && endpoints.length === 0 && (
        <p className="cg-empty-note">Scanning the project…</p>
      )}
      {!loading && endpoints.length === 0 && (
        <p className="cg-empty-note">No endpoints found in this project.</p>
      )}
      {endpoints.map((endpoint) => (
        <button
          key={endpoint.id}
          type="button"
          className="cg-row"
          aria-current={active?.id === endpoint.id}
          onClick={() => select(endpoint)}
        >
          <span className="cg-row-top">
            <span
              className={dot(endpoint.source.confidence)}
              aria-hidden="true"
            />
            <span className="cg-mono">{endpoint.method}</span>
          </span>
          <span className="cg-row-name">{endpoint.path}</span>
          {endpoint.source.file && (
            <span className="cg-row-preview">
              {endpoint.source.file}
              {endpoint.source.line ? `:${endpoint.source.line}` : ""}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
