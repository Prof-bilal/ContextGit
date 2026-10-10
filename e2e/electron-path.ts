import path from "node:path";

/** Resolve Electron's platform-specific executable inside node_modules. */
export function electronExecutable(root = process.cwd()): string {
  const dist = path.join(root, "desktop", "node_modules", "electron", "dist");
  if (process.platform === "darwin") {
    return path.join(dist, "Electron.app", "Contents", "MacOS", "Electron");
  }
  if (process.platform === "win32") {
    return path.join(dist, "electron.exe");
  }
  return path.join(dist, "electron");
}
