# Run roles and skills

A Code-tab **run** (and a team **task**) can be given a **role** — Frontend Developer,
Backend Developer, QA Engineer, CTO / Tech Lead, and so on. Every role auto-loads **five
skills** into the run's instructions, so the agent starts with a working checklist instead
of a blank prompt.

## The catalog

`desktop/shared/roles.ts` is the single source of truth (the same shared-module pattern as
`desktop/shared/harnesses.ts`). It holds one **universal skill registry** (`SKILLS`) and the
`ROLES` that reference five ids each; a skill like `ui-build` is defined once and reused by
frontend, full-stack, etc.

| Role | Five skills |
|---|---|
| Frontend Developer | UI research · UI design · UI build · Responsive check · Accessibility check |
| Backend Developer | API design · Data modeling · Service build · Backend tests · Performance review |
| Full-stack Developer | Feature scoping · UI build · API design · Wire-up · End-to-end check |
| QA Engineer | Test plan · Write tests · Exploratory testing · Regression sweep · Bug report |
| DevOps / SRE | Infra design · CI/CD · Observability · Reliability · Security & secrets |
| CTO / Tech Lead | Scope & priorities · Architecture review · Risk assessment · Delegation · Release decision |
| Product Designer | User research · Wireframe · Design system · Prototype · Design review |
| Data Engineer | Pipeline design · Schema design · Transform build · Data quality · Performance tuning |

Each skill carries a one-line `brief` the agent can act on. The registry is the only place
skills are defined — roles stay a list of five ids.

## What "auto-load" does

Picking a role resolves its five skills and injects them into the run, two ways:

1. **Kickoff briefing** — the line typed into the run's terminal when it starts:
   *"You are acting as a Frontend Developer on "<name>". Apply these skills on this run:
   1) UI research — …; 2) UI design — …"*.
2. **Managed `AGENTS.md` block** — `context_document` (`contextgit/gitops/context.py`) lists
   each run with its role and skills, so any agent CLI that reads `AGENTS.md` sees them.

The role and the five skill labels are stored on the session (columns `role` / `skills`,
migration `0011_session_role.sql`) and shown as a chip on the run row. No role → today's
behavior, unchanged.

## Where it lives

- Catalog: `desktop/shared/roles.ts`
- Run form: `desktop/src/shell/rail/AgentRail.tsx` (Role select + auto-loaded skill chips);
  the kickoff briefing is composed in `desktop/src/shell/Shell.tsx` (`startRun`).
- Team tasks: `desktop/src/shell/team/TaskForm.tsx` (Role select); the task briefing appends
  the role's skills (`Shell.briefingFor`).
- Backend: `Session.role` / `Session.skills` (`contextgit/core/models.py`), `create_session`,
  and the `AGENTS.md` line in `contextgit/gitops/context.py`.
