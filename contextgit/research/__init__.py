"""The research engine: deep, competitive, lead and verification runs."""

from contextgit.research.engine import (
    ResearchMode,
    extract_claims,
    run_research,
)
from contextgit.research.fetch import FetchedPage, Fetcher
from contextgit.research.models import (
    Claims,
    ComparisonResult,
    Extraction,
    LeadResult,
    ResearchPlan,
    Source,
    Verdict,
    VerifyResult,
)
from contextgit.research.store import ResearchStore

__all__ = [
    "Claims",
    "ComparisonResult",
    "Extraction",
    "FetchedPage",
    "Fetcher",
    "LeadResult",
    "ResearchMode",
    "ResearchPlan",
    "ResearchStore",
    "Source",
    "Verdict",
    "VerifyResult",
    "extract_claims",
    "run_research",
]
