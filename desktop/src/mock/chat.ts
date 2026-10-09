/**
 * Mock data for the Chat tab's new features (§7.5). Fixture-driven on purpose:
 * no backend calls, no image provider, no search backend — the mock exists so the
 * layout and interactions can be seen and iterated first.
 */

export type ChatMode = "chat" | "work" | "council" | "research" | "image";

export const CHAT_MODES: Array<{ value: ChatMode; label: string; hint: string }> = [
  { value: "chat", label: "Chat", hint: "Ask one model" },
  { value: "work", label: "Work", hint: "Plan → edit → validate → commit" },
  { value: "council", label: "Council", hint: "Same prompt, several models" },
  { value: "research", label: "Research", hint: "Plan → search → cited report" },
  { value: "image", label: "Image", hint: "Versioned prompt → render" },
];

/** File types the Docs creator can generate. */
export type DocumentFormat = "md" | "pdf" | "docx" | "pptx";

export const DOCUMENT_FORMATS: Array<{ value: DocumentFormat; label: string; hint: string }> = [
  { value: "md", label: "Markdown", hint: ".md — plain text" },
  { value: "pdf", label: "PDF", hint: ".pdf — printable" },
  { value: "docx", label: "Word", hint: ".docx — editable" },
  { value: "pptx", label: "Slides", hint: ".pptx — presentation" },
];

/** House styles for the Docs creator. */
export type DocumentTemplate = "report" | "brief" | "proposal";

export const DOCUMENT_TEMPLATES: Array<{
  value: DocumentTemplate;
  label: string;
  hint: string;
}> = [
  { value: "report", label: "Report", hint: "Formal, numbered sections" },
  { value: "brief", label: "Brief", hint: "Concise, scannable" },
  { value: "proposal", label: "Proposal", hint: "Accent colour, persuasive" },
];

export type ResearchMode = "deep" | "competitive" | "lead" | "verify";

export const RESEARCH_MODES: Array<{ value: ResearchMode; label: string; hint: string }> = [
  { value: "deep", label: "Deep", hint: "Iterative search → cited report" },
  { value: "competitive", label: "Competitive", hint: "Comparison matrix across sources" },
  { value: "lead", label: "Lead", hint: "Companies/people from public pages" },
  { value: "verify", label: "Verify", hint: "Check claims against independent sources" },
];

/** Free/paid filter for the council model dropdowns. */
export type CouncilFacet = "all" | "free" | "paid";

export const COUNCIL_FACETS: Array<{ value: CouncilFacet; label: string; hint: string }> = [
  { value: "all", label: "All", hint: "Every model" },
  { value: "free", label: "Free", hint: "Free models (:free, local, offline)" },
  { value: "paid", label: "Paid", hint: "Metered models" },
];

export interface ComposerControls {
  /** Council members as "provider:model" keys, one per dropdown slot. */
  council: string[];
  /** Restrict the council dropdowns to free or paid models. */
  councilFacet: CouncilFacet;
  researchMode: ResearchMode;
  depth: "quick" | "standard" | "deep";
  imageProvider: string;
  imageModel: string;
  aspect: string;
}

export const DEFAULT_CONTROLS: ComposerControls = {
  council: [],
  councilFacet: "all",
  researchMode: "deep",
  depth: "standard",
  imageProvider: "",
  imageModel: "",
  aspect: "16:9",
};

export const ASPECTS = ["1:1", "16:9", "9:16", "3:2"];

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
