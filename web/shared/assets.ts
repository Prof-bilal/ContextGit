/** Asset library + asset-agent types shared by the main process and the renderer. */

export type AssetKind = "image" | "video" | "audio" | "doc" | "other";

export interface Asset {
  id: string;
  /** Display name, editable in the UI (the on-disk file keeps its extension). */
  name: string;
  /** Lowercase extension incl. the dot, e.g. ".png". */
  ext: string;
  kind: AssetKind;
  mime: string;
  size: number;
  /** ms since epoch. */
  added: number;
  tags: string[];
  note: string;
  /** Library folder path; "" is the root. Slashes separate nested folders. */
  folder: string;
  /** Where the asset was imported from (informational). */
  source: string;
}

export interface AssetPatch {
  name?: string;
  tags?: string[];
  note?: string;
  folder?: string;
}

export interface AssetCatalog {
  assets: Asset[];
  folders: string[];
}

export interface AssetImportResult {
  imported: Asset[];
  skipped: { path: string; reason: string }[];
}

/** One instruction the asset agent can carry out. */
export type AgentAction =
  | { type: "create_folder"; path: string }
  | { type: "move"; ids: string[]; folder: string }
  | { type: "rename"; id: string; name: string }
  | { type: "tag"; id: string; tags: string[] }
  | { type: "note"; id: string; text: string }
  | { type: "delete"; ids: string[] };

export interface AgentActionResult {
  action: AgentAction;
  ok: boolean;
  error?: string;
  /** For `create_folder`: the folder path. For `move`/`delete`: affected count. */
  detail?: string;
}
