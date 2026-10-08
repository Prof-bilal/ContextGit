import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-test-markdown-"));
try {
  const outfile = path.join(directory, "tests.cjs");
  await build({ entryPoints: [path.join(root, "tests/markdown.test.tsx")], bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic" });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
