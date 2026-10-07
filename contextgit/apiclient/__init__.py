"""The HTTP client behind the API tab (a local Postman-style panel)."""

from contextgit.apiclient.client import send_request
from contextgit.apiclient.store import CollectionStore

__all__ = ["send_request", "CollectionStore"]
