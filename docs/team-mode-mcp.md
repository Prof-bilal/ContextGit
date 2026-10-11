# Team mode — the MCP channel

> How agents talk to each other while they work. Companion to
> `team-mode-landscape.md`, `team-mode-concept.md` and `team-mode-architecture.md`.

## What it is

Team mode has two channels, cheapest first:

1. **The board file** — `.contextgit/team.md`, mirrored into the managed
   `<!-- contextgit:team:begin -->` block of the project's `AGENTS.md`. Every
   agent CLI reads it for free; it carries the task graph, who owns which files,
   and the latest messages. Written on every state change.
2. **MCP** (this document) — the same state as live tools, so an agent can ask a
   question mid-task instead of only at start-up.

The file is the source of truth; MCP is a live view over it. Neither is required
for the other to work.

## Running it

```bash
pip install -e ".[mcp]"     # adds the `mcp` extra
contextgit-mcp --repo /path/to/repo     # stdio server; CONTEXTGIT_REPO also works
```

Launching a team writes `.mcp.json` into the project, merging (never clobbering)
a `contextgit` server entry, so MCP-capable CLIs pick it up automatically:

```json
{
  "mcpServers": {
    "contextgit": { "args": [], "command": "/path/to/.venv/bin/contextgit-mcp" }
  }
}
```

Each run's terminal is started with `CONTEXTGIT_RUN`, `CONTEXTGIT_TASK` and its
own `PORT`, so the server already knows which task is calling.

## Tools

| Tool | Does |
|---|---|
| `team_status()` | Counts, blockers, what is waiting on review |
| `list_tasks(status?)` | Tasks with owner, scope, dependencies and gate verdict |
| `read_board(since?, limit?)` | Recent board messages (pass the last id you saw) |
| `claim_task(task_id?)` | Claim and start a task (your own by default) |
| `complete_task(task_id?, evidence?)` | Finish it — the quality gate runs, then it waits on review |
| `post_update(text, task_id?)` | Tell the other runs what changed |
| `check_ownership(path)` | Who owns a file path, or whether it is free |
| `publish_contract(path, task_id?)` | Declare the interface file your task owns |
| `peers()` | The other runs: their scope, status and latest message |

Domain errors come back as `{"error": ..., "type": ...}` rather than a transport
failure, so an agent can read the reason (e.g. "waiting on api-contract") and act.

## Per-CLI setup

- **Claude Code** — automatic: `.mcp.json` in the project root is picked up.
- **Codex / Gemini CLI / OpenCode / others** — add the same command to that CLI's
  MCP config (they all accept a command + args over stdio). The board file works
  even when a CLI has no MCP support at all.

## Security

The tools only read and write the local ContextGit repository and the team board
— no network, no shell. They start and complete tasks and post messages; they
cannot run project commands (`run gate` stays a human action) or touch git
history beyond the existing worktree/branch model.
