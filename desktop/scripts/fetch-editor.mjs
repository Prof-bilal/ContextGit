import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.env.CODE_SERVER_VERSION ?? "4.140.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "build", "editor");
const platform = { linux: "linux", darwin: "macos", win32: "windows" }[os.platform()];
const arch = os.arch() === "arm64" ? "arm64" : "amd64";
if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
const extension = os.platform() === "win32" ? "zip" : "tar.gz";
const name = `code-server-${version}-${platform}-${arch}`;
const binary = path.join(out, name, "bin", os.platform() === "win32" ? "code-server.exe" : "code-server");
const url = `https://github.com/coder/code-server/releases/download/v${version}/${name}.${extension}`;

fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(binary)) {
  const archive = path.join(out, `${name}.${extension}`);
  console.log(`Downloading ${url}`);
  execFileSync("curl", ["-L", "--fail", "-o", archive, url], { stdio: "inherit" });
  if (extension === "tar.gz") execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit" });
  else execFileSync("unzip", ["-q", "-o", archive, "-d", out], { stdio: "inherit" });
  fs.rmSync(archive, { force: true });
}
fs.writeFileSync(path.join(out, "version"), `${version}\n`);
console.log(`Embedded VS Code ready: ${binary}`);
