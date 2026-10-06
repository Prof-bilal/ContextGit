/**
 * Universal role + skill catalog for Code-tab runs.
 *
 * A *role* (Frontend Developer, QA Engineer, …) references exactly five skills
 * from one shared registry, so a skill like `ui-build` is defined once and used
 * by several roles. Picking a role auto-loads its five skills into the run's
 * instructions. The renderer is the single source of truth: it resolves a role
 * to human-readable labels and sends those to the backend (no Python copy).
 */
export interface Skill {
  id: string;
  label: string;
  /** One imperative sentence the agent can act on. */
  brief: string;
}

export interface Role {
  id: string;
  label: string;
  /** Fallback glyph when the role has no brand mark. */
  monogram: string;
  /** Exactly five skill ids into `SKILLS`. */
  skills: string[];
}

/** The shared skill vocabulary every role draws from. */
export const SKILLS: Record<string, Skill> = {
  // Frontend / design
  "ui-research": {
    id: "ui-research",
    label: "UI research",
    brief: "Survey references, existing screens and patterns before designing anything.",
  },
  "ui-design": {
    id: "ui-design",
    label: "UI design",
    brief: "Define layout, spacing, type and component states that fit the app's system.",
  },
  "ui-build": {
    id: "ui-build",
    label: "UI build",
    brief: "Implement the interface with reusable components and clean, accessible markup.",
  },
  responsive: {
    id: "responsive",
    label: "Responsive check",
    brief: "Verify every breakpoint — no overflow, clipping or layout shift.",
  },
  a11y: {
    id: "a11y",
    label: "Accessibility check",
    brief: "Keyboard paths, focus order, labels, contrast and reduced-motion all hold.",
  },
  // Backend
  "api-design": {
    id: "api-design",
    label: "API design",
    brief: "Shape endpoints, request/response schemas and error contracts before coding.",
  },
  "data-model": {
    id: "data-model",
    label: "Data modeling",
    brief: "Define tables, migrations, indexes and the invariants they must keep.",
  },
  "service-build": {
    id: "service-build",
    label: "Service build",
    brief: "Implement handlers, business logic and input validation cleanly.",
  },
  "backend-tests": {
    id: "backend-tests",
    label: "Backend tests",
    brief: "Write unit and integration tests that cover the new behavior and its edges.",
  },
  "perf-review": {
    id: "perf-review",
    label: "Performance review",
    brief: "Check query cost, N+1s, batching and payload sizes before calling it done.",
  },
  // Full-stack glue
  "feature-scope": {
    id: "feature-scope",
    label: "Feature scoping",
    brief: "Cut the request into the smallest end-to-end slice that still ships value.",
  },
  integration: {
    id: "integration",
    label: "Wire-up",
    brief: "Connect UI to API with loading, error and empty states handled.",
  },
  "e2e-check": {
    id: "e2e-check",
    label: "End-to-end check",
    brief: "Exercise the whole path in a browser or a scripted test, not just the units.",
  },
  // QA
  "test-plan": {
    id: "test-plan",
    label: "Test plan",
    brief: "Enumerate cases from the acceptance criteria plus the edge cases they miss.",
  },
  "write-tests": {
    id: "write-tests",
    label: "Write tests",
    brief: "Add automated tests that fail before the fix and pass after it.",
  },
  exploratory: {
    id: "exploratory",
    label: "Exploratory testing",
    brief: "Hunt by hand for gaps the written plan did not cover.",
  },
  regression: {
    id: "regression",
    label: "Regression sweep",
    brief: "Re-check existing behavior this change could have broken.",
  },
  "bug-report": {
    id: "bug-report",
    label: "Bug report",
    brief: "Reproduce, minimize and file each failure with clear evidence.",
  },
  // DevOps / SRE
  "infra-design": {
    id: "infra-design",
    label: "Infra design",
    brief: "Shape the environments, services and configuration the change needs.",
  },
  "ci-cd": {
    id: "ci-cd",
    label: "CI/CD",
    brief: "Keep the build, test and deploy pipelines green and fast.",
  },
  observability: {
    id: "observability",
    label: "Observability",
    brief: "Add logs, metrics and traces so the new path can be diagnosed.",
  },
  reliability: {
    id: "reliability",
    label: "Reliability",
    brief: "Handle timeouts, retries, backpressure and partial failure.",
  },
  security: {
    id: "security",
    label: "Security & secrets",
    brief: "Keep least privilege, secret handling and dependency risk in check.",
  },
  // CTO / Tech Lead
  "scope-priorities": {
    id: "scope-priorities",
    label: "Scope & priorities",
    brief: "Decide what matters now, what waits, and say why.",
  },
  "architecture-review": {
    id: "architecture-review",
    label: "Architecture review",
    brief: "Test the design against the system's long-term constraints.",
  },
  "risk-assessment": {
    id: "risk-assessment",
    label: "Risk assessment",
    brief: "Surface the technical, product and delivery risks early.",
  },
  delegation: {
    id: "delegation",
    label: "Delegation",
    brief: "Split the work into clear, independently ownable tasks.",
  },
  "release-decision": {
    id: "release-decision",
    label: "Release decision",
    brief: "State the bar to ship and whether the work has met it.",
  },
  // Product design
  "user-research": {
    id: "user-research",
    label: "User research",
    brief: "Pin down the user's goal, context and constraints first.",
  },
  wireframe: {
    id: "wireframe",
    label: "Wireframe",
    brief: "Sketch the flow and structure before any visual detail.",
  },
  "design-system": {
    id: "design-system",
    label: "Design system",
    brief: "Reuse the existing tokens, components and patterns.",
  },
  prototype: {
    id: "prototype",
    label: "Prototype",
    brief: "Make the flow tangible enough to review and react to.",
  },
  "design-review": {
    id: "design-review",
    label: "Design review",
    brief: "Critique the result against usability and consistency.",
  },
  // Data
  "pipeline-design": {
    id: "pipeline-design",
    label: "Pipeline design",
    brief: "Define sources, sinks, cadence and idempotency.",
  },
  "schema-design": {
    id: "schema-design",
    label: "Schema design",
    brief: "Model the data for how it will be queried and evolved.",
  },
  "transform-build": {
    id: "transform-build",
    label: "Transform build",
    brief: "Implement the transforms with clear, tested logic.",
  },
  "data-quality": {
    id: "data-quality",
    label: "Data quality",
    brief: "Add validation, freshness and anomaly checks.",
  },
  "perf-tuning": {
    id: "perf-tuning",
    label: "Performance tuning",
    brief: "Tune partitioning, joins and cost where it counts.",
  },
};

