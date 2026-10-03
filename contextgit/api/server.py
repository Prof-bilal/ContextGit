"""Run the local workbench API server."""

import os

import uvicorn


def main() -> None:
    """Start the server; repository path is controlled by CONTEXTGIT_REPO."""
    uvicorn.run(
        "contextgit.api.main:app",
        host=os.getenv("CONTEXTGIT_HOST", "127.0.0.1"),
        port=int(os.getenv("CONTEXTGIT_PORT", "8000")),
        reload=False,
    )
