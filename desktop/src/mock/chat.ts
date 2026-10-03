/**
 * Mock data for the Chat tab's new features (§7.5). Fixture-driven on purpose:
 * no backend calls, no image provider, no search backend — the mock exists so the
 * layout and interactions can be seen and iterated first.
 */

export type ChatMode = "chat" | "council" | "research" | "image";

export const CHAT_MODES: Array<{ value: ChatMode; label: string; hint: string }> = [
  { value: "chat", label: "Chat", hint: "Ask one model" },
  { value: "council", label: "Council", hint: "Same prompt, several models" },
  { value: "research", label: "Research", hint: "Plan → search → cited report" },
  { value: "image", label: "Image", hint: "Versioned prompt → render" },
];

export interface ComposerControls {
  council: string[];
  depth: "quick" | "standard" | "deep";
  imageModel: string;
  aspect: string;
}

export const DEFAULT_CONTROLS: ComposerControls = {
  council: ["claude", "chatgpt", "codex"],
  depth: "standard",
  imageModel: "gpt-image",
  aspect: "16:9",
};

/** Image models are separate endpoints — the chat model only writes the prompt. */
export const IMAGE_MODELS = [
  { id: "gpt-image", label: "GPT Image 1.5" },
  { id: "ideogram", label: "Ideogram v3" },
  { id: "flux", label: "Flux 2" },
  { id: "imagen", label: "Imagen 4" },
  { id: "local", label: "Local · Flux (ComfyUI)" },
];

export const ASPECTS = ["1:1", "16:9", "9:16", "3:2"];

export interface CouncilAnswer {
  providerId: string;
  modelId: string;
  stance: string;
  text: string;
}

/** Three deliberately different answers — the dissent is the point of a council. */
export const COUNCIL_ANSWERS: CouncilAnswer[] = [
  {
    providerId: "claude",
    modelId: "sonnet-4.6",
    stance: "recommended",
    text: "In-process LRU while you run a single node. One clock means the refill window can't disagree with itself — that was the whole 50ms skew. Move to Redis only when a second instance must share the bucket.",
  },
  {
    providerId: "chatgpt",
    modelId: "gpt-5.5",
    stance: "pragmatic",
    text: "Start in-process, but put the bucket behind a small interface so the swap to Redis is one file. You avoid a migration now without designing yourself into a corner later.",
  },
  {
    providerId: "codex",
    modelId: "gpt-5.3-codex",
    stance: "dissents",
    text: "Ship Redis now. The skew was a tuning bug, not a fundamental one — sticky TTLs plus a single writer fix it, and you skip the in-process-to-Redis migration when you scale horizontally.",
  },
];

export interface ResearchStep {
  id: string;
  label: string;
  detail: string;
}

export const RESEARCH_STEPS: ResearchStep[] = [
  { id: "plan", label: "Plan", detail: "3 sub-questions on bucket locality" },
  { id: "search", label: "Search", detail: "14 candidate sources scanned" },
  { id: "read", label: "Read", detail: "6 sources kept after triage" },
  { id: "gaps", label: "Evaluate gaps", detail: "1 gap found → one more search" },
  { id: "synth", label: "Synthesize", detail: "Report with inline citations" },
];

export const RESEARCH_SOURCES = [
  { id: 1, title: "Distributed rate limiting: token buckets at the edge", host: "redis.io" },
  { id: 2, title: "Clock skew in multi-node counters", host: "sre.google" },
  { id: 3, title: "In-process LRU vs shared cache benchmarks", host: "benchmarks.dev" },
  { id: 4, title: "Migrating a limiter without dropping traffic", host: "martinfowler.com" },
];

