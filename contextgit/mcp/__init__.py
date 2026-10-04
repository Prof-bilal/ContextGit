"""MCP channel: let agents see and talk to each other during their work.

The board file (`.contextgit/team.md` + the managed `AGENTS.md` block) already
tells every agent what the team is doing. This package adds the live half:
`contextgit-mcp` exposes the same team state as MCP tools, so an agent can ask
who owns a file, claim a task, or post an update without leaving its terminal.

`tools` and `config` are deliberately free of the MCP SDK — only `server` binds
them to a transport, which keeps the logic unit-testable without the dependency.
"""
