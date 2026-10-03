"""Pure helpers for comparing commit DAGs and estimating branch deltas."""

from collections import deque
from collections.abc import Callable

from contextgit.core.errors import CommitNotFound
from contextgit.core.models import Commit, Message
from contextgit.merge.models import Diff

CommitLookup = Callable[[str], Commit]


def ancestors(commit_id: str, get_commit: CommitLookup) -> dict[str, int]:
    """Return every reachable ancestor and its shortest parent-edge distance."""
    distances = {commit_id: 0}
    pending = deque([commit_id])
    while pending:
        current = pending.popleft()
        commit = get_commit(current)
        for parent_id in commit.parent_ids:
            distance = distances[current] + 1
            if parent_id not in distances or distance < distances[parent_id]:
                distances[parent_id] = distance
                pending.append(parent_id)
    return distances


def common_ancestor(a_id: str, b_id: str, get_commit: CommitLookup) -> str:
    """Find the closest shared ancestor, minimizing combined graph distance."""
    a_ancestors = ancestors(a_id, get_commit)
    b_ancestors = ancestors(b_id, get_commit)
    shared = a_ancestors.keys() & b_ancestors.keys()
    if not shared:
        raise CommitNotFound("the commits have no common ancestor")
    return min(
        shared,
        key=lambda cid: (
            a_ancestors[cid] + b_ancestors[cid],
            max(a_ancestors[cid], b_ancestors[cid]),
            cid,
        ),
    )


def commits_since(head_id: str, ancestor_id: str, get_commit: CommitLookup) -> list[Commit]:
    """Collect unique commits after ancestor in parent-before-child order."""
    ordered: list[Commit] = []
    visited: set[str] = set()
    active: set[str] = set()

    def visit(commit_id: str) -> None:
        if commit_id == ancestor_id or commit_id in visited:
            return
        if commit_id in active:
            return
        active.add(commit_id)
        commit = get_commit(commit_id)
        for parent_id in commit.parent_ids:
            visit(parent_id)
        active.remove(commit_id)
        visited.add(commit_id)
        ordered.append(commit)

    visit(head_id)
    if ancestor_id not in ancestors(head_id, get_commit):
        raise CommitNotFound(f"{ancestor_id[:12]} is not an ancestor of {head_id[:12]}")
    return ordered


def messages_since(head_id: str, ancestor_id: str, get_commit: CommitLookup) -> list[Message]:
    """Flatten messages added after an ancestor in stable parent-first order."""
    return [
        message
        for commit in commits_since(head_id, ancestor_id, get_commit)
        for message in commit.messages
    ]


def estimate_tokens(messages: list[Message]) -> int:
    """Estimate tokens with the repository's documented four-characters heuristic."""
    text = "\n".join(message.content for message in messages)
    return (len(text) + 3) // 4


def diff(a_id: str, b_id: str, get_commit: CommitLookup) -> Diff:
    """Compare messages and estimated token cost on both sides of their LCA."""
    ancestor_id = common_ancestor(a_id, b_id, get_commit)
    a_messages = messages_since(a_id, ancestor_id, get_commit)
    b_messages = messages_since(b_id, ancestor_id, get_commit)
    return Diff(
        ancestor_id=ancestor_id,
        a_id=a_id,
        b_id=b_id,
        a_messages=a_messages,
        b_messages=b_messages,
        a_token_count=estimate_tokens(a_messages),
        b_token_count=estimate_tokens(b_messages),
    )
