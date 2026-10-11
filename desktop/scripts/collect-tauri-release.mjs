import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(desktop, "src-tauri", "target", "release", "bundle");
const release = path.join(desktop, "release");
const extensions = new Set([".AppImage", ".deb", ".rpm", ".pacman", ".dmg", ".msi", ".exe", ".zip", ".tar.gz"]);

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

fs.mkdirSync(release, { recursive: true });
for (const entry of fs.readdirSync(release)) {
  if (entry.startsWith("tauri-")) fs.rmSync(path.join(release, entry), { force: true });
}
for (const file of filesUnder(bundle)) {
  if (![...extensions].some((extension) => file.endsWith(extension))) continue;
  if (path.dirname(path.dirname(file)) !== bundle) continue;
  const destination = path.join(release, path.basename(file));
  fs.copyFileSync(file, destination);
  console.log(`Collected ${destination}`);
}
