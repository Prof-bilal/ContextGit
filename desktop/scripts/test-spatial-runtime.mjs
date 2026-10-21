import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const writes = [],
  starts = [],
  kills = [],
  transcripts = [];
const resizes = [];
let onData, onExit;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = {
  contextgit: {
    onPtyData: (callback) => {
      onData = callback;
      return () => {};
    },
    onPtyExit: (callback) => {
      onExit = callback;
      return () => {};
    },
    harnessCheck: async () => ({ installed: true }),
    ptyStart: async (options) => {
      starts.push(options);
    },
    ptyKill: (id) => kills.push(id),
    ptyWrite: (id, data) => writes.push({ id, data }),
    ptyResize(id, cols, rows) {resizes.push({id,cols,rows});},
  },
};
globalThis.__transcripts = transcripts;
const server = await createServer({
  root,
  configFile: false,
  plugins: [
    {
      name: "runtime-api-stub",
      resolveId(id) {
        if (id === "@/shared/api") return "\0runtime-api";
      },
      load(id) {
        if (id === "\0runtime-api")
          return `export const projectApi = () => ({appendTerminalTranscript: async (id, text) => globalThis.__transcripts.push({id,text}), updateSession: async () => {}, staging: async () => [], captureConversation: async () => {}, commitStaged: async () => {}});`;
      },
    },
  ],
});
try {
  const { TerminalRuntime } = await server.ssrLoadModule(
    "/src/shell/terminal/runtime.ts",
  );
  const runtime = new TerminalRuntime();
  const sessions = Array.from({ length: 24 }, (_, index) => ({
    id: `worker-${index}`,
    name: `Worker ${index}`,
    agent: "shell",
    role: "worker",
    project_path: "/project",
    skills: [],
    scope: [],
    status: "idle",
  }));
  await Promise.all(
    sessions.map((session, index) =>
      runtime.ensure(session, `team-${index < 12 ? 1 : 2}`, `task-${index}`),
    ),
  );
  assert.equal(starts.length, 24);
  for (const session of sessions)
    await runtime.ensure({ ...session }, "ignored");
  assert.equal(starts.length, 24, "polling must not duplicate CLIs");
  const delayed = {...sessions[0], id:'delayed-codex', agent:'codex'};
  runtime.resize(delayed.id, 65, 24);
  const originalStart = window.contextgit.ptyStart;
  let finishStart;
  window.contextgit.ptyStart = async options => {
    starts.push(options);
    await new Promise(resolve => {finishStart=resolve;});
  };
  const launching = runtime.ensure(delayed);
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(starts.at(-1).command,'codex');
  assert.equal(starts.at(-1).input,undefined,'A bare CLI must not receive a generated prompt');
  assert.equal(starts.at(-1).cols,65,'Use the view size measured before PTY creation');
  runtime.resize(delayed.id, 72, 28);
  finishStart();
  await launching;
  assert.deepEqual(resizes.at(-1),{id:'pty-delayed-codex',cols:72,rows:28},'Reapply resize that arrived during PTY creation');
  window.contextgit.ptyStart = originalStart;
  let renders = 0;
  const closeView = runtime.subscribe(sessions[0].id, () => renders++);
  onData("pty-worker-0", "running\r\n");
  assert.equal(renders, 1);
  closeView();
  onData("pty-worker-0", "survives closing terminal\r\n");
  assert.equal(renders, 1);
  assert.match(runtime.snapshot("worker-0").tail, /survives closing/);
  const chunks = [];
  const offOutput = runtime.subscribeOutput("worker-0", (data) => chunks.push(data));
  assert.equal(chunks.shift(), runtime.snapshot("worker-0").output, "New views replay retained output once");
  const longOutput = "x".repeat(100_000);
  onData("pty-worker-0", longOutput);
  onData("pty-worker-0", longOutput);
  onData("pty-worker-0", "\x1b[2;1HIncremental frame");
  assert.equal(chunks.join(""), longOutput + longOutput + "\x1b[2;1HIncremental frame", "Live views receive original bytes across history rollover");
  assert.equal(runtime.snapshot("worker-0").output.length, 180_000);
  offOutput();
  const delivered = chunks.length;
  onData("pty-worker-0", "after unsubscribe");
  assert.equal(chunks.length, delivered, "Disposed views stop receiving output");
  assert.equal(
    kills.length,
    0,
    "closing views and changing projects must not kill processes",
  );
  await runtime.send("worker-0", "continue\r");
  assert.equal(writes[0].data, "continue\r");
  onExit("pty-worker-0", 0);
  assert.equal(runtime.snapshot("worker-0").state, "exited");
  await assert.rejects(() => runtime.send("worker-0", "bad"), /exited/);
  for (const session of sessions.slice(1)) onExit(`pty-${session.id}`, 0);
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert(transcripts.some((entry) => entry.text.includes("survives closing")));
  console.log(
    "PASS: 2 teams / 24 CLIs, one process per session, subscription teardown, transcript persistence, command routing and exit handling.",
  );
} finally {
  await server.close();
}
