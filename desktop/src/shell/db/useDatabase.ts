import { useCallback, useEffect, useState } from "react";

import {
  api,
  type DbConnectionInfo,
  type DbConnectionSpec,
  type DbEngine,
  type DbQueryResult,
  type DbTable,
} from "@/lib/api";

export const BLANK_SPEC: DbConnectionSpec = {
  name: "",
  engine: "postgres",
  path: null,
  host: "localhost",
  port: null,
  database: null,
  user: null,
  ssl: true,
  readonly: true,
};

export const DEFAULT_SQL = "SELECT 1 AS hello;";

export interface DbState {
  names: string[];
  spec: DbConnectionSpec;
  patch: (patch: Partial<DbConnectionSpec>) => void;
  password: string;
  setPassword: (value: string) => void;
  drivers: Record<string, boolean>;
  open: DbConnectionInfo | null;
  tables: DbTable[];
  sql: string;
  setSql: (value: string) => void;
  result: DbQueryResult | null;
  busy: string | null;
  error: string | null;
  notice: string | null;
  load: () => Promise<void>;
  select: (name: string) => Promise<void>;
  startNew: (engine?: DbEngine) => void;
  save: () => Promise<void>;
  remove: (name: string) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  run: () => Promise<void>;
  preview: (table: DbTable) => void;
}

/** The DB tab: saved connections, one live handle, and a query runner. */
export function useDatabase(): DbState {
  const [names, setNames] = useState<string[]>([]);
  const [spec, setSpec] = useState<DbConnectionSpec>({ ...BLANK_SPEC });
  const [password, setPassword] = useState("");
  const [drivers, setDrivers] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<DbConnectionInfo | null>(null);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [found, available] = await Promise.all([api.dbConnections(), api.dbDrivers()]);
      setNames(found);
      setDrivers(available);
    } catch {
      // The backend may still be starting.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback(async (name: string) => {
    try {
      const found = await api.dbConnection(name);
      setSpec(found);
      setNotice(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the connection");
    }
  }, []);

  const startNew = useCallback((engine: DbEngine = "postgres") => {
    setSpec({ ...BLANK_SPEC, engine });
    setPassword("");
    setResult(null);
    setNotice(null);
  }, []);

  const save = useCallback(async () => {
    if (!spec.name.trim()) {
      setError("Give the connection a name first.");
      return;
    }
    setBusy("save");
    try {
      const saved = await api.saveDbConnection(spec.name.trim(), spec);
      setSpec(saved);
      setNotice(`Saved ${saved.name}. Passwords are never stored.`);
      setError(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }, [spec, load]);

  const remove = useCallback(
    async (name: string) => {
      try {
        await api.deleteDbConnection(name);
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not delete");
      }
    },
    [load],
  );

  const connect = useCallback(async () => {
    setBusy("connect");
    setNotice(null);
    try {
      const info = await api.openDb(spec, password || undefined);
      setOpen(info);
      setTables(await api.dbSchema(info.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect");
      setOpen(null);
      setTables([]);
    } finally {
      setBusy(null);
    }
  }, [spec, password]);

  const disconnect = useCallback(async () => {
    if (!open) return;
    try {
      await api.closeDb(open.id);
    } catch {
      // It is gone either way.
    } finally {
      setOpen(null);
      setTables([]);
      setResult(null);
    }
  }, [open]);

  const run = useCallback(async () => {
    if (!open) return;
    setBusy("query");
    try {
      setResult(await api.dbQuery(open.id, sql));
      setError(null);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "The query failed");
    } finally {
      setBusy(null);
    }
  }, [open, sql]);

  const preview = useCallback((table: DbTable) => {
    const target = table.schema_name
      ? `"${table.schema_name}"."${table.name}"`
      : `"${table.name}"`;
    setSql(`SELECT * FROM ${target} LIMIT 50;`);
  }, []);

  return {
    names,
    spec,
    patch: (patch) => setSpec((current) => ({ ...current, ...patch })),
    password,
    setPassword,
    drivers,
    open,
    tables,
    sql,
    setSql,
    result,
    busy,
    error,
    notice,
    load,
    select,
    startNew,
    save,
    remove,
    connect,
    disconnect,
    run,
    preview,
  };
}
