import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release");
for (const name of ["linux-unpacked", "win-unpacked", "mac", "mac-arm64"]) {
  const target = path.join(release, name);
  // Windows can keep Electron's resources directory locked for a short time
  // after the packaged smoke process exits. Let Node retry transient EBUSY /
  // EPERM failures instead of failing the release after a successful smoke.
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 1000 });
}
