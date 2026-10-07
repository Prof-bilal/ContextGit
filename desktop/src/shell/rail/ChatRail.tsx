import { useMemo, useState } from "react";
import { LuPlus, LuX } from "react-icons/lu";

import { Chip } from "../primitives";

/** The four chat surfaces a conversation can belong to (plus legacy branches). */
export type ConversationMode = "chat" | "council" | "research" | "image" | "other";

export const CONVERSATION_MODES: Array<{ value: ConversationMode | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chat" },
  { value: "council", label: "Council" },
  { value: "research", label: "Research" },
  { value: "image", label: "Image" },
];

const MODE_LABEL: Record<ConversationMode, string> = {
  chat: "Chat",
  council: "Council",
  research: "Research",
  image: "Image",
  other: "Other",
};

/** One real branch, summarised for the conversation list. */
export interface ChatConversation {
  name: string;
  head: string;
  messages: number;
  tokens: number;
  updatedAt: string;
  /** The surface this conversation belongs to (branch-name prefix). */
  mode: ConversationMode;
  /** Messages staged but not yet committed on this conversation's session. */
  pending: number;
  /** Whether the rail should offer a delete button (current/main are protected). */
  deletable: boolean;
}

/**
 * Conversations are the repo's real branches — a chat turn commits to the branch
 * it is typed on. The rail lists them newest first, creates one on demand, and
 * lets the user delete or filter them.
 */
export default function ChatRail({
  conversations,
  selectedBranch,
  filter,
  onFilter,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ChatConversation[];
  selectedBranch: string;
  filter: ConversationMode | "all";
  onFilter: (mode: ConversationMode | "all") => void;
  onSelect: (name: string) => void;
  onNew: () => void;
  onDelete: (name: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations
      .filter((conversation) => filter === "all" || conversation.mode === filter)
      .filter((conversation) => !needle || conversation.name.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, query, filter]);

  return (
    <nav className="cg-rail" aria-label="Conversations">
      <div className="cg-rail-head">
        <h2>Conversations</h2>
        <span className="cg-count">{conversations.length}</span>
      </div>
      <div className="cg-rail-search">
        <input
          type="search"
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <button type="button" className="cg-new-btn" onClick={onNew}>
        <LuPlus aria-hidden="true" /> New conversation
      </button>
      <div className="cg-mini-seg cg-rail-filter" role="tablist" aria-label="Conversation type">
        {CONVERSATION_MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={filter === entry.value}
            onClick={() => onFilter(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {filtered.map((conversation) => (
        <div key={conversation.name} className="cg-row-wrap">
          <button
            type="button"
            className="cg-row cg-row-top"
            aria-current={conversation.name === selectedBranch}
            onClick={() => onSelect(conversation.name)}
          >
            <span className="cg-row-copy">
              <span className="cg-row-title">{conversation.name.replace(/^[a-z]+\//, "")}</span>
              <span className="cg-row-preview cg-mono">{conversation.head.slice(0, 7)}</span>
              <span className="cg-row-meta">
                <Chip>{MODE_LABEL[conversation.mode]}</Chip>
                <span>
                  {conversation.messages} message{conversation.messages === 1 ? "" : "s"}
                </span>
                <span>·</span>
                <span>{(conversation.tokens / 1000).toFixed(1)}k tok</span>
                {conversation.pending > 0 && <Chip tone="warn">{conversation.pending} pending</Chip>}
              </span>
            </span>
          </button>
          {conversation.deletable && (
            <button
              type="button"
              className="cg-icon-btn cg-row-delete"
              aria-label={`Move conversation ${conversation.name} to Storage`}
              title="Move to Storage (restorable)"
              onClick={() => onDelete(conversation.name)}
            >
              <LuX aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {filtered.length === 0 && (
        <p className="cg-empty-note cg-rail-search">No conversations match.</p>
      )}
    </nav>
  );
}
