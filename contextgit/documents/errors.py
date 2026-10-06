"""Shared errors for the document renderers."""

INSTALL_HINT = "Document support isn't installed. Run: pip install 'contextgit[export]'"


class MissingRenderer(RuntimeError):
    """The library needed for a format is not installed."""
