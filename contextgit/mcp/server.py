"""MCP transport: bind the team tools to a server an agent can talk to.

`contextgit-mcp` speaks MCP over stdio. It is started by the agent's own CLI
(see the project's `.mcp.json`), inherits that run's environment, and therefore
knows which task it belongs to via `CONTEXTGIT_TASK`.
"""

from __future__ import annotations

from typing import Any, Literal, cast

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

    @server.tool(
        description=(
            "Submit committed code for integration; requires a clean worker "
            "and enabled project authority."
        )
    )
    def ready_for_integration(session_id: str | None = None) -> dict[str, Any]:
        current = repo()
        team_id = tools.current_team_id(current)
        if team_id and current.get_team(team_id).orchestrator_agent:
            return {"error": "Spatial teams require a user-confirmed merge. Use prepare_merge."}
        if not session_id:
            task_id = tools.current_task_id()
            if not task_id:
                return {"error": "Provide session_id or run inside a Team task"}
            session_id = current.get_task(task_id).session_id
        if not session_id:
            return {"error": "Task has no worker session"}
        try:
            return cast(dict[str, Any], current.integration.ready(session_id))
        except ValueError as error:
            return {"error": str(error)}

    @server.tool(description="Read integration progress and worker feedback for a readiness job.")
    def integration_status(job_id: str) -> dict[str, Any]:
        try:
            return cast(dict[str, Any], repo().integration.job(job_id))
        except ValueError as error:
            return {"error": str(error)}

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

    # -- orchestrator: these calls are authorized by CONTEXTGIT_ROLE + CONTEXTGIT_TEAM --

    @server.tool(
        description=(
            "Orchestrator only: submit a structured 1-12 worker plan for user review "
            "without launching it."
        )
    )
    def propose_team_plan(
        goal: str,
        tasks: list[dict[str, Any]],
        completion_criteria: list[str] | None = None,
        quality_gates: list[str] | None = None,
    ) -> dict[str, Any]:
        return tools.propose_team_plan(repo(), goal, tasks, completion_criteria, quality_gates)

    @server.tool(description="Orchestrator only: submit a new immutable revision of the team plan.")
    def revise_team_plan(
        goal: str,
        tasks: list[dict[str, Any]],
        completion_criteria: list[str] | None = None,
        quality_gates: list[str] | None = None,
    ) -> dict[str, Any]:
        return tools.revise_team_plan(repo(), goal, tasks, completion_criteria, quality_gates)

    @server.tool(
        description="Orchestrator only: create a task or revise an existing task before launch."
    )
    def create_or_update_task(
        title: str,
        brief: str = "",
        role: str = "implementer",
        agent: str | None = None,
        scope: list[str] | None = None,
        done_criteria: str = "",
        task_id: str | None = None,
    ) -> dict[str, Any]:
        return tools.create_or_update_task(
            repo(), title, brief, role, agent, scope, done_criteria, task_id
        )

    @server.tool(description="Orchestrator only: assign a CLI and role to a worker task.")
    def assign_worker(task_id: str, agent: str, role: str) -> dict[str, Any]:
        return tools.assign_worker(repo(), task_id, agent, role)

    @server.tool(
        description="Orchestrator only: attach an immutable skill snapshot to its team or task."
    )
    def attach_skill(
        skill_id: str,
        title: str,
        instruction: str,
        origin: str = "project",
        task_id: str | None = None,
        agent: str | None = None,
    ) -> dict[str, Any]:
        return tools.attach_skill(repo(), skill_id, title, instruction, origin, task_id, agent)

    @server.tool(description="Orchestrator only: approve reviewed work or request changes.")
    def review_task(
        task_id: str, decision: Literal["approve", "reject"], note: str = ""
    ) -> dict[str, Any]:
        return tools.review_task(repo(), task_id, decision, note)

    @server.tool(
        description=(
            "Orchestrator only: pause dependency scheduling without killing active processes."
        )
    )
    def pause_team() -> dict[str, Any]:
        return tools.pause_team(repo())

    @server.tool(
        description="Orchestrator only: resume dependency scheduling and launch ready workers."
    )
    def resume_team() -> dict[str, Any]:
        return tools.resume_team(repo())

    @server.tool(
        description=(
            "Orchestrator only: check merge readiness; final integration "
            "still requires a user action."
        )
    )
    def prepare_merge() -> dict[str, Any]:
        return tools.prepare_merge(repo())

    @server.tool(description="Orchestrator only: retry reviewed worker integration into the team's isolated branch. Never merges main or pushes.")
    def integrate_team() -> dict[str, Any]:
        return tools.integrate_team(repo())

    @server.tool(
        description=(
            "Orchestrator only: propose a reusable skill for user review; never activates it."
        )
    )
    def propose_skill(
        title: str,
        instruction: str,
        evidence: str,
        scope: list[str] | None = None,
    ) -> dict[str, Any]:
        return tools.propose_skill(repo(), title, instruction, evidence, scope)

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
