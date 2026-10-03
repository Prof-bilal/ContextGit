"""Domain errors for git worktree operations (mirrors core/errors.py style)."""

from contextgit.core.errors import ContextGitError


class GitCommandError(ContextGitError):
    """A git subprocess failed or git is unavailable."""


class NotAGitRepo(ContextGitError):
    """The project folder is not inside a git working tree."""


class WorktreeExists(ContextGitError):
    """A worktree already exists at the target path."""


class WorktreeNotFound(ContextGitError):
    """No worktree is registered for the given name."""


class DirtyWorktree(ContextGitError):
    """A worktree has uncommitted work that removal would delete."""
