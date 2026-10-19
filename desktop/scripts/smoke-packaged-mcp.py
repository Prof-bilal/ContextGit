"""Run a real MCP handshake against the packaged backend in an isolated repository."""

import asyncio
import os
import tempfile
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from contextgit.core.repo import Repo


async def check() -> None:
    name = "contextgit-api.exe" if os.name == "nt" else "contextgit-api"
    binary = Path(__file__).resolve().parents[1] / "build" / "backend" / name
    with tempfile.TemporaryDirectory(prefix="contextgit-packaged-mcp-") as directory:
        repo = Repo.init(Path(directory) / "store")
        team = repo.create_team("Packaged team", project_path=directory)
        repo._storage.close()
        params = StdioServerParameters(
            command=str(binary),
            args=["--mcp", "--repo", str(Path(directory) / "store")],
            env={**os.environ, "CONTEXTGIT_TEAM": team.id, "CONTEXTGIT_ROLE": "orchestrator"},
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listing = await session.list_tools()
                names = {tool.name for tool in listing.tools}
                assert {
                    "propose_team_plan",
                    "review_task",
                    "prepare_merge",
                    "propose_skill",
                } <= names
                result = await session.call_tool("team_status", {})
                assert not result.is_error
                assert "Packaged team" in str(result)
                assert "confirm_merge" not in names
                print(f"Packaged MCP handshake passed: {len(names)} tools; team status available.")


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(check(), timeout=45))
