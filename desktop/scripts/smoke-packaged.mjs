import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = process.platform === "win32"
  ? [
      path.join(root, "release", "win-unpacked", "ContextGit.exe"),
      path.join(root, "release", "win-unpacked", "contextgit-desktop.exe"),
    ]
  : process.platform === "darwin"
    ? [
        path.join(root, "release", "mac", "ContextGit.app", "Contents", "MacOS", "ContextGit"),
        path.join(root, "release", "mac", "ContextGit.app", "Contents", "MacOS", "contextgit-desktop"),
        path.join(root, "release", "mac-arm64", "ContextGit.app", "Contents", "MacOS", "ContextGit"),
        path.join(root, "release", "mac-arm64", "ContextGit.app", "Contents", "MacOS", "contextgit-desktop"),
      ]
    : [
        path.join(root, "release", "linux-unpacked", "contextgit"),
        path.join(root, "release", "linux-unpacked", "contextgit-desktop"),
      ];
const executable = candidates.find((candidate) => fs.existsSync(candidate));
if (!executable) throw new Error(`Packaged executable not found. Tried: ${candidates.join(", ")}`);

const child = spawn(executable, process.platform === "linux" ? ["--no-sandbox"] : [], {
  cwd: root,
  env: { ...process.env, CONTEXTGIT_SMOKE: "1" },
  stdio: "inherit",
});
child.on("error", (error) => { throw error; });
child.on("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
