import { useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";

/** One real branch, summarised for the conversation list. */
export interface ChatConversation {
  name: string;
  head: string;
  messages: number;
  tokens: number;
  updatedAt: string;
}

/**
 * Conversations are the repo's real branches — a chat turn commits to the branch
 * it is typed on. The rail lists them newest first, and creates one on demand.
 */
export default function ChatRail({
  conversations,
  selectedBranch,
  onSelect,
  onNew,
}: {
  conversations: ChatConversation[];
  selectedBranch: string;
  onSelect: (name: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return conversations
      .filter((conversation) => !needle || conversation.name.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [conversations, query]);

  return (
    <nav className="cg-rail" aria-label="Conversations">
      <div className="cg-rail-head">
        <h2>Conversations</h2>
        <span className="cg-count">{conversations.length}</span>
      </div>
      <div className="cg-rail-search">
        <input
          type="search"
          placeholder="Search branches"
          aria-label="Search branches"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <button type="button" className="cg-new-btn" onClick={onNew}>
        <LuPlus aria-hidden="true" /> New conversation
      </button>
      {filtered.map((conversation) => (
        <button
          key={conversation.name}
          type="button"
          className="cg-row cg-row-top"
          aria-current={conversation.name === selectedBranch}
          onClick={() => onSelect(conversation.name)}
        >
          <span className="cg-row-copy">
            <span className="cg-row-title">{conversation.name.replace("chat/", "")}</span>
            <span className="cg-row-preview cg-mono">{conversation.head.slice(0, 7)}</span>
            <span className="cg-row-meta">
              <span>
                {conversation.messages} message{conversation.messages === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>{(conversation.tokens / 1000).toFixed(1)}k tok</span>
            </span>
          </span>
        </button>
      ))}
      {filtered.length === 0 && (
        <p className="cg-empty-note cg-rail-search">No branches match.</p>
      )}
    </nav>
  );
}
