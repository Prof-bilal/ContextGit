"""Uvicorn entrypoint: `uvicorn contextgit.api.main:app --reload`."""

import os
import secrets

# A standalone server must never silently expose an unauthenticated control
# plane. The browser launcher supplies its own token; CLI/uvicorn launches get one here.
if not os.getenv("CONTEXTGIT_API_TOKEN"):
    token = secrets.token_urlsafe(32)
    os.environ["CONTEXTGIT_API_TOKEN"] = token
    print(f"ContextGit API token: {token}", flush=True)

if os.getenv("CONTEXTGIT_DESKTOP_PROJECTS") == "1":
    from contextgit.api.projects import create_desktop_app
    app = create_desktop_app(os.environ["CONTEXTGIT_API_TOKEN"])
else:
    from contextgit.api.app import app

__all__ = ["app"]
