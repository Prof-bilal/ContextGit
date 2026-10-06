"""House styles for generated documents: the few templates the user can pick.

One definition drives every renderer (HTML/CSS, reportlab, Word, PowerPoint), so
a "Report" looks like a report in all four formats.
"""

from dataclasses import dataclass

from contextgit.documents.models import DocumentTemplate


@dataclass(frozen=True)
class Style:
    name: DocumentTemplate
    label: str
    body_font: str
    heading_font: str
    mono_font: str
    accent: str
    ink: str
    muted: str
    rule: str
    base_size: str = "10.5pt"
    number_sections: bool = False
    cover: str = "full"  # "full" | "compact"


_REPORT = Style(
    name="report",
    label="Report",
    body_font="Georgia, 'Times New Roman', Times, serif",
    heading_font="'Helvetica Neue', Helvetica, Arial, sans-serif",
    mono_font="'DejaVu Sans Mono', 'SFMono-Regular', Consolas, monospace",
    accent="#1f3a5f",
    ink="#1b1b1b",
    muted="#5c6470",
    rule="#d7d2c8",
    number_sections=True,
    cover="full",
)

_BRIEF = Style(
    name="brief",
    label="Brief",
    body_font="'Helvetica Neue', Helvetica, Arial, sans-serif",
    heading_font="'Helvetica Neue', Helvetica, Arial, sans-serif",
    mono_font="'DejaVu Sans Mono', 'SFMono-Regular', Consolas, monospace",
    accent="#0b6b5b",
    ink="#1c1f24",
    muted="#606a75",
    rule="#d8dbdd",
    base_size="10pt",
    number_sections=False,
    cover="compact",
)

_PROPOSAL = Style(
    name="proposal",
    label="Proposal",
    body_font="Georgia, 'Times New Roman', Times, serif",
    heading_font="'Helvetica Neue', Helvetica, Arial, sans-serif",
    mono_font="'DejaVu Sans Mono', 'SFMono-Regular', Consolas, monospace",
    accent="#b3480f",
    ink="#1e1a17",
    muted="#6a6058",
    rule="#e3d6cb",
    number_sections=True,
    cover="full",
)

STYLES: dict[DocumentTemplate, Style] = {
    "report": _REPORT,
    "brief": _BRIEF,
    "proposal": _PROPOSAL,
}


def style_for(template: DocumentTemplate | str) -> Style:
    """The style for a template name, defaulting to Report."""
    return STYLES.get(template, _REPORT)  # type: ignore[arg-type]
