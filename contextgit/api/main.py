"""Uvicorn entrypoint: `uvicorn contextgit.api.main:app --reload`."""

import os
import secrets

# A standalone server must never silently expose an unauthenticated control
# plane. Electron supplies its own token; CLI/uvicorn launches get one here.
if not os.getenv("CONTEXTGIT_API_TOKEN"):
    token = secrets.token_urlsafe(32)
    os.environ["CONTEXTGIT_API_TOKEN"] = token
    print(f"ContextGit API token: {token}", flush=True)

from contextgit.api.app import app

__all__ = ["app"]
