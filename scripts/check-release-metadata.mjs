import fs from "node:fs";

// Git may check text files out with CRLF on Windows. Release metadata is
// independent of checkout line endings, including adjacent Cargo.lock fields.
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const desktop = JSON.parse(read("desktop/package.json"));
const desktopLock = JSON.parse(read("desktop/package-lock.json"));
const beta = desktop.version;
const pep440 = beta.replace(/-beta\./, "b");
const tauri = JSON.parse(read("desktop/src-tauri/tauri.conf.json"));
const windows = JSON.parse(read("desktop/src-tauri/tauri.windows.conf.json"));
const checks = [
  ["desktop package version", desktop.version === beta],
  ["desktop lock version", desktopLock.version === beta && desktopLock.packages?.[""].version === beta],
  ["Python package version", read("pyproject.toml").includes(`version = \"${pep440}\"`)],
  ["runtime version", read("contextgit/__init__.py").includes(`__version__ = \"${pep440}\"`)],
  ["Tauri version", tauri.version === beta],
  ["Rust package version", read("desktop/src-tauri/Cargo.toml").includes(`version = "${beta}"`)],
  ["Rust lock version", read("desktop/src-tauri/Cargo.lock").includes(`name = "contextgit-desktop"\nversion = "${beta}"`)],
  ["Windows installer version", windows.version === beta.replace(/-beta\.(\d+)$/, "-$1")],
  ["beta notes", read("BETA.md").includes(`ContextGit \`${beta}\``)],
  ["website release tag", read("website/app/download/page.tsx").includes(`releases/tag/v${beta}`)],
  ["website release assets", read("website/app/download/page.tsx").includes(`releases/download/v${beta}`)],
  ["windows Tauri asset version", read("website/app/download/page.tsx").includes(`contextgit-windows-x64-ContextGit_${beta}_x64-setup.exe`)],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error(`Release metadata mismatch for ${beta}:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`Release metadata is consistent for ${beta}.`);
