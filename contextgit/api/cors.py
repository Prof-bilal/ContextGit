"""CORS outside the error boundary, including unhandled server errors."""

import os

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp


class LocalAPI(FastAPI):
    def build_middleware_stack(self) -> ASGIApp:
        return CORSMiddleware(
            super().build_middleware_stack(),
            allow_origins=[
                origin.strip()
                for origin in os.getenv(
                    "CONTEXTGIT_CORS_ORIGINS",
                    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
                ).split(",")
                if origin.strip()
            ],
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization", "X-ContextGit-Repo"],
        )
