"""Run the local workbench API server."""

import ipaddress
import os

import uvicorn


def main() -> None:
    """Start the server; repository path is controlled by CONTEXTGIT_REPO."""
    host = os.getenv("CONTEXTGIT_HOST", "127.0.0.1")
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host in {"localhost", "ip6-localhost"}
    if not loopback and not os.getenv("CONTEXTGIT_API_TOKEN"):
        raise SystemExit("Refusing non-loopback API binding without CONTEXTGIT_API_TOKEN")
    uvicorn.run(
        "contextgit.api.main:app",
        host=host,
        port=int(os.getenv("CONTEXTGIT_PORT", "8000")),
        reload=False,
    )
