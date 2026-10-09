/** Explicit live test: uses the installed harness and a real configured provider. */
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cg-live-capture-"));
const python = path.join(repository, ".venv", "bin", "python");
const binary = process.env.OPENCODE_BINARY ?? "opencode";
const model = process.env.OPENCODE_TEST_MODEL ?? "opencode/mimo-v2.6-flash-free";
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: repository, encoding: "utf8", timeout: 120_000, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? "Command failed");
  return result.stdout.trim();
}
function backend(code, ...args) { return run(python, ["-c", code, ...args]); }
try {
  const project = path.join(directory, "project");
  fs.mkdirSync(project);
  const root = path.join(directory, "contextgit");
  const sessionId = backend(`import sys
from contextgit.core.repo import Repo
repo = Repo.init(sys.argv[1])
print(repo.create_session("live-proof", kind="terminal", agent="opencode", project_path=sys.argv[2]).id)
`, root, project);
  const helper = path.join(directory, "capture.mjs");
  await build({ entryPoints: [path.join(repository, "desktop/electron/conversationCapture.ts")], bundle: true, platform: "node", format: "esm", outfile: helper });
  const { prepareOpenCodeCapture } = await import(pathToFileURL(helper).href);
  let nativeId;
  for (const [index, prompt] of ["Reply exactly: FIRST_CAPTURE_OK. Do not use tools.", "Reply exactly: RESUME_CAPTURE_OK. Do not use tools."].entries()) {
    const launch = prepareOpenCodeCapture(root, sessionId, project, nativeId);
    const output = run(binary, ["run", ...launch.args, "--dir", project, "--model", model, "--format", "json", prompt], {
      cwd: project, env: { ...process.env, PWD: project, INIT_CWD: project, ...launch.env },
    });
    const events = output.split("\n").filter(Boolean).map(line => JSON.parse(line));
    console.log("Native event types:", events.map(event => event.type).join(", "));
    if (!events.some(event => event.type === "text")) {
      throw new Error("Live provider did not return text: " + JSON.stringify(events.filter(event => event.type === "error")));
    }
    const result = JSON.parse(backend(`import json, sys
from contextgit.core.repo import Repo
repo = Repo.open(sys.argv[1])
sid = sys.argv[2]
messages = repo.transcripts.capture(sid)
assert [m.role for m in messages] == ["user", "assistant"], [(m.role, m.content) for m in messages]
assert sys.argv[3] in messages[1].content, messages[1].content
commit = repo.commit_staged(sid)
assert repo.transcripts.capture(sid) == [], "Repeated checkpoint duplicated history"
assert repo.get_commit(commit.id).messages == messages
print(json.dumps({"native_id": repo.transcripts.binding(sid)["native_id"], "roles": [m.role for m in messages], "commit": commit.id}))
`, root, sessionId, index === 0 ? "FIRST_CAPTURE_OK" : "RESUME_CAPTURE_OK"));
    if (nativeId && nativeId !== result.native_id) throw new Error("Resume changed conversation identity");
    nativeId = result.native_id;
    console.log(`Live ${index === 0 ? "checkpoint" : "resume"}: verified prompt + assistant reply, duplicate-safe persistence.`);
  }
} finally {
  // Only this script's own temporary workspace; never deletes user/native history.
  fs.rmSync(directory, { recursive: true, force: true });
}
