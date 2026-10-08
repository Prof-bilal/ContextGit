/**
 * Fetch the pinned DbGate Community web server (`dbgate-serve`) into
 * desktop/build/dbgate, ready for the sidecar and packaging.
 *
 * `dbgate-serve` itself is tiny; its dependencies carry the web UI and the
 * engine plugins (MySQL, Postgres, SQL Server, MongoDB, Redis, SQLite, …), so
 * we install with npm rather than unpacking a single tarball.
 *
 *   node scripts/fetch-dbgate.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 7.3.x is broken on npm: dbgate-plugin-mysql@7.3.x requires
// dbgate-mysql-dumper@7.3.x, which was never published (only 0.1.x exists).
const VERSION = process.env.DBGATE_VERSION ?? "7.2.6";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "build", "dbgate");
const entry = path.join(out, "node_modules", "dbgate-serve", "bin", "dbgate-serve.js");

fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(entry)) {
  fs.writeFileSync(
    path.join(out, "package.json"),
    `${JSON.stringify(
      {
        name: "contextgit-dbgate",
        private: true,
        dependencies: { "dbgate-serve": VERSION },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Installing dbgate-serve@${VERSION}`);
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", out], {
    stdio: "inherit",
  });
}
fs.writeFileSync(path.join(out, "version"), `${VERSION}\n`);
console.log(`DbGate ready: ${entry}`);
