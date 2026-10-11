# Merge Engine

The hardest and most important part of the project. Conversations do not merge line by line.

## Diff
Compare two contexts at three levels:
1. **Message diff:** messages present in one but not the other (from the common ancestor).
2. **Semantic diff (LLM):** decisions, facts, instructions, and open questions added/removed.
3. **Token diff:** token cost difference.

## Merge algorithm
1. Find the common ancestor.
2. Collect commits on the source branch since the ancestor.
3. LLM extracts: **decisions**, **facts established**, **dead ends** (what failed and why), **open questions**.
4. Detect conflicts against the target branch (contradictory decisions or facts).
5. Produce a compact **merge summary**; show preview to the user.
6. On approval, create a merge commit with two parents and the summary as its message.

## Conflicts
A conflict = source and target hold contradictory decisions/facts. The user resolves by choosing one side, or editing the summary. Never auto-resolve silently.

## Quality measurement
Ask a fixed set of probe questions before and after the merge. Compare answers for retained facts. Track this as an eval in `tests/evals/`.

## Prompts
Merge prompts live in `merge/prompts/` as versioned text files, not inline strings. Output must be structured JSON validated with Pydantic.
