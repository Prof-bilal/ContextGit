/**
 * Bundle every extension under desktop/extensions/ into
 * desktop/build/extension/<name>, ready to be copied into the editor sidecar.
 *
 *   node scripts/build-extension.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourceDir = path.join(root, "extensions");
const outDir = path.join(root, "build", "extension");

fs.rmSync(outDir, { recursive: true, force: true });
if (!fs.existsSync(sourceDir)) {
  console.log("No extensions to build.");
  process.exit(0);
}

for (const name of fs.readdirSync(sourceDir)) {
  const source = path.join(sourceDir, name);
  if (!fs.existsSync(path.join(source, "src", "extension.ts"))) continue;
  const out = path.join(outDir, name);
  fs.mkdirSync(out, { recursive: true });
  execFileSync(
    path.join(root, "node_modules", ".bin", "esbuild"),
    [
      path.join(source, "src", "extension.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node18",
      "--external:vscode",
      `--outfile=${path.join(out, "extension.js")}`,
    ],
    { stdio: "inherit" },
  );
  fs.copyFileSync(path.join(source, "package.json"), path.join(out, "package.json"));
  console.log(`Extension built: ${name}`);
}
