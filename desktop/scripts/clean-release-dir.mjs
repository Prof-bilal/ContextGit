import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release");
for (const name of ["linux-unpacked", "win-unpacked", "mac", "mac-arm64"]) {
  fs.rmSync(path.join(release, name), { recursive: true, force: true });
}