/** Eight roles, each auto-loading its own five skills. */
export const ROLES: Role[] = [
  {
    id: "frontend",
    label: "Frontend Developer",
    monogram: "F",
    skills: ["ui-research", "ui-design", "ui-build", "responsive", "a11y"],
  },
  {
    id: "backend",
    label: "Backend Developer",
    monogram: "B",
    skills: ["api-design", "data-model", "service-build", "backend-tests", "perf-review"],
  },
  {
    id: "fullstack",
    label: "Full-stack Developer",
    monogram: "S",
    skills: ["feature-scope", "ui-build", "api-design", "integration", "e2e-check"],
  },
  {
    id: "qa",
    label: "QA Engineer",
    monogram: "Q",
    skills: ["test-plan", "write-tests", "exploratory", "regression", "bug-report"],
  },
  {
    id: "devops",
    label: "DevOps / SRE",
    monogram: "D",
    skills: ["infra-design", "ci-cd", "observability", "reliability", "security"],
  },
  {
    id: "cto",
    label: "CTO / Tech Lead",
    monogram: "T",
    skills: [
      "scope-priorities",
      "architecture-review",
      "risk-assessment",
      "delegation",
      "release-decision",
    ],
  },
  {
    id: "designer",
    label: "Product Designer",
    monogram: "P",
    skills: ["user-research", "wireframe", "design-system", "prototype", "design-review"],
  },
  {
    id: "data",
    label: "Data Engineer",
    monogram: "N",
    skills: ["pipeline-design", "schema-design", "transform-build", "data-quality", "perf-tuning"],
  },
];

export const ROLE_BY_ID: Record<string, Role> = Object.fromEntries(
  ROLES.map((role) => [role.id, role]),
);

/** A role's five skills, resolved from the shared registry. */
export function roleSkills(role: Role): Skill[] {
  return role.skills.map((id) => SKILLS[id]).filter(Boolean);
}

/** Resolve a stored role string (id or label, case-insensitive) back to a role. */
export function roleFor(text: string | null | undefined): Role | undefined {
  if (!text) return undefined;
  const wanted = text.trim().toLowerCase();
  return ROLES.find(
    (role) => role.id.toLowerCase() === wanted || role.label.toLowerCase() === wanted,
  );
}

/** A compact label for tight spots like a rail chip (the first word of the label). */
export function roleShort(role: Role): string {
  return role.label.split(" ")[0];
}
