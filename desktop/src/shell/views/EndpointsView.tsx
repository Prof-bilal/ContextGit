import { Chip } from "../primitives";
import EndpointOrigin from "../endpoints/EndpointOrigin";
import type { EndpointsState } from "../endpoints/useEndpoints";

/** The endpoint graph: what the project exposes, and where each one came from. */
export default function EndpointsView({ state }: { state: EndpointsState }) {
  const { active, loading, error, refresh, projectPath, scannedFiles } = state;

  return (
    <div className="cg-view" data-active="true">
      <div className="cg-view-toolbar">
        <h1>Endpoints</h1>
        <span className="cg-view-sub">
          {projectPath ? `${projectPath} · ` : ""}
          {state.endpoints.length} found · {scannedFiles} files scanned
        </span>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-btn"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>
      <div className="cg-view-body">
        {error && <p className="cg-api-error">{error}</p>}
        {!active ? (
          <p className="cg-empty-note">
            No endpoints found yet. Pick a project folder that contains a
            server, or rescan.
          </p>
        ) : (
          <section className="cg-ep">
            <header className="cg-ep-head">
              <span className="cg-mono cg-ep-method">{active.method}</span>
              <span className="cg-mono cg-ep-path">{active.path}</span>
              {active.auth && <Chip tone="ok">auth</Chip>}
              {active.response_status && (
                <Chip>HTTP {active.response_status}</Chip>
              )}
              <Chip tone={active.source.confidence === "high" ? "ok" : "warn"}>
                {active.source.confidence} confidence
              </Chip>
              <Chip>{active.source.kind}</Chip>
            </header>
            {active.operation && (
              <p className="cg-ep-operation">{active.operation}</p>
            )}
            {active.tags.length > 0 && (
              <p className="cg-view-sub">Tags: {active.tags.join(", ")}</p>
            )}
            {active.source.file && (
              <p className="cg-view-sub">
                Handler{" "}
                <span className="cg-mono">
                  {active.source.file}
                  {active.source.line ? `:${active.source.line}` : ""}
                </span>
              </p>
            )}

            <h2 className="cg-ep-h2">Request</h2>
            {active.request_fields.length === 0 ? (
              <p className="cg-empty-note">
                No inputs detected for this endpoint.
              </p>
            ) : (
              <dl className="cg-fields">
                {active.request_fields.map((field) => (
                  <div
                    className="cg-field"
                    key={`${field.location}:${field.name}`}
                  >
                    <dt>{field.location}</dt>
                    <dd>
                      <span className="cg-mono">{field.name}</span>
                      {field.type ? ` · ${field.type}` : ""}
                      {field.required ? " · required" : " · optional"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <h2 className="cg-ep-h2">Origin</h2>
            <EndpointOrigin endpoint={active} />
          </section>
        )}
      </div>
    </div>
  );
}
