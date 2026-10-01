# Frontend Guide

**Stack:** React 18 + TypeScript, Vite, React Flow (commit graph), TanStack Query, Zustand (UI state), Tailwind.

## Layout (three panels)
1. **Graph panel:** commit graph, branch colors, merge/tag markers, click to select, two-select to diff.
2. **Chat panel:** conversation at the selected commit; sending a message creates a commit on the current branch.
3. **Inspector panel:** tokens, model, summary, diff view, health warnings.

## Rules
- Server data through TanStack Query; UI-only state (selection, panel sizes) in Zustand.
- Components are presentational; API calls live in `web/src/api/`.
- Types for API responses are generated from or mirror `api/schemas.py`. Never use `any`.
- Merge always shows a **preview dialog** with the generated summary before applying.
- Streaming chat uses `EventSource`/fetch streaming and appends tokens incrementally.
- Graph must stay usable at 500+ commits: virtualize or collapse linear chains.

## Must-have interactions
Branch from any message · Compare mode (same prompt on two branches) · Cherry-pick · Tag a commit · Token budget bar · Export branch as plain prompt.

## Accessibility
Keyboard navigation for the graph, visible focus states, do not rely on color alone for branches (add labels).
