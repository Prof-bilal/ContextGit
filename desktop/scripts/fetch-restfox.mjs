/**
 * Fetch and build Restfox (the open-source API client) in its `web-standalone`
 * form into desktop/build/restfox, ready for the sidecar and packaging.
 *
 * Restfox isn't published as a single npm package, so we take the pinned tag,
 * build the Vue UI (`build-web-standalone` copies it into the server's
 * `public/`) and install the little express server that fronts it.
 *
 * Each step is guarded, so a failed or partial run resumes instead of redoing
 * the clone/build.
 *
 *   node scripts/fetch-restfox.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.env.RESTFOX_VERSION ?? "0.40.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "build", "restfox");
const ui = path.join(out, "packages", "ui");
const server = path.join(out, "packages", "web-standalone");
const entry = path.join(server, "app.js");
const built = path.join(server, "public");
const serverDeps = path.join(server, "node_modules", "express");

if (!fs.existsSync(entry)) {
  // A real clone, not the tarball: the UI build runs `git describe --tags`
  // (vite-plugin-revision) to stamp a revision, which needs the tag in a repo.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  console.log(`Cloning Restfox v${VERSION}…`);
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", `v${VERSION}`, "https://github.com/flawiddsouza/Restfox.git", out],
    { stdio: "inherit" },
  );
}

if (!fs.existsSync(path.join(ui, "node_modules"))) {
  // The UI build needs its devDependencies (vite, rollup-plugin-copy, …), which
  // a machine configured with `omit=dev` would otherwise skip.
  console.log("Installing the Restfox UI…");
  execFileSync("npm", ["install", "--include=dev", "--no-audit", "--no-fund"], {
    cwd: ui,
    stdio: "inherit",
  });
}

if (!fs.existsSync(built)) {
  console.log("Building the Restfox UI (web-standalone)…");
  execFileSync("npm", ["run", "build-web-standalone"], { cwd: ui, stdio: "inherit" });
}

if (!fs.existsSync(serverDeps)) {
  console.log("Installing the Restfox server…");
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: server,
    stdio: "inherit",
  });
}

fs.writeFileSync(path.join(out, "version"), `${VERSION}\n`);
console.log(`Restfox ready: ${entry}`);
