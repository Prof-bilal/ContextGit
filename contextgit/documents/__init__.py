"""Chat "Document" mode: generate a file (md/pdf/docx/pptx) on a topic."""

from contextgit.documents.errors import INSTALL_HINT, MissingRenderer
from contextgit.documents.generate import build_document, document_prompt
from contextgit.documents.markdown import parse_markdown
from contextgit.documents.models import (
    DOCUMENT_EXTENSIONS,
    Block,
    DocumentContent,
    DocumentFormat,
    DocumentInfo,
    DocumentTemplate,
    RenderedDocument,
    Slide,
)
from contextgit.documents.render import available, render
from contextgit.documents.store import (
    documents_dir,
    filename_for,
    list_documents,
    metadata_for,
    path_for,
    save,
)

__all__ = [
    "DOCUMENT_EXTENSIONS",
    "INSTALL_HINT",
    "Block",
    "DocumentContent",
    "DocumentFormat",
    "DocumentInfo",
    "DocumentTemplate",
    "MissingRenderer",
    "RenderedDocument",
    "Slide",
    "available",
    "build_document",
    "document_prompt",
    "documents_dir",
    "filename_for",
    "list_documents",
    "metadata_for",
    "parse_markdown",
    "path_for",
    "render",
    "save",
]
