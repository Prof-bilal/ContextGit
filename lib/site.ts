/* Shared navigation and link constants for every marketing page. */

export const GITHUB = "https://github.com/Prof-bilal/ContextGit";
export const ISSUES = `${GITHUB}/issues`;
export const DOC = (path: string) => `${GITHUB}/blob/main/${path}`;

/** Header navigation. Keep to five items (pages.md §1: six or fewer). */
export const NAV = [
  { href: "/#workbench", label: "How it works" },
  { href: "/#agents", label: "Agents" },
  { href: "/#trust", label: "Trust" },
  { href: "/features", label: "Details" },
  { href: "/download", label: "Download" },
];

export const FOOTER_LINKS = [
  { href: "/#workbench", label: "How it works" },
  { href: "/#agents", label: "Agents" },
  { href: "/#trust", label: "Trust" },
  { href: "/features", label: "Details" },
  { href: "/download", label: "Download" },
  { href: GITHUB, label: "GitHub" },
];

export const HEADER_CTA = { label: "Download beta", href: "/download" };

/** The11 agent CLIs the app ships with, plus a plain shell (content.md §4.2). */
export const AGENTS = [
  "Claude Code",
  "Codex",
  "OpenCode",
  "Gemini CLI",
  "Aider",
  "Ollama",
  "Freebuff",
  "Cline",
  "Pi",
  "Kilo Code",
  "Command Code",
  "Shell",
];
