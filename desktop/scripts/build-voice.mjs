/** Build a pinned whisper.cpp CLI as a self-contained desktop resource. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "build/whisper-source");
const output = resolve(root, "build/voice");
const localCmake = resolve(
  root,
  "..",
  ".venv",
  process.platform === "win32" ? "Scripts/cmake.exe" : "bin/cmake",
);
const cmake = existsSync(localCmake) ? localCmake : "cmake";
mkdirSync(output, { recursive: true });
if (!existsSync(source))
  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      "v1.7.6",
      "https://github.com/ggml-org/whisper.cpp.git",
      source,
    ],
    { stdio: "inherit" },
  );
const version = execFileSync("git", ["describe", "--tags", "--exact-match"], {
  cwd: source,
  encoding: "utf8",
}).trim();
if (version !== "v1.7.6")
  throw new Error("Whisper source must match pinned v1.7.6");
execFileSync(
  cmake,
  [
    "-S",
    source,
    "-B",
    `${source}/build`,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_NATIVE=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_CURL=OFF",
    "-DGGML_METAL=OFF",
  ],
  { stdio: "inherit" },
);
execFileSync(
  cmake,
  [
    "--build",
    `${source}/build`,
    "--config",
    "Release",
    "--target",
    "whisper-cli",
    "-j",
    "2",
  ],
  { stdio: "inherit" },
);
const name = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const candidates = [
  `${source}/build/bin/Release/${name}`,
  `${source}/build/bin/${name}`,
];
const binary = candidates.find(existsSync);
if (!binary) throw new Error("Whisper CLI build did not produce a binary");
copyFileSync(binary, resolve(output, name));
copyFileSync(`${source}/LICENSE`, resolve(output, "LICENSE"));
