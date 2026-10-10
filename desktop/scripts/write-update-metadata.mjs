import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const candidates = process.platform === "win32"
  ? fs.readdirSync(release).filter(name => name.endsWith(".exe"))
  : process.platform === "darwin"
    ? fs.readdirSync(release).filter(name => name.endsWith(".zip"))
    : fs.readdirSync(release).filter(name => name.endsWith(".AppImage"));

if (candidates.length === 0) {
  console.error("No updater artifact found in", release);
  process.exit(1);
}

const name = candidates.sort()[0];
const file = path.join(release, name);
const safeName = name.replaceAll(" ", "-");
const sha512 = crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");
const metadata = [
  `version: ${version}`,
  "files:",
  `  - url: ${safeName}`,
  `    sha512: ${sha512}`,
  `    size: ${fs.statSync(file).size}`,
  `path: ${safeName}`,
  `sha512: ${sha512}`,
  `releaseDate: ${new Date().toISOString()}`,
  "",
].join("\n");

const output = process.platform === "win32" ? "latest.yml" : process.platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml";
fs.writeFileSync(path.join(release, output), metadata);
console.log(`Wrote ${output} for ${safeName}`);
