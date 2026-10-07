import { Chip } from "../primitives";
import EndpointOrigin from "../endpoints/EndpointOrigin";
import type { EndpointsState } from "../endpoints/useEndpoints";

/** The endpoint graph: what the project exposes, and where each one came from. */
export default function EndpointsView({ state }: { state: EndpointsState }) {
  const {
    active,
    loading,
    error,
    notice,
    refresh,
    projectPath,
    scannedFiles,
    server,
    suite,
    busy,
    hasProvider,
    testsFor,
    startServer,
    stopServer,
    generate,
    runAll,
  } = state;

  const test = active ? testsFor(active) : undefined;
  const detected = server?.detected?.command;

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
        <section className="cg-ep-server">
          {server?.running ? (
            <>
              <Chip tone={server.healthy ? "ok" : "warn"}>
                {server.healthy ? "healthy" : "starting"}
              </Chip>
              <span className="cg-mono cg-ep-server-url">{server.url}</span>
              <span className="cg-view-sub">{server.command}</span>
              <span className="cg-toolbar-spacer" />
              <button
                type="button"
                className="cg-btn"
                disabled={busy === "server"}
                onClick={() => void stopServer()}
              >
                Stop server
              </button>
            </>
          ) : (
            <>
              <span className="cg-view-sub">Server</span>
              <span className="cg-mono cg-ep-server-url">
                {detected ?? "no run command detected"}
              </span>
              <span className="cg-toolbar-spacer" />
              <button
                type="button"
                className="cg-btn"
                data-variant="primary"
                disabled={busy === "server" || !detected}
                onClick={() => void startServer()}
              >
                {busy === "server" ? "Starting…" : "Start server"}
              </button>
            </>
          )}
        </section>
        {server?.error && <p className="cg-api-error">{server.error}</p>}
        {server?.running && server.log.length > 0 && (
          <details className="cg-ep-log">
            <summary>Server log ({server.log.length} lines)</summary>
            <pre className="cg-api-pre">{server.log.slice(-40).join("\n")}</pre>
          </details>
        )}
        {notice && <p className="cg-ep-notice">{notice}</p>}
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

            <h2 className="cg-ep-h2">Tests</h2>
            <div className="cg-ep-tests">
              <button
                type="button"
                className="cg-btn"
                data-variant="primary"
                disabled={busy !== null || !hasProvider}
                onClick={() => void generate(active)}
                title={hasProvider ? undefined : "Connect a chat provider first"}
              >
                {busy === "generate" ? "Writing tests…" : "Generate tests"}
              </button>
              <button
                type="button"
                className="cg-btn"
                disabled={busy !== null || !suite?.files.length}
                onClick={() => void runAll()}
              >
                {busy === "run" ? "Running…" : "Run all"}
              </button>
              {test ? (
                <span className="cg-ep-test-status">
                  <Chip
                    tone={
                      test.status === "pass"
                        ? "ok"
                        : test.status === "fail"
                          ? "bad"
                          : undefined
                    }
                  >
                    {test.status}
                  </Chip>
                  <span className="cg-mono cg-view-sub">{test.file}</span>
                  <span className="cg-view-sub">{test.tests.length} tests</span>
                </span>
              ) : (
                <span className="cg-view-sub">
                  {hasProvider
                    ? "No tests yet for this endpoint."
                    : "Connect a provider to write tests."}
                </span>
              )}
            </div>
            {test?.detail && (
              <pre className="cg-api-pre cg-ep-failure">{test.detail}</pre>
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
