import { SKILLS } from "./roles";
import { ECOSYSTEM_ITEMS } from "./playgroundEcosystem";

export type PlaygroundKind = "mcp" | "skill" | "tool" | "plugin";
export type PlaygroundTrust = "first-party" | "verified" | "community";
export interface PlaygroundItem {
  id: string;
  label: string;
  kind: PlaygroundKind;
  vendor: string;
  summary: string;
  featured?: boolean;
  trust: PlaygroundTrust;
  capabilities: string[];
  docsUrl: string;
  install:
    | { kind: "npm"; pkg: string; version: string; bin: string }
    | { kind: "mcp-config" }
    | { kind: "skill"; content: string }
    | { kind: "docs"; reason: string };
  tryTools?: string[];
  tryExamples?: Record<string, Record<string, unknown>>;
  tryNote?: string;
  tryCommand?: string;
  setup?: string[];
  sandbox?: {
    projectRead?: boolean;
    args?: string[];
    writeDirectory?: string;
    network?: string[];
    env?: Record<string, string>;
  };
}

/** Reviewed metadata, not a certification of a publisher's runtime behaviour. */
export const PLAYGROUND_ITEMS: PlaygroundItem[] = [
  {
    id: "codeatlas", label: "CodeAtlas", kind: "mcp", vendor: "CodeAtlas",
    summary: "Explore a live architectural map, code search and repository health over MCP.",
    featured: true, trust: "community", capabilities: ["Architecture", "Code search", "Read-only inspection"],
    docsUrl: "https://www.codeatlas.live/docs/mcp",
    install: { kind: "npm", pkg: "@codeatlas/mcp", version: "5.3.0", bin: "dist/mcp-server.js" },
    tryTools: ["get_workspace_status", "search_workspace", "list_entrypoints"],
    sandbox: { projectRead: true, args: ["{project}", "--read-only"], writeDirectory: ".codeatlas" },
  },
  {
    id: "warden", label: "Warden", kind: "tool", vendor: "Prof-bilal",
    summary: "Run MCP servers inside a deny-by-default OS sandbox with explicit filesystem, network and environment grants.",
    featured: true, trust: "community", capabilities: ["Sandbox", "MCP proxy", "Diagnostics"],
    docsUrl: "https://warden.blog/docs",
    install: { kind: "npm", pkg: "warden-sandbox-cli", version: "0.1.16", bin: "bin/warden" },
    tryTools: ["doctor"],
  },
  {
    id: "modelcheck", label: "ModelCheck", kind: "tool", vendor: "Prof-bilal",
    summary: "Compare models on structured output and tool calling with local, reproducible evidence reports.",
    featured: true, trust: "community", capabilities: ["Model evaluation", "Local reports", "Baseline comparison"],
    docsUrl: "https://model-checker-jet.vercel.app/",
    install: { kind: "npm", pkg: "modelcheck-cli", version: "0.1.2", bin: "dist/index.js" },
    tryTools: ["help"],
  },
  {
    id: "contextgit", label: "ContextGit team MCP", kind: "mcp", vendor: "ContextGit",
    summary: "Inspect your team board, tasks and ownership through the bundled MCP server.",
    trust: "first-party", capabilities: ["Team board", "Ownership", "Memory"],
    docsUrl: "https://github.com/Prof-bilal/ContextGit",
    install: { kind: "mcp-config" }, tryTools: ["team_status", "list_tasks", "check_ownership"],
  },
  {
    id: "inspector", label: "MCP Inspector", kind: "tool", vendor: "Model Context Protocol",
    summary: "The protocol project's standalone web, CLI and terminal inspector for MCP servers.",
    trust: "community", capabilities: ["JSON-RPC", "Debugging"],
    docsUrl: "https://github.com/modelcontextprotocol/inspector",
    install: { kind: "docs", reason: "External Inspector setup is available in its docs. ContextGit provides a bounded Try pane for supported items." },
  },
  {
    id: "claude-plugins", label: "Claude official plugins", kind: "plugin", vendor: "Anthropic",
    summary: "Plugins can bundle skills, agents, hooks and MCP servers. Browse the official marketplace and review each package's permissions.",
    trust: "community", capabilities: ["Skills", "Agents", "Hooks", "MCP bundles"],
    docsUrl: "https://github.com/anthropics/claude-plugins-official",
    install: { kind: "docs", reason: "Marketplace execution and plugin hooks need a separate review gate. Install through Claude's documented marketplace flow." },
  },
  ...Object.values(SKILLS).map((skill): PlaygroundItem => ({
    id: `skill-${skill.id}`, label: skill.label, kind: "skill", vendor: "ContextGit",
    summary: skill.brief, trust: "first-party", capabilities: ["Role skill", "Agent instructions"],
    docsUrl: "https://agentskills.io/specification",
    install: { kind: "skill", content: `---\nname: ${skill.id}\ndescription: ${skill.brief}\n---\n\n# ${skill.label}\n\n${skill.brief}\n` },
  })),
  ...ECOSYSTEM_ITEMS,
];

export interface PlaygroundInstalled {
  id: string;
  projectPath: string;
  installedAt: string;
  version?: string;
}
export interface PlaygroundPreview {
  token: string;
  itemId: string;
  projectPath: string;
  verdict: { status: "review" | "blocked"; findings: string[] };
  files: { path: string; before: string; after: string }[];
  commands: string[][];
  effects: string[];
}
export interface PlaygroundEvent {
  id: string;
  phase: "installing" | "verifying" | "done" | "error";
  line?: string;
  percent?: number;
  error?: string;
}
export interface PlaygroundTryResult {
  request: unknown;
  response: unknown;
}

export function playgroundItem(id: string): PlaygroundItem {
  const item = PLAYGROUND_ITEMS.find((entry) => entry.id === id);
  if (!item) throw new Error("Unknown Playground item.");
  return item;
}
