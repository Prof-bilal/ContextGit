import { useState } from "react";

import { Chip } from "../primitives";

import DbGatePanel from "../db/DbGatePanel";
import { DEFAULT_SQL, type DbState } from "../db/useDatabase";

/** The DB tab: the native quick-query runner, or the embedded DbGate client. */
export default function DbView({
  state,
  obscured = false,
}: {
  state: DbState;
  /** A dialog is open; hide the embedded native view so it is not covered. */
  obscured?: boolean;
}) {
  const [mode, setMode] = useState<"query" | "dbgate">("query");
  const {
    spec,
    patch,
    password,
    setPassword,
    drivers,
    open,
    sql,
    setSql,
    result,
    busy,
    error,
    notice,
    save,
    connect,
    disconnect,
    run,
  } = state;

  const network = spec.engine !== "sqlite";
  const ready = drivers[spec.engine] !== false;

  return (
    <div className="cg-view" data-active="true">
      <div className="cg-view-toolbar">
        <h1>Database</h1>
        <span className="cg-view-sub">
          {mode === "dbgate"
            ? "A full database client, embedded in the workspace"
            : "Passwords are never stored — they live only while the connection is open"}
        </span>
        <span className="cg-toolbar-spacer" />
        <div className="cg-mini-seg" role="tablist" aria-label="Database view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "query"}
            onClick={() => setMode("query")}
          >
            Query
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "dbgate"}
            onClick={() => setMode("dbgate")}
          >
            DbGate
          </button>
        </div>
      </div>
      {mode === "dbgate" ? (
        <DbGatePanel obscured={obscured} />
      ) : (
      <div className="cg-view-body">
        <div className="cg-db-bar">
          <input
            className="cg-input cg-db-name"
            aria-label="Connection name"
            placeholder="name"
            value={spec.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
          <select
            className="cg-input cg-db-engine"
            aria-label="Engine"
            value={spec.engine}
            onChange={(event) => patch({ engine: event.target.value as typeof spec.engine })}
          >
            <option value="sqlite">SQLite</option>
            <option value="postgres">Postgres</option>
            <option value="sqlserver">SQL Server</option>
          </select>
          {spec.engine === "sqlite" ? (
            <input
              className="cg-input cg-db-wide"
              aria-label="Database file"
              placeholder="/path/to/app.db"
              value={spec.path ?? ""}
              onChange={(event) => patch({ path: event.target.value })}
            />
          ) : (
            <>
              <input
                className="cg-input"
                aria-label="Host"
                placeholder="host"
                value={spec.host ?? ""}
                onChange={(event) => patch({ host: event.target.value })}
              />
              <input
                className="cg-input cg-db-port"
                aria-label="Port"
                placeholder={spec.engine === "postgres" ? "5432" : "1433"}
                value={spec.port ?? ""}
                onChange={(event) =>
                  patch({ port: Number.parseInt(event.target.value, 10) || null })
                }
              />
              <input
                className="cg-input"
                aria-label="Database"
                placeholder="database"
                value={spec.database ?? ""}
                onChange={(event) => patch({ database: event.target.value })}
              />
              <input
                className="cg-input"
                aria-label="User"
                placeholder="user"
                value={spec.user ?? ""}
                onChange={(event) => patch({ user: event.target.value })}
              />
              <input
                className="cg-input"
                type="password"
                aria-label="Password"
                placeholder="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          )}
          <label className="cg-db-check">
            <input
              type="checkbox"
              checked={spec.readonly}
              onChange={(event) => patch({ readonly: event.target.checked })}
            />
            read-only
          </label>
          <button type="button" className="cg-btn" disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          {open ? (
            <button
              type="button"
              className="cg-btn"
              disabled={busy !== null}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy !== null || !ready}
              onClick={() => void connect()}
            >
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>

        {!ready && (
          <p className="cg-api-error">
            The {spec.engine} driver is not installed — run{" "}
            <span className="cg-mono">pip install &quot;contextgit[db]&quot;</span> and
            restart the app.
          </p>
        )}
        {open && (
          <div className="cg-db-status">
            <Chip tone="ok">connected</Chip>
            <span className="cg-mono cg-view-sub">{open.server_version ?? open.engine}</span>
            {open.database && <span className="cg-view-sub">{open.database}</span>}
            {open.readonly && <Chip tone="ok">read-only</Chip>}
          </div>
        )}
        {notice && <p className="cg-ep-notice">{notice}</p>}
        {error && <p className="cg-api-error">{error}</p>}

        <div className="cg-db-query">
          <textarea
            className="cg-input cg-mono cg-db-sql"
            aria-label="SQL"
            placeholder={DEFAULT_SQL}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
            }}
          />
          <div className="cg-ep-tests">
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={busy !== null || !open || !sql.trim()}
              onClick={() => void run()}
            >
              {busy === "query" ? "Running…" : "Run"}
            </button>
            <span className="cg-view-sub">⌘↵ also runs</span>
            {result && (
              <span className="cg-view-sub">
                {result.row_count} row{result.row_count === 1 ? "" : "s"} in{" "}
                {result.elapsed_ms} ms
                {result.truncated ? ` · showing the first ${result.rows.length}` : ""}
              </span>
            )}
          </div>
        </div>

        {result && result.columns.length > 0 && (
          <div className="cg-db-results">
            <table className="cg-db-table">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell ?? <span className="cg-view-sub">null</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 && (
              <p className="cg-empty-note">No rows returned.</p>
            )}
          </div>
        )}
        {result && result.columns.length === 0 && (
          <p className="cg-ep-notice">
            The statement ran and returned no result set ({result.elapsed_ms} ms).
          </p>
        )}
      </div>
      )}
    </div>
  );
}
