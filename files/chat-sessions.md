# Chat tab: conversations as sessions

The Chat tab's "conversations" are real, isolated sessions with on-demand commit
and a pending-changes diff space. This doc covers the model, the staging flow,
and the rail.

## A conversation = branch + chat session

| Piece | What it is |
|---|---|
| **Branch** | The conversation's history. Created as `<mode>/<label or timestamp>` (e.g. `council/auth-refactor`). |
| **Chat session** | A `Session{kind:"chat"}` bound to that branch. It owns the **staging buffer** (uncommitted turns) and `auto_commit=false`. |

`New conversation` (`desktop/src/shell/chat/NewConversationDialog.tsx` → `Shell.createConversation`):

1. Creates the branch **forked from the repo root**, so `Repo.build_context` never
   replays another conversation's messages — the conversation starts empty.
2. Creates the chat session bound to it (`kind:"chat"`, `auto_commit:false`).
3. Optionally **imports a summary** from another conversation: one `system`
   commit containing that conversation's commit summaries.

The rail (`desktop/src/shell/rail/ChatRail.tsx`) lists conversations with a
**mode badge** (Chat / Council / Research / Image, from the branch prefix), a
**pending** count, and a **delete** button (protected on the current branch and
`main`). A filter row shows one type at a time. Deleting removes the branch
pointer and the chat session — every commit survives.

A row appears only for a branch that **is** a conversation: one bound to a chat
session, or one carrying a conversation prefix. Code branches (runs, worktrees,
plain git branches) are never listed — they inherit the messages of the history
they forked from, so "has messages" (or being the current branch) does not make
one a conversation.

## Commit on demand (staging)

Turns are **staged, not committed**. The Chat tab passes `session_id` +
`auto_commit:false` for every mode, and the backend stages instead of committing:

| Mode | Endpoint | Staged turn |
|---|---|---|
| Chat | `POST /api/v1/chat/stream` | the `[user, assistant]` pair |
| Council | *(no server persistence)* | "Keep this" → `POST /sessions/{id}/staging` |
| Research | `POST /api/v1/research/stream` | `[user, artifact]` |
| Image | `POST /api/v1/images/stream` | `[user, "[image] …"]` (kind `note`) |

Because committed history alone would hide staged turns from the model, the
stream endpoints append the session's staged messages to the request context
(`Repo.staged`) — a conversation reads correctly before it is committed.

`Repo.commit_staged` lands the buffer on the conversation's branch and clears it.

## The diff space

`desktop/src/shell/chat/PendingChanges.tsx`, in the Chat dock, is the **pending
diff**: every staged message as a `+`-line with its role and content (the same
`.cg-diff` presentation as `DiffSheet`), a token estimate, and **Commit** /
**Undo last** / **Clear**. It works for all four modes because staged content is
uniform `{role, content}` (a kept answer, a research artifact, an image prompt).

Clicking a committed turn still opens `DiffSheet` for the committed diff.

## Frontend wiring

- `Shell` builds the conversation list from the repo snapshot, maps
  `branch → chat session`, filters the Code rail to **terminal** sessions only, and
  loads staging per chat session for the rail's pending chip.
- `ChatView` takes `sessionId` + `onStaged`; its transcript is
  `build_context(branch) + staged(session)`; each mode reports whether its turn was
  staged (`onStaged`) or committed (`onCommitted`).

## Adding a conversation mode

Add the prefix to `CONVERSATION_PREFIXES` (`Shell.tsx`) and
`CONVERSATION_MODES` (`ChatRail.tsx`). The badge, filter and colour follow.
