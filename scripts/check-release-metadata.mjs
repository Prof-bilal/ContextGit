import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const desktop = JSON.parse(read("desktop/package.json"));
const desktopLock = JSON.parse(read("desktop/package-lock.json"));
const beta = desktop.version;
const pep440 = beta.replace(/-beta\./, "b");
const checks = [
  ["desktop package version", desktop.version === beta],
  ["desktop lock version", desktopLock.version === beta && desktopLock.packages?.[""].version === beta],
  ["Python package version", read("pyproject.toml").includes(`version = \"${pep440}\"`)],
  ["runtime version", read("contextgit/__init__.py").includes(`__version__ = \"${pep440}\"`)],
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
