import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(desktop, "src-tauri", "target", "release", "bundle");
const version = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")).version;
const artifactVersion = process.platform === "win32" ? version.replace(/-beta\.(\d+)$/, "-$1") : version;

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

const files = filesUnder(bundle).map((file) => path.basename(file));
const platform = process.platform;
const expected = platform === "win32"
  ? [".exe"]
  : platform === "darwin"
    ? [".dmg"]
    : [".AppImage", ".deb", ".rpm"];
const missing = expected.filter((extension) => !files.some((file) => file.includes(artifactVersion) && file.endsWith(extension)));

if (missing.length > 0) {
  console.error(`Missing Tauri ${platform} artifact(s) for ${artifactVersion}: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Tauri artifacts are present for ${platform} ${artifactVersion}.`);
