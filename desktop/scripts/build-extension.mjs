/**
 * Bundle the ContextGit Copilot extension to desktop/build/extension/contextgit-copilot,
 * ready to be copied into the editor sidecar's extensions directory.
 *
 *   node scripts/build-extension.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "extensions", "copilot");
const out = path.join(root, "build", "extension", "contextgit-copilot");

fs.rmSync(out, { recursive: true, force: true });
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
console.log(`Extension built: ${out}`);
