"""Persist a research run's snapshots so its citations stay reproducible.

The report lands as a commit on the branch; the raw material (plan, queries,
sources, fetched page text) lands here, keyed by run id, so a page that changes
later does not invalidate the evidence the report was written from.
"""

import hashlib
import json
from pathlib import Path


class ResearchStore:
    """Write run artifacts under `<repo root>/research/<run_id>/`."""

    def __init__(self, root: Path | str) -> None:
        self._root = Path(root) / "research"

    @property
    def root(self) -> Path:
        return self._root

    def save_run(
        self,
        run_id: str,
        *,
        mode: str,
        question: str,
        plan: object,
        queries: list[str],
        sources: list[dict[str, object]],
        pages: dict[str, str],
    ) -> Path:
        """Write the manifest and each fetched page; return the run directory."""
        run_dir = self._root / run_id
        pages_dir = run_dir / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "run_id": run_id,
            "mode": mode,
            "question": question,
            "plan": plan,
            "queries": queries,
            "sources": sources,
        }
        (run_dir / "run.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        for url, text in pages.items():
            name = hashlib.sha1(url.encode()).hexdigest()[:16] + ".txt"
            (pages_dir / name).write_text(f"{url}\n\n{text}", encoding="utf-8")
        return run_dir
