import { Chip } from "../primitives";
import EndpointOrigin from "../endpoints/EndpointOrigin";
import type { EndpointsState } from "../endpoints/useEndpoints";

/** The endpoint graph: what the project exposes, and where each one came from. */
export default function EndpointsView({
  state,
  onWhy,
}: {
  state: EndpointsState;
  onWhy?: (path: string, line: number | null) => void;
}) {
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
    command,
    setCommand,
    testsFor,
    bisect,
    findRegression,
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
          {suite?.stale ? ` · ${suite.stale} stale` : ""}
          {suite?.retired ? ` · ${suite.retired} retired` : ""}
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
              <Chip tone={server.healthy ? "ok" : server.error ? "bad" : "warn"}>
                {server.healthy ? "healthy" : server.error ? "crashed" : "starting"}
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
              <input
                className="cg-input cg-mono cg-ep-command"
                aria-label="Run command"
                placeholder="the command that starts this project, e.g. npm run dev"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && command.trim())
                    void startServer();
                }}
              />
              {detected && detected !== command && (
                <button
                  type="button"
                  className="cg-btn cg-btn-sm"
                  onClick={() => setCommand(detected)}
                  title="Use the command ContextGit detected"
                >
                  Use detected
                </button>
              )}
              <span className="cg-toolbar-spacer" />
              <button
                type="button"
                className="cg-btn"
                data-variant="primary"
                disabled={busy === "server" || !command.trim()}
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
              <div className="cg-ep-headline">
                <span className="cg-mono cg-ep-method">{active.method}</span>
                <span className="cg-mono cg-ep-path">{active.path}</span>
              </div>
              <div className="cg-ep-meta">
                {active.auth && <Chip tone="ok">auth</Chip>}
                {active.response_status && (
                  <Chip>HTTP {active.response_status}</Chip>
                )}
                <Chip
                  tone={active.source.confidence === "high" ? "ok" : "warn"}
                >
                  {active.source.confidence} confidence
                </Chip>
                <Chip>{active.source.kind}</Chip>
              </div>
            </header>
            {active.operation && (
              <p className="cg-ep-operation">{active.operation}</p>
            )}
            {active.tags.length > 0 && (
              <p className="cg-view-sub">Tags: {active.tags.join(", ")}</p>
            )}
            {active.source.file && (
              <p className="cg-ep-handler">
                <span className="cg-ep-handler-label">Handler</span>
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
                disabled={busy !== null || !suite?.files.length || !server?.healthy}
                title={
                  server?.healthy
                    ? undefined
                    : "Start the server first — the tests need a URL to hit"
                }
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
                  {test.state !== "untested" && (
                    <Chip
                      tone={
                        test.state === "fresh"
                          ? "ok"
                          : test.state === "stale"
                            ? "warn"
                            : "bad"
                      }
                    >
                      {test.state}
                    </Chip>
                  )}
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
              {!server?.healthy && suite?.files.length && (
                <span className="cg-view-sub">
                  Start the server to run these tests.
                </span>
              )}
              {test && (test.state === "stale" || test.status === "fail") && (
                <button
                  type="button"
                  className="cg-btn cg-btn-sm"
                  disabled={busy !== null}
                  onClick={() => void findRegression(active)}
                  title="Search the project's history for the change that broke this"
                >
                  {busy === "bisect" ? "Searching…" : "What broke it?"}
                </button>
              )}
            </div>
            {test?.reason && (
              <p
                className={
                  test.state === "stale" ? "cg-ep-reason cg-api-warn" : "cg-ep-reason cg-api-bad"
                }
              >
                {test.reason}
              </p>
            )}
            {bisect && (
              <div className="cg-ep-bisect">
                {bisect.culprit ? (
                  <>
                    <p className="cg-ep-operation">
                      Broke in <span className="cg-mono">{bisect.culprit.slice(0, 7)}</span>{" "}
                      {bisect.culprit_summary ?? ""}
                      <span className="cg-view-sub"> · {bisect.probes} probes</span>
                    </p>
                    {bisect.run_name && (
                      <p className="cg-view-sub">From the run “{bisect.run_name}”</p>
                    )}
                    {bisect.decisions.length > 0 && (
                      <>
                        <h2 className="cg-ep-h2">Decided there</h2>
                        <ul className="cg-why-list">
                          {bisect.decisions.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {bisect.dead_ends.length > 0 && (
                      <>
                        <h2 className="cg-ep-h2">Rejected there</h2>
                        <ul className="cg-why-list">
                          {bisect.dead_ends.map((item, index) => (
                            <li key={index} className="cg-api-warn">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {bisect.env_drift.length > 0 && (
                      <>
                        <h2 className="cg-ep-h2">Environment drift between runs</h2>
                        <ul className="cg-why-list">
                          {bisect.env_drift.map((item) => (
                            <li key={item.key}>
                              <span className="cg-mono">{item.key}</span> {item.change}
                              {item.change === "changed" ? " between the two runs" : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <p className="cg-ep-notice">
                    {bisect.note ?? "No culprit found in this range."}
                  </p>
                )}
              </div>
            )}
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

            <div className="cg-ep-origin-head">
              <h2 className="cg-ep-h2">Origin</h2>
              {active.source.file && onWhy && (
                <button
                  type="button"
                  className="cg-btn cg-btn-sm"
                  onClick={() =>
                    onWhy(active.source.file as string, active.source.line ?? null)
                  }
                  title="Read why this handler exists, and what was rejected"
                >
                  Why is this here?
                </button>
              )}
            </div>
            <EndpointOrigin endpoint={active} />
          </section>
        )}
      </div>
    </div>
  );
}