export const RESEARCH_REPORT =
  "A single-node deployment should keep the bucket in-process: the refill window is read from one " +
  "clock, which removes the skew class of bug entirely [1][2]. The earlier 50ms disagreement was " +
  "two nodes applying the same refill at different instants, double-counting requests [2]. Shared " +
  "counters only pay for themselves once a second instance must honour the same limit, and the " +
  "measured overhead of a local LRU is roughly an order of magnitude lower than a network hop [3]. " +
  "If you expect horizontal scale, hide the bucket behind a narrow interface now so the swap is a " +
  "single-file change rather than a migration [4].";

export interface PromptVersion {
  version: number;
  text: string;
  note: string;
}

/** The prompt is the artifact: every generate keeps a version and why it changed. */
export const PROMPT_VERSIONS: PromptVersion[] = [
  {
    version: 1,
    text: "isometric diagram of a token bucket with an in-process LRU cache, dark UI, orange accent",
    note: "initial prompt from your idea",
  },
  {
    version: 2,
    text: "isometric diagram of a token bucket with an in-process LRU cache, dark UI, orange accent — 35mm lens, soft key light from the left, thin blueprint grid, no text labels",
    note: "added lens, light direction, and a negative",
  },
  {
    version: 3,
    text: "isometric diagram of a token bucket with an in-process LRU cache, dark UI, orange accent — 35mm lens, soft key light from the left, thin blueprint grid, no text labels — 8k, crisp edges, teal shadow fill",
    note: "sharpened quality terms after v2 looked soft",
  },
];

export interface BlameRecord {
  claim: string;
  turn: number;
  session: string;
  agent: string;
  branch: string;
  commitId: string;
  replaced: string | null;
}

const BLAME_BASE: Array<Partial<BlameRecord>> = [
  {
    session: "auth-experiment",
    agent: "claude",
    branch: "exp/redis-sessions",
    commitId: "77aa10c5e882ef",
    replaced: "Redis sessions would fix the skew (reverted)",
  },
  {
    session: "tighten auth guard",
    agent: "claude",
    branch: "fix/subscription-guard",
    commitId: "3a7e5c2d9f10aa",
    replaced: null,
  },
  {
    session: "write e2e tests",
    agent: "codex",
    branch: "test/cancelled-tier-e2e",
    commitId: "b41d9e6a2c33cd",
    replaced: "sticky sessions are unnecessary",
  },
  {
    session: "tighten auth guard",
    agent: "claude",
    branch: "fix/subscription-guard",
    commitId: "3a7e5c2d9f10aa",
    replaced: null,
  },
];

/** Provenance for a message — deliberately crosses two sessions and two agents. */
export function blameFor(index: number, claim: string): BlameRecord {
  const base = BLAME_BASE[index % BLAME_BASE.length];
  return {
    claim,
    turn: index + 1,
    session: base.session ?? "this chat",
    agent: base.agent ?? "claude",
    branch: base.branch ?? "chat/caching-strategy",
    commitId: base.commitId ?? "d1a2b3c4e5f6",
    replaced: base.replaced ?? null,
  };
}

export interface GovernorItem {
  id: string;
  text: string;
  kind: "kept" | "dropped" | "dead-end";
  reason: string;
  pinned: boolean;
}

export const GOVERNOR_RECEIPTS: GovernorItem[] = [
  {
    id: "g1",
    text: "in-process LRU beats a network hop",
    kind: "kept",
    reason: "decision, still referenced",
    pinned: true,
  },
  {
    id: "g2",
    text: "two Redis nodes disagreed by 50ms",
    kind: "dead-end",
    reason: "failed attempt — never dropped",
    pinned: false,
  },
  {
    id: "g3",
    text: "sticky sessions fixed the double-count",
    kind: "kept",
    reason: "fact, supports the decision",
    pinned: false,
  },
  {
    id: "g4",
    text: "explored a sliding-window counter instead",
    kind: "dropped",
    reason: "superseded by the token bucket",
    pinned: false,
  },
  {
    id: "g5",
    text: "early benchmark numbers from v0 draft",
    kind: "dropped",
    reason: "stale — re-measured later",
    pinned: false,
  },
];
