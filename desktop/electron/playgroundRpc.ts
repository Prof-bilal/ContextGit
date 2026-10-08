import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface RpcFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
}

function validateArguments(input: unknown, schema: unknown, depth = 0): void {
  if (!schema || typeof schema !== "object" || depth > 12) throw new Error("Unsupported tool schema.");
  const spec = schema as { type?: string | string[]; properties?: Record<string, unknown>; required?: string[]; items?: unknown; enum?: unknown[]; additionalProperties?: boolean };
  const types = Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : [];
  const actual = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  if (types.length && !types.includes(actual) && !(types.includes("integer") && typeof input === "number" && Number.isInteger(input))) throw new Error("Arguments do not match the tool's schema.");
  if (spec.enum && !spec.enum.some((value) => JSON.stringify(value) === JSON.stringify(input))) throw new Error("Argument is outside the tool's allowed values.");
  if (actual === "object") {
    const object = input as Record<string, unknown>;
    for (const key of spec.required ?? []) if (!Object.hasOwn(object, key)) throw new Error(`Missing required argument: ${key}`);
    for (const [key, value] of Object.entries(object)) {
      if (!spec.properties || !Object.hasOwn(spec.properties, key)) throw new Error(`Undeclared argument: ${key}`);
      validateArguments(value, spec.properties[key], depth + 1);
    }
  } else if (Array.isArray(input) && spec.items) {
    for (const value of input) validateArguments(value, spec.items, depth + 1);
  }
}

/** One short-lived stdio connection. No shell, prompts, model, or inherited keys. */
export async function inspectMcp(
  command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
  tool: string, input: Record<string, unknown>, allowed: string[],
): Promise<{ request: unknown; response: unknown }> {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  let bytes = 0;
  let stderr = "";
  const pending = new Map<number, { resolve: (frame: RpcFrame) => void; reject: (error: Error) => void }>();
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const send = (frame: unknown) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const request = (id: number, method: string, params: unknown): Promise<RpcFrame> => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };
  child.on("error", fail);
  child.on("close", () => fail(new Error(`MCP server disconnected.${stderr.trim() ? ` ${stderr.trim().slice(-2000)}` : ""}`)));
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 262_144) { fail(new Error("MCP output exceeded 256 KB.")); child.kill(); return; }
    buffer += decoder.write(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        const frame = JSON.parse(line) as RpcFrame;
        if (frame.method && frame.id !== undefined) {
          send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "Client requests are disabled in Playground." } });
        } else if (typeof frame.id === "number") {
          const waiter = pending.get(frame.id); pending.delete(frame.id);
          if (frame.error) waiter?.reject(new Error(JSON.stringify(frame.error)));
          else waiter?.resolve(frame);
        }
      } catch { fail(new Error("Invalid JSON-RPC from server.")); }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
    bytes += chunk.length;
    if (bytes > 262_144) { fail(new Error("MCP output exceeded 256 KB.")); child.kill(); }
  });
  const timeout = setTimeout(() => { fail(new Error("Try timed out after 20 seconds.")); child.kill(); }, 20_000);
  try {
    await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "contextgit-playground", version: "1.0" } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listing = await request(2, "tools/list", {});
    const tools = (listing.result as { tools?: { name: string; description?: string; inputSchema?: unknown }[] })?.tools;
    if (!Array.isArray(tools) || tools.length > 200) throw new Error("Invalid tool listing.");
    // This is a limited heuristic, not a security certification. Nothing from
    // the server is inserted into an LLM context; only allowlisted reads can run.
    if (/ignore\s+(all\s+)?(previous|prior)|system\s+prompt|exfiltrat|send.{0,25}(secret|credential)/i.test(JSON.stringify(tools))) {
      throw new Error("Tool surface contains suspicious instructions; execution blocked.");
    }
    const selected = tools.find((entry) => entry.name === tool);
    if (!allowed.includes(tool) || !selected) throw new Error("Only declared read-only tools are available in Try.");
    validateArguments(input, selected.inputSchema);
    const frame = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: tool, arguments: input } };
    const response = await request(3, frame.method, frame.params);
    return { request: frame, response };
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    if (process.platform !== "win32" && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    } else child.kill("SIGKILL");
  }
}
