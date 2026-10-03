# Frontend Guide

**Stack:** React 19 + TypeScript, Vite (renderer), React Flow (commit graph), xterm.js (terminals), plain fetch client in `lib/api.ts`.

The UI ships as an **Electron desktop app** (`desktop/`). The Next.js app at the repo root serves the **landing page only** — no workbench route.

## Layout
1. **Sessions sidebar (left):** parallel AI runs — terminal sessions (any agent CLI) and chat sessions; live status dot, branch chip, delete. New session creates a branch.
2. **Main area:** tabbed — History (list/graph toggle) or terminal tabs (one xterm.js per session, PTY owned by the Electron main process).
3. **Commit bar (bottom):** staging buffer for the selected session — stage, undo, clear, commit on demand.
4. **Inspector panel (right, History view):** tokens, model, summary, diff view, health warnings.

## Rules
- API calls live in `lib/api.ts` (typed; mirrors `api/schemas.py`). Never use `any`.
- Server data: plain fetch + polling; UI-only state: React state/props (add Zustand only when prop drilling hurts).
- Merge always shows a **preview dialog** with stats (decisions/facts/conflicts) before applying.
- Streaming chat uses fetch streaming (SSE parser) and appends tokens incrementally.
- Commit-on-demand is the default: chat turns and staged terminal output land in the staging buffer; a commit happens when the user asks for it (sessions with `auto_commit` keep the old behavior).
- Graph must stay usable at 500+ commits: collapse linear chains or virtualize.
- Dark/light: `data-theme` on `<html>`, persisted key `contextgit-theme`, system preference on first visit. Never hard-code colors — use CSS variables (`--paper`, `--ink`, `--line`, `--signal`, `--bad`).

## Must-have interactions
Branch from any message · Compare mode (same prompt on two branches) · Cherry-pick · Tag a commit · Token budget bar · Export branch as plain prompt · Stage/commit per session · List/graph toggle.

## Accessibility
Keyboard navigation for the graph and history list, visible focus states, do not rely on color alone for branches or session status (add labels/titles).
