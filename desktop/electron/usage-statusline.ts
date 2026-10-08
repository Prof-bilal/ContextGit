/** Runs only as Claude's launch-scoped status-line command. */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { claudeUsage } from "./usageParsers";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => { if (input.length < 1024 * 1024) input += data; });
process.stdin.on("end", () => {
  try {
    const sanitized = claudeUsage(JSON.parse(input));
    const file = process.env.CONTEXTGIT_USAGE_FILE;
    if (file) {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(sanitized), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    }
  } catch { /* Usage must never break the original status line. */ }
  const original = process.env.CONTEXTGIT_STATUS_COMMAND;
  if (original) {
    const child = spawn(original, { shell: true, stdio: ["pipe", "inherit", "ignore"] });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    const timeout = setTimeout(() => child.kill(), 2000);
    child.on("exit", () => clearTimeout(timeout));
  }
});
