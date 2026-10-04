"""`contextgit-mcp` entry point: the team tools over MCP stdio."""

from __future__ import annotations

import argparse
import os

from contextgit.mcp.server import run


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="contextgit-mcp", description="ContextGit team tools over MCP (stdio)"
    )
    parser.add_argument(
        "--repo",
        default=os.getenv("CONTEXTGIT_REPO"),
        help="ContextGit repository path (defaults to $CONTEXTGIT_REPO)",
    )
    args = parser.parse_args()
    run(args.repo)


if __name__ == "__main__":  # `python -m contextgit.mcp.main`
    main()
