"""Domain exceptions raised by the core library.

The API layer maps these to HTTP codes in one handler; the CLI prints them
as human-readable errors. Core never raises framework-specific exceptions.
"""


class ContextGitError(Exception):
    """Base class for all domain errors."""


class RepoNotFound(ContextGitError):
    """No ContextGit repository exists at the given path."""


class RepoAlreadyExists(ContextGitError):
    """A ContextGit repository already exists at the given path."""


class CommitNotFound(ContextGitError):
    """The referenced commit id does not exist in the repository."""


class BranchNotFound(ContextGitError):
    """The referenced branch does not exist."""


class InvalidRefName(ContextGitError):
    """A branch or tag name is not allowed."""


class MergeConflict(ContextGitError):
    """A merge cannot be applied until every conflict is explicitly resolved."""


class StaleMergePreview(ContextGitError):
    """A branch moved after its merge preview was generated."""


class InvalidMergeResolution(ContextGitError):
    """A merge resolution refers to an unknown conflict or invalid choice."""


class SessionNotFound(ContextGitError):
    """The referenced session id does not exist."""


class StagingEmpty(ContextGitError):
    """A commit was requested but the session has no staged messages."""


class MergeQueueEntryNotFound(ContextGitError):
    """The referenced merge-queue entry does not exist."""


class TeamNotFound(ContextGitError):
    """No team exists for the current project."""


class TaskNotFound(ContextGitError):
    """The referenced team task does not exist."""


class TaskCycleError(ContextGitError):
    """Task dependencies form a cycle, so no order can start them."""


class TaskDependencyError(ContextGitError):
    """A task cannot start or finish while its dependencies are unresolved."""


class ScopeConflict(ContextGitError):
    """Two team tasks claim the same files, so the second cannot start."""


class TaskNotReviewable(ContextGitError):
    """A review verdict was given for a task that is not waiting on review."""


class WorkInProgressLimit(ContextGitError):
    """Too many runs are active at once; finish one before starting another."""


class GateNotConfigured(ContextGitError):
    """No quality gate is configured or detectable for this project."""


class ProviderNotFound(ContextGitError):
    """The referenced LLM provider is neither built in nor configured."""


class ProviderConfigError(ContextGitError):
    """A provider is misconfigured (missing key, unsupported base URL, …)."""


class HttpRequestError(ContextGitError):
    """An outbound HTTP request could not be performed or its body parsed."""


class CollectionNotFound(ContextGitError):
    """The referenced API collection does not exist."""


class EndpointNotFound(ContextGitError):
    """The referenced endpoint is not part of the project's current graph."""


class ServerNotRunning(ContextGitError):
    """No server URL is known, so there is nothing to test against."""
