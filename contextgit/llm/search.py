"""Web-search backends for the research engine.

`TavilySearch` is the real one (purpose-built for LLM research); `MockSearch`
returns a deterministic corpus so the whole research pipeline is runnable and
testable with no network or key.
"""

import hashlib
import time
from typing import Protocol

import httpx
from pydantic import BaseModel

from contextgit.llm.http_error import ProviderHTTPError, describe_response, retryable


class SearchResult(BaseModel):
    """One search hit; `content` is the page text when the backend provides it."""

    title: str
    url: str
    snippet: str = ""
    content: str | None = None


class SearchBackend(Protocol):
    """The only interface the research engine uses to find pages."""

    def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        """Return up to `max_results` hits for a query."""
        ...


class TavilySearch:
    """Tavily Search API (https://docs.tavily.com)."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "https://api.tavily.com",
        timeout: float = 30.0,
        retries: int = 2,
    ) -> None:
        self.api_key = api_key or ""
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = max(0, retries)

    def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        body = {
            "api_key": self.api_key,
            "query": query,
            "max_results": max(1, min(max_results, 20)),
            "search_depth": "basic",
            "include_answer": False,
        }
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(f"{self.base_url}/search", json=body)
                    if response.status_code >= 400:
                        raise ProviderHTTPError(
                            response.status_code, describe_response(response)
                        )
                    data = response.json()
                if isinstance(data, dict) and data.get("error"):
                    raise ProviderHTTPError(
                        200,
                        str(data["error"])
                        if not isinstance(data["error"], dict)
                        else str(data["error"].get("message", data["error"])),
                    )
                results: list[SearchResult] = []
                for entry in data.get("results", []):
                    content = entry.get("raw_content") or entry.get("content") or ""
                    results.append(
                        SearchResult(
                            title=str(entry.get("title", "")),
                            url=str(entry.get("url", "")),
                            snippet=str(entry.get("content", ""))[:500],
                            content=str(content) or None,
                        )
                    )
                return results
            except Exception as exc:
                last = exc
                if not retryable(exc) or attempt == self.retries:
                    break
                time.sleep(min(0.25 * (2**attempt), 2.0))
        raise RuntimeError(f"search failed: {last}") from last


class MockSearch:
    """Deterministic, offline search: stable URLs and text per query."""

    def __init__(self, results_per_query: int = 4) -> None:
        self.results_per_query = results_per_query

    def search(self, query: str, *, max_results: int = 5) -> list[SearchResult]:
        count = min(max_results, self.results_per_query)
        digest = hashlib.sha1(query.encode("utf-8")).hexdigest()[:10]
        return [self._result(query, digest, index) for index in range(count)]

    @staticmethod
    def _result(query: str, digest: str, index: int) -> SearchResult:
        slug = "-".join(query.lower().split())[:40] or "topic"
        url = f"https://example.com/{slug}/{digest}-{index}"
        title = f"{query} — source {index + 1}"
        body = (
            f"{title}. This offline mock source discusses {query}. "
            f"Point {index + 1}: {query} is best understood by separating the durable "
            f"parts from the incidental ones. Evidence item {index + 1} notes that the "
            f"trade-offs around {query} change once a second instance or a second vendor "
            f"is involved. Mock marker {digest}."
        )
        return SearchResult(title=title, url=url, snippet=body[:200], content=body)
