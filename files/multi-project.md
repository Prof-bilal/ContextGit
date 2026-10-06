# Multiple projects

A user can work in more than one project folder. The Code tab's left rail is a tree:

```
Projects ▾                         (dropdown: switch / open a folder)
  ▾ 📁 warden            active
      ▾ [C] Claude Code
          · run rows…
      ▾ [$] Shell
          · run rows…
  ▸ 📁 Techwizz
      ▾ [X] Codex
          · run rows…
```

Runs from the same project nest under that project; each project expands to its provider/CLI
groups, which expand to runs.

## One store, runs tagged by project

There is still **one** ContextGit store and **one** backend. Every run records the project it
belongs to via `Session.project_path` (migration `0012_session_project.sql`), which
`Repo.create_session` fills from the `project_path` it already receives for the worktree. The
rail groups runs by that field, falling back to the project recovered from a run's
`worktree_path` (`<project>/.contextgit/worktrees/<name>`) and finally an "Other" bucket, so
runs recorded before this column existed still land in the right group (see
`Repo._backfill_session_projects`).

## Remembered projects + the active one

The Electron main process keeps the list of opened folders and which one is active in
`<userData>/projects.json` (`{ active, paths }`), migrating an older single `workspace.json`
into it on first read. `CONTEXTGIT_WORKDIR` stays a hard single-project override for
tests/scripts.

- New terminals and agents start in the **active** project.
- The **dropdown** in the rail header switches the active project or opens a new folder
  (`Open folder…` reuses the project picker). A project can be forgotten from the list without
  touching its runs or commits.
- A PTY's working directory is allowed inside **any** known project (or its worktrees), so
  re-opening an old run in another project still lands in its worktree.

## Where it lives

- Backend: `Session.project_path` (`contextgit/core/models.py`), `Repo.create_session` /
  `_backfill_session_projects` (`contextgit/core/repo.py`).
- Main process: `desktop/electron/main.ts` (projects store + `ctx:projects-*` IPC);
  `desktop/electron/preload.ts`, `desktop/src/bridge.d.ts`.
- Renderer: `desktop/src/shell/workspace/useProjects.ts` (list + active + actions) and
  `desktop/src/shell/rail/ProjectsRail.tsx` (the tree + header dropdown).
