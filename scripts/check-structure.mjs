import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbiddenDirectories = ["landing", "files"];
const staleMarkers = ["files/", "landing/", "remaining-phases.md"];
const textRoots = ["README.md", "docs", ".github"];
const violations = [];

for (const directory of forbiddenDirectories) {
  if (existsSync(path.join(root, directory))) violations.push(`forbidden directory exists: ${directory}/`);
}

function visit(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return;
  if (statSync(absolutePath).isDirectory()) {
    for (const entry of readdirSync(absolutePath)) visit(path.join(relativePath, entry));
    return;
  }
  const contents = readFileSync(absolutePath, "utf8");
  for (const marker of staleMarkers) {
    if (contents.includes(marker)) violations.push(`${relativePath}: stale reference ${marker}`);
  }
}

for (const rootPath of textRoots) visit(rootPath);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Repository structure is clean.");
