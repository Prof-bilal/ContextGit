/**
 * App-level asset library. Assets are copied into a folder under the app's
 * userData dir and indexed in a JSON manifest (with a folder list), so the
 * gallery is independent of any project and supports folders. The main process
 * owns the bytes; the renderer only ever names an asset id.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  AgentAction,
  AgentActionResult,
  Asset,
  AssetCatalog,
  AssetImportResult,
  AssetKind,
  AssetPatch,
} from "../shared/assets";

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico", ".tiff"]);
const VIDEO = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"]);
const AUDIO = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const DOC = new Set([
  ".pdf", ".md", ".txt", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".csv", ".json", ".rtf", ".odt",
]);

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".tiff": "image/tiff",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo", ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".flac": "audio/flac", ".aac": "audio/aac",
  ".pdf": "application/pdf", ".md": "text/markdown", ".txt": "text/plain",
  ".json": "application/json", ".csv": "text/csv", ".rtf": "application/rtf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".odt": "application/vnd.oasis.opendocument.text",
};

interface LibraryIndex {
  version: number;
  folders: string[];
  assets: Asset[];
}

function kindOf(ext: string): AssetKind {
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (DOC.has(ext)) return "doc";
  return "other";
}

/** "\\Logos\\ /  V2 " -> "Logos/V2"; "" stays the root. */
export function normalizeFolder(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function isAsset(value: unknown): value is Asset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.ext === "string";
}

function withFolder(asset: Asset): Asset {
  return { ...asset, folder: typeof asset.folder === "string" ? normalizeFolder(asset.folder) : "" };
}

