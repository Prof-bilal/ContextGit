# Chat & research — Round 1: the landscape

> Research for the chat/research backend. Companion: `chat-providers.md` (the
> provider layer and the add-a-provider flow). Verified 2026-10-04.

## What we are building (from the user)

1. **Deep research** — iterative loops with citations.
2. **Lead research** — companies/people, with two readings: a research *sources*
   mode (scrape pages → cite evidence) and a separate *lead* mode (companies,
   contacts, signals).
3. **Competitive / market** research — structured comparison across sources.
4. **Verification pass** — check claims against independent sources.
5. Plus: a **mock-complete provider flow** (add URL + API key, test, fetch
   models) and more providers (`chat-providers.md`).

## Where the repo stands today

- The Chat tab is **fixture-backed**: four modes (`chat`, `council`, `research`,
  `image`) driven by timers over `desktop/src/shell/mock/chat.ts`. `streamChat`
  in `lib/api.ts` exists and is **never called**.
- The backend has a real SSE route (`POST /api/v1/chat/stream`) but a **single
  global provider** chosen once by whether `CTX_LLM_API_KEY` is set
  (`api/app.py:79-81`), with **fake streaming** (a finished string re-chunked,
  `llm/openai_compatible.py:71-75`) and no tools, search or fetch anywhere.
- So "research" today is a UI story with no engine behind it.

## The four research types, and what each actually is

### 1. Deep research (iterative breadth + depth)

Reference implementations agree on the shape, and disagree on little else:

- **open-deep-research** (dzhng): the simplest loop — generate queries, search,
  scrape, extract learnings + follow-up questions, recurse to a depth/breadth
  budget, then synthesise a report. This is the smallest thing that works.
- **GPT-Researcher**: planner → parallel retrievers → scraper → summariser →
  aggregator; strongest at long report writing with inline citations.
- **Stanford STORM**: perspective-guided question asking + simulated
  conversations before writing; best for literature-style surveys.
- **Local Deep Research / Onyx / Khoj**: same skeleton, local models, heavier RAG.

The convergent pipeline:

```
question → plan (sub-questions, perspectives)
         → breadth: N searches per round
         → read: fetch + extract (claim, quote, source, date)
         → gap check: what is still unanswered?
         → depth: follow the gaps (bounded rounds)
         → synthesise a report where every sentence carries [n] citations
```

Cost scales roughly with `breadth × depth × pages`, so the budgets must be
explicit and visible (our GovernorPanel is the right home for that).

**What makes it honest:** a citation that cannot be re-opened is an assertion.
Every claim must carry a source URL *and* the fetched text must be stored, so the
report is reproducible after the page changes.

### 2. Lead research (companies, people, signals)

Two distinct jobs hide under one word:

- **Research sources** — fetch public pages and cite them. No personal data;
  the same evidence discipline as deep research.
- **Sales/contact leads** — companies + contacts + outreach angles. This is
  where the law starts to matter (below).

**The compliant path, in order of preference:**

1. **Official APIs** — Google Places API for business listings (name, address,
   phone, hours, website, rating). Designed for this; no scraping.
2. **Enrichment APIs** — Apollo, Hunter, People Data Labs, Cognism, Clearbit
   (now HubSpot Breeze). Pay per record, provide the lawful basis machinery.
3. **Public web pages** — the company's own site, press pages, job posts (hiring
   signals), public docs. Fetch politely (see guardrails).
4. **Search APIs** — for discovery, not extraction.

**What we should not build:** logged-in scraping of LinkedIn or Google Maps,
bypassing bot protection, or bulk-harvesting personal emails. Legally the picture
is nuanced — *hiQ v. LinkedIn* and *Van Buren* established that scraping
**public** data is not a CFAA crime, but ToS/contract claims, GDPR and CAN-SPAM
still bite, and "public" is not the same as "lawful to process at scale".

**Design consequences:**
- Only unauthenticated, public sources; respect `robots.txt` and rate limits.
- Store the **snapshot**, not just the field, so a human can audit the basis.
- Keep personal data minimal, and never invent an email — infer a pattern only
  when the API returns it.
