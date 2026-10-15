import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/check-release-metadata.mjs");
const files = ["desktop/package.json", "desktop/package-lock.json", "desktop/src-tauri/tauri.conf.json",
  "desktop/src-tauri/tauri.windows.conf.json", "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/Cargo.lock",
  "pyproject.toml", "contextgit/__init__.py", "BETA.md", "website/app/download/page.tsx"];

function check(lineEnding, mismatch = false) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "contextgit-release-metadata-"));
  try {
    for (const file of files) {
      let text = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n?/g, "\n");
      if (mismatch && file === "desktop/src-tauri/Cargo.lock") text = text.replace(/(name = "contextgit-desktop"\nversion = ")[^"]+/, "$10.0.0");
      const destination = path.join(temporary, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, text.replaceAll("\n", lineEnding));
    }
    const result = spawnSync(process.execPath, [script], { cwd: temporary, encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

for (const [name, ending] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`matching release metadata passes with ${name} line endings`, () => {
    const result = check(ending);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release metadata is consistent/);
  });
  test(`a mismatched Rust lock version still fails with ${name} line endings`, () => {
    const result = check(ending, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Rust lock version/);
  });
}
