"""MCP transport: bind the team tools to a server an agent can talk to.

`contextgit-mcp` speaks MCP over stdio. It is started by the agent's own CLI
(see the project's `.mcp.json`), inherits that run's environment, and therefore
knows which task it belongs to via `CONTEXTGIT_TASK`.
"""

from __future__ import annotations

from typing import Any, Literal

from mcp.server.mcpserver import MCPServer

from contextgit.mcp import tools

INSTRUCTIONS = (
    "ContextGit team tools. You are one run in a team working in the same project; "
    "each run owns its own files. Call team_status() to see the board, check_ownership(path) "
    "before editing a file you do not own, post_update(text) to tell the others what you "
    "changed, and complete_task(evidence) when your task is done. Your own task id is in "
    "the CONTEXTGIT_TASK environment variable. Before designing anything, call "
    "dead_ends() and decisions() — they return what earlier runs already rejected and "
    "decided for the files in your scope, derived from their conversations. why(path, line) "
    "explains a specific change, and endpoints()/endpoint_tests() list this project's API "
    "surface and whether its generated tests still hold."
)


def build_server(repo_path: str | None = None) -> MCPServer:
    """The MCP server with one tool per team operation."""
    server: MCPServer = MCPServer(name="contextgit", instructions=INSTRUCTIONS)

    def repo() -> Any:
        return tools.open_repo(repo_path)

    @server.tool(description="The team board: counts, blockers and what is in review.")
    def team_status() -> dict[str, Any]:
        return tools.team_status(repo())

    @server.tool(description="List team tasks, with owner, scope and dependencies.")
    def list_tasks(status: str | None = None) -> list[dict[str, Any]]:
        return tools.list_tasks(repo(), status)

    @server.tool(description="Recent board messages; pass the last id you saw as `since`.")
    def read_board(since: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
        return tools.read_board(repo(), since, limit)

    @server.tool(description="Claim and start a task (your own by default).")
    def claim_task(task_id: str | None = None) -> dict[str, Any]:
        return tools.start_task(repo(), task_id)

    @server.tool(description="Finish a task; the quality gate runs and it lands in review.")
    def complete_task(task_id: str | None = None, evidence: str = "") -> dict[str, Any]:
        return tools.finish_task(repo(), task_id, evidence)

    @server.tool(description="Post an update to the team board.")
    def post_update(text: str, task_id: str | None = None) -> dict[str, Any]:
        return tools.post_update(repo(), text, task_id)

    @server.tool(description="Who owns a file path, or whether it is free.")
    def check_ownership(path: str) -> dict[str, Any]:
        return tools.check_ownership(repo(), path)

    @server.tool(description="The other runs: their scope, status and latest message.")
    def peers() -> list[dict[str, Any]]:
        return tools.peers(repo())

    @server.tool(description="Declare the interface file your task owns (single owner).")
    def publish_contract(path: str, task_id: str | None = None) -> dict[str, Any]:
        return tools.publish_contract(repo(), path, task_id)

    # -- memory: what the runs already decided and rejected for your files --

    @server.tool(
        description=(
            "What the recorded runs decided about these files (defaults to your "
            "task's scope). Derived from the conversation history, not hand-written."
        )
    )
    def memory(path: str | None = None) -> dict[str, Any]:
        return tools.memory(repo(), path)

    @server.tool(
        description=(
            "Approaches already rejected for these files, with the reason. Check "
            "this before proposing a design — do not retry a dead end blindly."
        )
    )
    def dead_ends(path: str | None = None) -> dict[str, Any]:
        return tools.dead_ends(repo(), path)

    @server.tool(description="The decisions the recorded runs made about these files, and why.")
    def decisions(path: str | None = None) -> dict[str, Any]:
        return tools.decisions(repo(), path)

    @server.tool(description="Why a file or line exists: the reasoning behind the change.")
    def why(path: str, line: int | None = None, as_of: str | None = None) -> dict[str, Any]:
        return tools.why_line(repo(), path, line, as_of)

    @server.tool(description="The project's endpoints, with the handler behind each one.")
    def endpoints(path: str | None = None) -> dict[str, Any]:
        return tools.endpoints(repo(), path)

    @server.tool(description="The generated API tests, and whether they are still true.")
    def endpoint_tests(path: str | None = None) -> dict[str, Any]:
        return tools.endpoint_tests(repo(), path)

    return server


def run(repo_path: str | None = None, transport: Literal["stdio"] = "stdio") -> None:
    """Serve the team tools until the client disconnects."""
    build_server(repo_path).run(transport)
