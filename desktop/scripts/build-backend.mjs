/** Build the packaged ContextGit backend on every desktop platform. */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const venvPython = process.platform === "win32"
  ? path.join(root, ".venv", "Scripts", "python.exe")
  : path.join(root, ".venv", "bin", "python");
const python = fs.existsSync(venvPython)
  ? venvPython
  : process.platform === "win32" ? "python" : process.env.PYTHON ?? "python3";

if (python === venvPython && !fs.existsSync(python)) {
  throw new Error(`Python virtualenv not found at ${venvPython}. Create it and install the dev dependencies first.`);
}

execFileSync(python, ["-m", "pip", "install", "--quiet", "pyinstaller"], { cwd: root, stdio: "inherit" });

const extras = [];
for (const packageName of ["docx", "pptx", "reportlab", "weasyprint"]) {
  const probe = spawnSync(python, ["-c", `import ${packageName}`], { cwd: root, stdio: "ignore" });
  if (probe.status === 0) extras.push("--collect-all", packageName);
}

const args = [
  "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
  "--name", "contextgit-api",
  "--paths", root,
  "--hidden-import", "uvicorn.logging",
  "--hidden-import", "uvicorn.loops.auto",
  "--hidden-import", "uvicorn.loops.uvloop",
  "--hidden-import", "uvicorn.protocols.http.auto",
  "--hidden-import", "uvicorn.protocols.http.h11_impl",
  "--hidden-import", "uvicorn.protocols.websockets.auto",
  "--hidden-import", "uvicorn.lifespan.on",
  "--collect-all", "contextgit",
  ...extras,
  "--distpath", path.join(root, "desktop", "build", "backend"),
  "--workpath", path.join(root, "desktop", "build", "pyinstaller"),
  "--specpath", path.join(root, "desktop", "build", "pyinstaller"),
  path.join(root, "desktop", "backend", "entry.py"),
];

execFileSync(python, args, { cwd: root, stdio: "inherit" });
console.log(`Backend ready: ${path.join(root, "desktop", "build", "backend")}`);
