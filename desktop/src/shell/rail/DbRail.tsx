import { Chip } from "../primitives";

import type { DbState } from "../db/useDatabase";

/** Saved connections, then the schema of the one that is open. */
export default function DbRail({ state }: { state: DbState }) {
  const { names, spec, open, tables, select, remove, preview, startNew } = state;

  return (
    <nav className="cg-rail" aria-label="Database connections and schema">
      <div className="cg-rail-head">
        <h2>Connections</h2>
        <span className="cg-count">{names.length}</span>
      </div>
      {names.length === 0 && <p className="cg-empty-note">Nothing saved yet.</p>}
      {names.map((name) => (
        <div className="cg-row-wrap" key={name}>
          <button
            type="button"
            className="cg-row"
            aria-current={spec.name === name}
            onClick={() => void select(name)}
          >
            <span className="cg-row-name">{name}</span>
          </button>
          <button
            type="button"
            className="cg-row-delete"
            aria-label={`Delete connection ${name}`}
            onClick={() => void remove(name)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="cg-api-save">
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => startNew("sqlite")}>
          New SQLite
        </button>
        <button type="button" className="cg-btn cg-btn-sm" onClick={() => startNew("postgres")}>
          New Postgres
        </button>
        <button
          type="button"
          className="cg-btn cg-btn-sm"
          onClick={() => startNew("sqlserver")}
        >
          New SQL Server
        </button>
      </div>

      <div className="cg-rail-head">
        <h2>Schema</h2>
        <span className="cg-count">{tables.length}</span>
      </div>
      {!open && <p className="cg-empty-note">Connect to browse tables.</p>}
      {open && tables.length === 0 && (
        <p className="cg-empty-note">No tables in this database.</p>
      )}
      {tables.map((table) => (
        <button
          type="button"
          className="cg-row"
          key={`${table.schema_name ?? ""}.${table.name}`}
          onClick={() => preview(table)}
          title="Write a SELECT for this table"
        >
          <span className="cg-row-top">
            <span className="cg-mono">{table.kind === "view" ? "view" : "table"}</span>
            {table.schema_name && <span className="cg-view-sub">{table.schema_name}</span>}
          </span>
          <span className="cg-row-name">{table.name}</span>
          <span className="cg-row-preview">
            {table.columns.length} columns
          </span>
        </button>
      ))}
      {open && (
        <p className="cg-view-sub">
          <Chip tone={open.readonly ? "ok" : "warn"}>
            {open.readonly ? "read-only" : "writes allowed"}
          </Chip>
        </p>
      )}
    </nav>
  );
}
