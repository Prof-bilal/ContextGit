/* Pricing data — single source of truth for the landing teaser and /pricing.
   Tier model mirrors files/plans-research.md §4 and files/monetization-strategy.md §4. */

export type TierId = "free" | "pro" | "team" | "enterprise";

export type TierStatus = "live" | "soon" | "contact";

export interface Tier {
  id: TierId;
  name: string;
  tagline: string;
  status: TierStatus;
  /** Shown in the price slot. No numbers yet — paid tiers read "Coming soon". */
  price: string;
  priceNote: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  /** The Free tier is the visual hero of the grid. */
  featured?: boolean;
}

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "The whole local app, on your machine.",
    status: "live",
    price: "$0",
    priceNote: "Free forever \u00b7 no account, no telemetry",
    featured: true,
    features: [
      "Conversation DAG \u2014 branch, diff, merge, roll back",
      "Parallel agent runs, one git worktree each",
      "Team mode \u2014 tasks, roles, ownership, quality gate",
      "Chat, Council, Research and Image surfaces",
      "Document export \u2014 Markdown, PDF, Word, PowerPoint",
      "All workbench tabs: Git, Endpoints, Why, DB, API, Browser, Editor",
      "MCP server and every CLI harness",
      "Bring your own LLM provider and key",
      "Unlimited local projects and commits",
    ],
    ctaLabel: "Install",
    ctaHref: "/#install",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For one developer who ships every day.",
    status: "soon",
    price: "Coming soon",
    priceNote: "Per user, billed monthly or yearly",
    features: [
      "Everything in Free",
      "Security suite \u2014 audit your own project",
      "Encrypted cloud backup and multi-device sync",
      "Cloud agents \u2014 run the heavy work off your laptop",
      "Managed inference credits (or keep your own key)",
      "Priority support",
    ],
    ctaLabel: "Notify me",
    ctaHref: "/pricing#waitlist",
  },
  {
    id: "team",
    name: "Team",
    tagline: "For people who ship together.",
    status: "soon",
    price: "Coming soon",
    priceNote: "Per seat, billed monthly or yearly",
    features: [
      "Everything in Pro",
      "Shared team memory and merge queue",
      "Roles and skills marketplace",
      "Shared usage analytics",
      "Central billing and administration",
      "SSO and role-based access",
    ],
    ctaLabel: "Notify me",
    ctaHref: "/pricing#waitlist",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For organizations at scale.",
    status: "contact",
    price: "Custom",
    priceNote: "Seats, self-hosting and support",
    features: [
      "Everything in Team",
      "Self-hosted or VPC sync server",
      "SAML, SCIM and audit logs",
      "Compliance and data-retention controls",
      "Dedicated support and SLA",
    ],
    ctaLabel: "Contact us",
    ctaHref: "/pricing#waitlist",
  },
];

/** A comparison row: true / false renders a tick / dash, strings render as text. */
export interface CompareRow {
  label: string;
  group?: string;
  values: Record<TierId, boolean | string>;
}

export const COMPARE_ROWS: CompareRow[] = [
  {
    label: "Conversation history as commits",
    group: "Local core",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Semantic merge with conflict preview",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Parallel agent runs and worktrees",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Local team mode, gate and verifier",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Chat, Council, Research, Image, Documents",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Bring your own provider and key",
    values: { free: true, pro: true, team: true, enterprise: true },
  },
  {
    label: "Projects and commits",
    group: "Limits",
    values: { free: "Unlimited (local)", pro: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  },
  {
    label: "Security audit of your project",
    group: "Security",
    values: { free: false, pro: true, team: true, enterprise: true },
  },
  {
    label: "Secrets, dependencies, AI review, live probes",
    values: { free: false, pro: true, team: true, enterprise: true },
  },
  {
    label: "CI security gate",
    values: { free: false, pro: "Add-on", team: true, enterprise: true },
  },
  {
    label: "Encrypted cloud backup and sync",
    group: "Cloud",
    values: { free: false, pro: true, team: true, enterprise: true },
  },
  {
    label: "Cloud agents (run off your machine)",
    values: { free: false, pro: true, team: true, enterprise: true },
  },
  {
    label: "Managed inference credits",
    values: { free: false, pro: true, team: true, enterprise: true },
  },
  {
    label: "Shared team memory and merge queue",
    group: "Teams",
    values: { free: false, pro: false, team: true, enterprise: true },
  },
  {
    label: "Central billing and admin",
    values: { free: false, pro: false, team: true, enterprise: true },
  },
  {
    label: "SSO and role-based access",
    values: { free: false, pro: false, team: true, enterprise: true },
  },
  {
    label: "Self-hosted or VPC sync server",
    group: "Enterprise",
    values: { free: false, pro: false, team: false, enterprise: true },
  },
  {
    label: "SAML, SCIM and audit logs",
    values: { free: false, pro: false, team: false, enterprise: true },
  },
  {
    label: "Support",
    group: "Support",
    values: { free: "Community", pro: "Priority", team: "Priority", enterprise: "Dedicated + SLA" },
  },
];

/** Waitlist / sales contact. The site is static, so the CTA opens the mail client. */
export const CONTACT_EMAIL = "pricing@contextgit.dev";

export const WAITLIST_HREF =
  "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent("ContextGit pricing waitlist");
