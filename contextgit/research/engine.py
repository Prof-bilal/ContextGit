"""One engine, four presents: deep, competitive, lead, verify.

The difference between the research types is the prompt and the output schema,
not the architecture: plan → search → read → (gap check) → present. Every run
yields visible step events so the UI can show the process, and every claim it
keeps carries a source id.
"""

import json
from collections.abc import AsyncIterator
from functools import partial
from importlib import resources
from typing import Literal, TypeVar
from urllib.parse import urlparse

import anyio
from pydantic import BaseModel

from contextgit.core.models import Message, utcnow
from contextgit.llm.base import AsyncLLMProvider, LLMProvider
from contextgit.llm.search import SearchBackend, SearchResult
from contextgit.research.fetch import Fetcher
from contextgit.research.models import (
    Claims,
    ComparisonResult,
    Extraction,
    LeadResult,
    ResearchPlan,
    Source,
    VerifyResult,
)
from contextgit.research.store import ResearchStore

ResearchMode = Literal["deep", "competitive", "lead", "verify"]

# (event name, payload) pairs the route maps straight onto SSE events.
Event = tuple[str, dict[str, object]]

T = TypeVar("T", bound=BaseModel)

_STRUCTURED: dict[str, type[BaseModel]] = {
    "competitive": ComparisonResult,
    "lead": LeadResult,
    "verify": VerifyResult,
}


def _prompt(name: str) -> str:
    return (
        resources.files("contextgit.research") / "prompts" / f"v1_{name}.txt"
    ).read_text("utf-8")


def _strip_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        return "\n".join(lines[1:-1]).strip()
    return stripped


async def _structured(
    provider: LLMProvider, prompt_name: str, payload: dict[str, object], schema: type[T]
) -> T:
    """One validated structured call, retried once with the error appended."""
    messages = [
        Message(role="system", content=_prompt(prompt_name)),
        Message(role="user", content=json.dumps(payload, ensure_ascii=False)),
    ]
    for attempt in range(2):
        call = partial(
            provider.complete, messages, response_format={"type": "json_object"}
        )
        try:
            raw = await anyio.to_thread.run_sync(call)
        except Exception:
            break
        try:
            return schema.model_validate_json(_strip_fence(raw))
        except ValueError as exc:
            if attempt == 1:
                break
            messages.extend(
                [
                    Message(role="assistant", content=raw),
                    Message(
                        role="user",
                        content=(
                            f"The JSON did not match the schema: {exc}. "
                            "Return corrected JSON only."
                        ),
                    ),
                ]
            )
    return schema()


async def _search(search: SearchBackend, query: str, max_results: int) -> list[SearchResult]:
    call = partial(search.search, query, max_results=max_results)
    try:
        return await anyio.to_thread.run_sync(call)
    except Exception:
        return []


async def _stream_report(
    provider: LLMProvider, payload: dict[str, object]
) -> AsyncIterator[str]:
    messages = [
        Message(role="system", content=_prompt("report")),
        Message(role="user", content=json.dumps(payload, ensure_ascii=False)),
    ]
    if isinstance(provider, AsyncLLMProvider):
        async for chunk in provider.astream(messages):
            yield chunk
        return
    call = partial(provider.complete, messages)
    yield await anyio.to_thread.run_sync(call)


def _render_artifact(mode: str, result: BaseModel, sources: list[Source]) -> str:
    """A markdown rendition of a structured result, so it can be committed."""
    lines: list[str] = []
    if mode == "competitive" and isinstance(result, ComparisonResult):
        if result.rows:
            lines.append(
                "| Competitor | Pricing | Positioning | Features | Target | Weaknesses | Sources |"
            )
            lines.append("|---|---|---|---|---|---|---|")
            for row in result.rows:
                sources_cell = ", ".join(f"[{sid}]" for sid in row.sources)
                lines.append(
                    f"| {row.competitor} | {row.pricing} | {row.positioning} | "
                    f"{'; '.join(row.features)} | {row.target} | "
                    f"{'; '.join(row.weaknesses)} | {sources_cell} |"
                )
        if result.how_we_differ:
            lines.append("")
            lines.append(f"**How we differ:** {result.how_we_differ}")
    elif mode == "lead" and isinstance(result, LeadResult):
        lines.append(f"# {result.name}")
        if result.website:
            lines.append(result.website)
        if result.description:
            lines.append(result.description)
        for signal in result.signals:
            cite = f" [{signal.source_id}]" if signal.source_id else ""
            lines.append(f"- **{signal.kind}:** {signal.detail}{cite}")
    elif mode == "verify" and isinstance(result, VerifyResult):
        lines.append("| Claim | Verdict | Evidence | Source |")
        lines.append("|---|---|---|---|")
        for verdict in result.verdicts:
            cite = f"[{verdict.source_id}]" if verdict.source_id else ""
            lines.append(
                f"| {verdict.claim} | {verdict.verdict} | {verdict.evidence} | {cite} |"
            )
    if sources:
        lines.append("")
        lines.append("## Sources")
        for source in sources:
            lines.append(f"- [{source.id}] {source.title} — {source.url}")
    return "\n".join(lines)


