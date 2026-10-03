"""Uvicorn entrypoint: `uvicorn contextgit.api.main:app --reload`."""

from contextgit.api.app import app

__all__ = ["app"]
