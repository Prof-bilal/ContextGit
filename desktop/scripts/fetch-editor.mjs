import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.env.CODE_SERVER_VERSION ?? "4.140.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "build", "editor");
const platform = { linux: "linux", darwin: "macos", win32: "windows" }[os.platform()];
const arch = { arm64: "arm64", x64: "amd64" }[os.arch()];
if (!platform) throw new Error(`Unsupported platform: ${os.platform()}`);
if (!arch) throw new Error(`Unsupported architecture: ${os.arch()}`);
const extension = "tar.gz";
const name = `code-server-${version}-${platform}-${arch}`;
const binary = os.platform() === "win32" ? path.join(out, name, "lib", "node.exe") : path.join(out, name, "bin", "code-server");
const url = `https://github.com/coder/code-server/releases/download/v${version}/${name}.${extension}`;
// Pinned upstream GitHub asset digests; overriding the runtime also requires an
// explicitly supplied checksum rather than accepting an unverified executable.
const checksums = {
  "linux-amd64": "864c5d01c808ade57e4d12c708717be7a187219fded60428f263b9e2da9f6b48",
  "linux-arm64": "ae4b07153f2037b06d24749bc8004221fcbf3ffe317038401be0452f541bf200",
  "macos-amd64": "a5393b6eed4aa68b084e724c3c565f805abd996c609356043119f0323e40cf52",
  "macos-arm64": "82c7144406ac31c373acfa786b6705c7c5463d895f728fde2cb94402b945b301",
  "windows-amd64": "f79a06ec2fe3dc12283aa78d53040738b6535cac0bb2db77e9123c0131f7e38b",
};
const checksum = process.env.CODE_SERVER_SHA256 ?? (version === "4.140.0" ? checksums[`${platform}-${arch}`] : undefined);
if (!checksum) throw new Error("Set CODE_SERVER_SHA256 for this editor version/platform.");

fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(binary)) {
  const archive = path.join(out, `${name}.${extension}`);
  console.log(`Downloading ${url}`);
  execFileSync("curl", ["-L", "--fail", "--retry", "3", "--connect-timeout", "20", "--max-time", "600", "-o", archive, url], { stdio: "inherit" });
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== checksum) throw new Error(`Checksum mismatch for ${name}; archive was not extracted.`);
  execFileSync("tar", ["-xzf", archive, "-C", out], { stdio: "inherit" });
  fs.rmSync(archive, { force: true });
}
if (!fs.existsSync(binary) || !fs.existsSync(path.join(out, name, "out", "node", "entry.js"))) throw new Error("The editor archive is incomplete.");
execFileSync(binary, os.platform() === "win32" ? [path.join(out, name), "--version"] : ["--version"], { stdio: "inherit", timeout: 30000 });
fs.writeFileSync(path.join(out, "version"), `${version}\n`);
console.log(`Embedded VS Code ready: ${binary}`);
