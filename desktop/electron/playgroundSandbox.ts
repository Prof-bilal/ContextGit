import path from "node:path";
import type { PlaygroundItem } from "../shared/playground";

export function sandboxPlan(item: PlaygroundItem, root: string, node: string, prefix: string, bin: string, wardenBin: string) {
  const grants = item.sandbox;
  if (!grants) throw new Error("MCP item has no reviewed sandbox policy.");
  const stateDirectory = grants.writeDirectory ? path.join(root, grants.writeDirectory) : null;
  const expand = (value: string) => value.replaceAll("{project}", root).replaceAll("{state}", stateDirectory ?? "");
  const env = Object.fromEntries(Object.entries(grants.env ?? {}).map(([name, value]) => [name, expand(value)]));
  const policyPath = path.join(root, ".contextgit-playground", `${item.id}.json`);
  // JSON is valid YAML, including quoted paths and explicit empty grants.
  const policy = `${JSON.stringify({
    command: [node, bin, ...(grants.args ?? []).map(expand)],
    filesystem: { read: [...(grants.projectRead ? [root] : []), prefix], write: stateDirectory ? [stateDirectory] : [] },
    network: { allow: grants.network ?? [] }, env: { allow: Object.keys(env) },
    limits: { memory_mb: 512, timeout_s: 30 },
  }, null, 2)}\n`;
  const entry = { command: node, args: [wardenBin, "run", "--policy", policyPath], ...(Object.keys(env).length ? { env } : {}) };
  return { policyPath, policy, stateDirectory, env, entry };
}
