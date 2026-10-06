/**
 * Fetch the pinned code-server standalone build (bundled Node — no native
 * compilation) into desktop/build/editor, ready for the sidecar and packaging.
 *
 *   node scripts/fetch-editor.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.env.CODE_SERVER_VERSION ?? "4.140.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "build", "editor");

const osName = { linux: "linux", darwin: "macos", win32: "windows" }[os.platform()];
const archName = os.arch() === "arm64" ? "arm64" : "amd64";
if (!osName) throw new Error(`Unsupported platform: ${os.platform()}`);

const ext = os.platform() === "win32" ? "zip" : "tar.gz";
const name = `code-server-${VERSION}-${osName}-${archName}`;
const url = `https://github.com/coder/code-server/releases/download/v${VERSION}/${name}.${ext}`;
const binary = path.join(out, name, "bin", "code-server");

fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(binary) && !fs.existsSync(`${binary}.exe`)) {
  const archive = path.join(out, `${name}.${ext}`);
  console.log(`Downloading ${url}`);
  execFileSync("curl", ["-L", "--fail", "-o", archive, url], { stdio: "inherit" });
  if (ext === "tar.gz") execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit" });
  else execFileSync("unzip", ["-q", "-o", archive, "-d", out], { stdio: "inherit" });
  fs.rmSync(archive, { force: true });
}
fs.writeFileSync(path.join(out, "version"), `${VERSION}\n`);
console.log(`Editor ready: ${binary}`);