async def run_research(
    mode: ResearchMode,
    question: str,
    *,
    provider: LLMProvider,
    search: SearchBackend,
    fetcher: Fetcher | None = None,
    breadth: int = 3,
    depth: int = 2,
    max_pages: int = 6,
    claims: list[str] | None = None,
    store: ResearchStore | None = None,
    run_id: str | None = None,
) -> AsyncIterator[Event]:
    """Run the loop and yield (event, payload) pairs."""
    sources: list[Source] = []
    by_url: dict[str, int] = {}
    pages: dict[str, str] = {}
    evidence: list[str] = []
    read_urls: set[str] = set()

    def register(title: str, url: str) -> Source:
        if url in by_url:
            return sources[by_url[url] - 1]
        source = Source(
            id=len(sources) + 1,
            title=title or url,
            url=url,
            host=urlparse(url).netloc,
            fetched_at=utcnow().isoformat(),
        )
        sources.append(source)
        by_url[url] = source.id
        return source

    yield (
        "step",
        {"id": "plan", "label": "Plan", "detail": f"{mode} · planning", "status": "active"},
    )
    if mode == "verify":
        seed = claims if claims else [question]
    else:
        plan = await _structured(
            provider, "plan", {"task": "plan", "question": question}, ResearchPlan
        )
        seed = plan.sub_questions or [question]
    yield (
        "step",
        {"id": "plan", "label": "Plan", "detail": f"{len(seed)} question(s)", "status": "done"},
    )

    queries = seed
    pages_read = 0
    for round_index in range(max(1, depth)):
        yield (
            "step",
            {
                "id": f"round-{round_index}",
                "label": "Search",
                "detail": f"round {round_index + 1}: {len(queries)} queries",
                "status": "active",
            },
        )
        new_hits: list[SearchResult] = []
        for query in queries[: max(1, breadth)]:
            for hit in await _search(search, query, 5):
                if hit.url and hit.url not in read_urls:
                    read_urls.add(hit.url)
                    new_hits.append(hit)
        remaining = max(0, max_pages - pages_read)
        for hit in new_hits[:remaining]:
            source = register(hit.title, hit.url)
            yield ("source", source.model_dump(mode="json"))
            content = hit.content
            if not content and fetcher is not None:
                page = await fetcher.fetch(hit.url)
                if page is not None:
                    content = page.text
                    if page.title:
                        source.title = page.title
            if content:
                pages[hit.url] = content
                evidence.append(f"[{source.id}] {source.title} — {source.url}\n{content[:1800]}")
            pages_read += 1
        yield (
            "step",
            {
                "id": f"round-{round_index}",
                "label": "Read",
                "detail": f"{len(evidence)} source(s) kept",
                "status": "done",
            },
        )
        if mode != "deep" or pages_read >= max_pages:
            break
        extraction = await _structured(
            provider,
            "extract",
            {"task": "extract", "question": question, "sources": evidence[-6:]},
            Extraction,
        )
        if not extraction.follow_up_questions:
            break
        queries = extraction.follow_up_questions

    yield (
        "step",
        {
            "id": "synth",
            "label": "Synthesize",
            "detail": "writing the artifact",
            "status": "active",
        },
    )
    sources_json = [source.model_dump(mode="json") for source in sources]
    if mode == "deep":
        collected: list[str] = []
        async for chunk in _stream_report(
            provider, {"task": "report", "question": question, "sources": evidence}
        ):
            collected.append(chunk)
            yield ("report", {"text": chunk})
        artifact = "".join(collected)
    else:
        prompt_name = "compare" if mode == "competitive" else mode
        schema_class = _STRUCTURED[mode]
        result = await _structured(
            provider,
            prompt_name,
            {
                "task": prompt_name,
                "question": question,
                "sources": evidence,
                "claims": claims or [],
            },
            schema_class,
        )
        yield ("result", {"mode": mode, **result.model_dump(mode="json")})
        artifact = _render_artifact(mode, result, sources)
    yield ("step", {"id": "synth", "label": "Synthesize", "detail": "done", "status": "done"})
    if store is not None and run_id is not None:
        store.save_run(
            run_id,
            mode=mode,
            question=question,
            plan=seed,
            queries=seed,
            sources=sources_json,
            pages=pages,
        )
    yield (
        "done",
        {
            "artifact": artifact,
            "sources": sources_json,
            "question": question,
            "mode": mode,
        },
    )


async def extract_claims(
    provider: LLMProvider, context: str
) -> list[str]:
    """Pull checkable claims from a branch's context (for a verification pass)."""
    result = await _structured(provider, "claims", {"task": "claims", "context": context}, Claims)
    return result.claims