- Make export deliberate (CSV/JSON) so the human remains the decision-maker.

### 3. Competitive / market research

Same pipeline as deep research with a **fixed output shape**: a comparison matrix
(rows = competitors, columns = pricing, positioning, key features, target,
weaknesses) plus a short SWOT per row and a "how we differ" paragraph. The
discipline is in the schema — the model fills a table, not prose, and every cell
carries at least one source. This is the cheapest type to make reliable because
the schema constrains the answer.

### 4. Verification pass

Take the claims already produced (in a branch's commits) and, for each: find an
independent source, mark **supported / contradicted / unverifiable**, and record
what the contradiction says. This is the same instinct as our team-mode
**verifier role** and the existing cross-run semantic conflict detection — here it
applies to research output instead of code.

## The fetch layer (what does the reading)

| Option | What it gives | Cost / caveat |
|---|---|---|
| Plain HTTP + readability extraction | Cheap, fine for static pages | Dies on JS-heavy sites |
| **Jina Reader** (`r.jina.ai`) | URL → clean markdown | External service, rate limits |
| **Firecrawl** | Crawl + JS + markdown, structured extract | Paid API |
| **Crawl4AI** | Self-hosted crawl → markdown, LLM-ready | Runs locally (Playwright) |
| **Browser Use / Playwright** | Full browser control for hard pages | Heaviest; needs a sandbox |

Our repo already ships **Playwright** (for the desktop e2e) and Electron, so a
local fetch is feasible; the pragmatic ladder is: plain fetch → readability →
(headless browser only when needed) → optional paid crawler for scale. Ships with
a per-domain cache so the same URL is fetched once and the snapshot is stored for
citations.

## Ten rules this research lands on

1. **Citations or it didn't happen** — every claim carries source id + URL + quote.
2. **Store the snapshot** — the evidence is versioned, not re-fetched.
3. **Budget explicitly** — breadth, depth, page count and tokens are visible.
4. **Schema over prose** — competitive tables, lead records and verification
   verdicts are structured objects, not paragraphs.
5. **Public sources only** — no logged-in scraping, respect robots/ToS.
6. **Enrichment over inference** — an API-returned field beats a guessed one.
7. **Human in the loop for outreach** — we prepare, the human sends.
8. **Reuse the repo's grain** — a research run is a branch of commits; the report
   and its sources land as artefacts that can be diffed and merged.
9. **One engine, four presents** — deep / lead / competitive / verify differ in
   prompt + schema + tool set, not in architecture.
10. **Say what is mock** — the UI keeps the "sample data" chip until the engine
    behind a mode is real.

## Sources

- [Open Deep Research (dzhng)](https://github.com/dzhng/deep-research)
- [Four open-source deep research agents, tested honestly](https://www.digitalapplied.com/blog/open-source-deep-research-agents-2026-guide)
- [GPT Researcher vs STORM compared](https://inferensys.com/differences/context-engineering-and-retrieval-ranking-platforms/multi-hop-reasoning-engines/gpt-researcher-vs-storm)
- [Self-hosted deep research systems: 12 tools compared](https://www.glukhov.org/ai-systems/comparisons/deep-research-with-ai/)
- [Is scraping Google Maps legal in 2026 (ToS, GDPR, CAN-SPAM)](https://www.leadoutreach.co/blog/is-scraping-google-maps-legal)
- [Is scraping LinkedIn legal in 2026 (hiQ, ToS, public data)](https://apiserpent.com/blog/is-scraping-linkedin-legal-2026)
- [Best AI agent for web scraping 2026 (Firecrawl, Crawl4AI, Browser Use, Apify)](https://techiehub.blog/best-ai-agent-for-web-scraping/)
- [Enrichment APIs compared, 2026](https://domainenrich.com/resources/enrichment-apis-compared-2026)
- [Apollo vs Clearbit (HubSpot Breeze) 2026](https://www.enrich.so/blog/apollo-vs-clearbit)
