"""The reading layer: fetch a URL and turn it into text, politely.

Plain HTTP + a small HTML extractor (no extra dependency), with a per-domain
delay and a robots.txt check. JS-heavy pages may extract poorly; that is a known
limit, not a silent failure — the caller simply gets less text.
"""

import asyncio
import time
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from pydantic import BaseModel

_USER_AGENT = "ContextGit-Research/0.1 (+local research tool)"
_SKIP = {
    "script", "style", "noscript", "template", "svg", "nav",
    "footer", "header", "form", "aside",
}
_BLOCK = {
    "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "pre", "blockquote",
}


class FetchedPage(BaseModel):
    """The text we actually read, kept as the citation snapshot."""

    url: str
    title: str
    text: str


class _Extractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._title: list[str] = []
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag in _BLOCK:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP and self._skip > 0:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if not text:
            return
        if self._in_title:
            self._title.append(text)
        elif self._skip == 0:
            self._parts.append(text)

    @property
    def title(self) -> str:
        return " ".join(self._title).strip()

    @property
    def text(self) -> str:
        collapsed = " ".join(self._parts)
        lines = [" ".join(line.split()) for line in collapsed.split("\n")]
        return "\n".join(line for line in lines if line)


def extract(html: str) -> tuple[str, str]:
    """Return (title, text) from an HTML document."""
    parser = _Extractor()
    parser.feed(html)
    return parser.title, parser.text


class Fetcher:
    """Fetch and extract pages, caching the snapshot and honouring robots.txt."""

    def __init__(
        self,
        *,
        timeout: float = 15.0,
        max_chars: int = 20_000,
        max_bytes: int = 400_000,
        domain_delay: float = 0.5,
    ) -> None:
        self.timeout = timeout
        self.max_chars = max_chars
        self.max_bytes = max_bytes
        self.domain_delay = domain_delay
        self._cache: dict[str, FetchedPage] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self._last: dict[str, float] = {}

    async def fetch(self, url: str) -> FetchedPage | None:
        if url in self._cache:
            return self._cache[url]
        domain = urlparse(url).netloc
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                if not await self._allowed(client, url):
                    return None
                wait = self.domain_delay - (time.monotonic() - self._last.get(domain, 0.0))
                if wait > 0:
                    await asyncio.sleep(wait)
                response = await client.get(
                    url, headers={"User-Agent": _USER_AGENT, "Accept": "text/html,*/*"}
                )
                self._last[domain] = time.monotonic()
                response.raise_for_status()
                if "text" not in response.headers.get("content-type", "") and "html" not in (
                    response.headers.get("content-type", "")
                ):
                    return None
                html = response.text[: self.max_bytes]
        except Exception:
            return None
        title, text = extract(html)
        page = FetchedPage(url=url, title=title or url, text=text[: self.max_chars])
        self._cache[url] = page
        return page

    async def _allowed(self, client: httpx.AsyncClient, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._robots:
            robots: RobotFileParser | None = None
            try:
                response = await client.get(
                    f"{origin}/robots.txt", headers={"User-Agent": _USER_AGENT}
                )
                rules_parser = RobotFileParser()
                rules_parser.parse(
                    response.text.splitlines() if response.status_code == 200 else []
                )
                robots = rules_parser
            except Exception:
                robots = None
            self._robots[origin] = robots
        rules = self._robots[origin]
        return True if rules is None else rules.can_fetch(_USER_AGENT, url)
