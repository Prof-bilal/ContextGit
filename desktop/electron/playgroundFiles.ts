import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface FileChange { path: string; before: string; after: string }

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Config/skill writes must never follow a project-owned symlink. */
export function checkTarget(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Install target is outside the project.");
  }
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Install targets cannot be symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function readTarget(root: string, target: string): string {
  checkTarget(root, target);
  if (!fs.existsSync(target)) return "";
  if (fs.statSync(target).size > 1_000_000) throw new Error("Install target exceeds 1 MB.");
  return fs.readFileSync(target, "utf8");
}

export function mergeMcpConfig(before: string, id: string, entry: object): string {
  const data: unknown = before ? JSON.parse(before) : {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid .mcp.json object.");
  const config = data as Record<string, unknown>;
  const existing = config.mcpServers ?? {};
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("Invalid mcpServers object.");
  const servers = existing as Record<string, unknown>;
  if (Object.hasOwn(servers, id) && JSON.stringify(servers[id]) !== JSON.stringify(entry)) {
    throw new Error(`An existing ${id} server has a different config. Remove or rename it before installing.`);
  }
  return `${JSON.stringify({ ...config, mcpServers: { ...servers, [id]: entry } }, null, 2)}\n`;
}

/** Only our changed server entry is shown; unrelated credentials stay in main. */
export function configEntry(content: string, id: string): string {
  const config = content ? JSON.parse(content) as { mcpServers?: Record<string, unknown> } : {};
  return JSON.stringify({ mcpServers: { [id]: config.mcpServers?.[id] ?? null } }, null, 2);
}

export function writeChanges(root: string, changes: FileChange[]): void {
  for (const change of changes) {
    if (readTarget(root, change.path) !== change.before) throw new Error("Files changed since preview. Review a fresh preview.");
  }
  for (const change of changes) {
    fs.mkdirSync(path.dirname(change.path), { recursive: true });
    // O_EXCL / O_NOFOLLOW protects the final target on platforms supporting it;
    // the preview check also refuses symlinked parent directories.
    const temporary = `${change.path}.contextgit-${digest(change.after).slice(0, 12)}.tmp`;
    fs.writeFileSync(temporary, change.after, { flag: "wx", mode: 0o600 });
    try {
      checkTarget(root, change.path);
      if (readTarget(root, change.path) !== change.before) throw new Error("Install target changed during write.");
      fs.renameSync(temporary, change.path);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
