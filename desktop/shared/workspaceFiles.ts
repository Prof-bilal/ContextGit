/** Filesystem types shared by Electron and the renderer. Paths are project-relative. */
export interface FileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  ignored?: boolean;
}

export interface FileDocument {
  path: string;
  content: string;
  version: string;
  size: number;
  encoding: "utf8";
}

export interface FileChangeEvent {
  path: string;
  kind: "created" | "changed" | "deleted";
}
