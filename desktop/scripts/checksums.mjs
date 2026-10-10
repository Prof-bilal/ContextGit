import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const files = fs.readdirSync(release)
  .filter((name) => /\.(AppImage|deb|rpm|pacman|tar\.gz|dmg|exe|zip)$/i.test(name))
  .filter((name) => fs.statSync(path.join(release, name)).isFile())
  .sort();
const lines = files.map((name) => {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(release, name))).digest("hex");
  return `${digest}  ${name}`;
});
fs.writeFileSync(path.join(release, "SHA256SUMS"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