function walkFiles(dir: string, current = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walkFiles(dir, full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export class AssetLibrary {
  private readonly filesDir: string;
  private readonly indexPath: string;

  constructor(private readonly dir: string) {
    this.filesDir = path.join(dir, "files");
    this.indexPath = path.join(dir, "assets.json");
    fs.mkdirSync(this.filesDir, { recursive: true });
  }

  private read(): LibraryIndex {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        return { version: 1, folders: [], assets: parsed.filter(isAsset).map(withFolder) };
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as { folders?: unknown; assets?: unknown };
        const assets = Array.isArray(record.assets) ? record.assets.filter(isAsset).map(withFolder) : [];
        const folders = Array.isArray(record.folders)
          ? record.folders.filter((entry): entry is string => typeof entry === "string").map(normalizeFolder)
          : [];
        return { version: 1, folders: [...new Set(folders)].filter(Boolean), assets };
      }
    } catch {
      // no index yet
    }
    return { version: 1, folders: [], assets: [] };
  }

  private write(index: LibraryIndex): void {
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
    fs.renameSync(tmp, this.indexPath);
  }

  /** Add a folder and all of its ancestors to the index. */
  private ensureFolder(index: LibraryIndex, folder: string): string {
    const normalized = normalizeFolder(folder);
    if (!normalized) return "";
    const parts = normalized.split("/");
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join("/");
      if (!index.folders.includes(prefix)) index.folders.push(prefix);
    }
    return normalized;
  }

  catalog(): AssetCatalog {
    const index = this.read();
    return {
      assets: [...index.assets].sort((a, b) => b.added - a.added),
      folders: [...index.folders].sort((a, b) => a.localeCompare(b)),
    };
  }

  /** Absolute path of an asset's stored bytes, or null when it is missing. */
  filePath(id: string): string | null {
    const asset = this.read().assets.find((entry) => entry.id === id);
    if (!asset) return null;
    const file = path.join(this.filesDir, `${asset.id}${asset.ext}`);
    return fs.existsSync(file) ? file : null;
  }

  private importOne(index: LibraryIndex, source: string, folder: string): Asset {
    const stat = fs.statSync(source);
    const ext = path.extname(source).toLowerCase();
    const id = crypto.randomUUID();
    fs.copyFileSync(source, path.join(this.filesDir, `${id}${ext}`));
    const asset: Asset = {
      id,
      name: path.basename(source),
      ext,
      kind: kindOf(ext),
      mime: MIME[ext] ?? "application/octet-stream",
      size: stat.size,
      added: Date.now(),
      tags: [],
      note: "",
      folder: this.ensureFolder(index, folder),
      source,
    };
    index.assets.push(asset);
    return asset;
  }

  importFiles(paths: string[], folder = ""): AssetImportResult {
    const index = this.read();
    const imported: Asset[] = [];
    const skipped: { path: string; reason: string }[] = [];
    for (const source of paths) {
      try {
        if (!fs.statSync(source).isFile()) {
          skipped.push({ path: source, reason: "Not a file" });
          continue;
        }
        imported.push(this.importOne(index, source, folder));
      } catch (cause) {
        skipped.push({ path: source, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    if (imported.length > 0) this.write(index);
    return { imported, skipped };
  }

  /** Recursively import a folder, mirroring its subfolders into library folders. */
  importFolder(dir: string): AssetImportResult {
    const index = this.read();
    const imported: Asset[] = [];
    const skipped: { path: string; reason: string }[] = [];
    for (const source of walkFiles(dir)) {
      try {
        const folder = normalizeFolder(path.relative(dir, path.dirname(source)));
        imported.push(this.importOne(index, source, folder));
      } catch (cause) {
        skipped.push({ path: source, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    if (imported.length > 0) this.write(index);
    return { imported, skipped };
  }

  createFolder(folder: string): string {
    const index = this.read();
    const normalized = this.ensureFolder(index, folder);
    this.write(index);
    return normalized;
  }

  update(id: string, patch: AssetPatch): Asset | null {
    const index = this.read();
    const asset = index.assets.find((entry) => entry.id === id);
    if (!asset) return null;
    if (typeof patch.name === "string" && patch.name.trim()) asset.name = patch.name.trim();
    if (Array.isArray(patch.tags)) asset.tags = patch.tags.map((tag) => tag.trim()).filter(Boolean);
    if (typeof patch.note === "string") asset.note = patch.note;
    if (typeof patch.folder === "string") asset.folder = this.ensureFolder(index, patch.folder);
    this.write(index);
    return asset;
  }

  move(ids: string[], folder: string): number {
    const index = this.read();
    const target = this.ensureFolder(index, folder);
    let moved = 0;
    for (const asset of index.assets) {
      if (ids.includes(asset.id)) {
        asset.folder = target;
        moved += 1;
      }
    }
    this.write(index);
    return moved;
  }

  remove(id: string): boolean {
    const index = this.read();
    const asset = index.assets.find((entry) => entry.id === id);
    if (!asset) return false;
    try {
      fs.rmSync(path.join(this.filesDir, `${asset.id}${asset.ext}`), { force: true });
    } catch {
      // already gone; drop the index entry anyway
    }
    this.write({ ...index, assets: index.assets.filter((entry) => entry.id !== id) });
    return true;
  }

  /** Execute a plan produced by the asset agent, one action at a time. */
  applyActions(actions: AgentAction[]): AgentActionResult[] {
    const results: AgentActionResult[] = [];
    for (const action of actions) {
      try {
        if (action.type === "create_folder") {
          const folder = this.createFolder(action.path);
          results.push({ action, ok: true, detail: folder || "(root)" });
        } else if (action.type === "move") {
          const moved = this.move(action.ids, action.folder);
          results.push({ action, ok: moved > 0, detail: `${moved} moved`, error: moved === 0 ? "No matching assets" : undefined });
        } else if (action.type === "rename") {
          const asset = this.update(action.id, { name: action.name });
          results.push({ action, ok: Boolean(asset), error: asset ? undefined : "Asset not found" });
        } else if (action.type === "tag") {
          const asset = this.update(action.id, { tags: action.tags });
          results.push({ action, ok: Boolean(asset), error: asset ? undefined : "Asset not found" });
        } else if (action.type === "note") {
          const asset = this.update(action.id, { note: action.text });
          results.push({ action, ok: Boolean(asset), error: asset ? undefined : "Asset not found" });
        } else if (action.type === "delete") {
          let removed = 0;
          for (const id of action.ids) if (this.remove(id)) removed += 1;
          results.push({ action, ok: removed > 0, detail: `${removed} deleted`, error: removed === 0 ? "No matching assets" : undefined });
        }
      } catch (cause) {
        results.push({ action, ok: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    return results;
  }
}
