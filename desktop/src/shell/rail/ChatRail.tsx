import { useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";

import { CONVERSATIONS, type Conversation } from "../../mock/fixtures";

export default function ChatRail({
  selectedBranch,
  onSelect,
}: {
  selectedBranch: string;
  onSelect: (conversation: Conversation) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CONVERSATIONS.filter((conversation) => {
      if (!needle) return true;
      const last = conversation.messages.at(-1)?.content ?? "";
      return `${conversation.branch.name} ${last}`.toLowerCase().includes(needle);
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [query]);

  return (
    <nav className="cg-rail" aria-label="Saved conversations">
      <div className="cg-rail-head">
        <h2>Conversations</h2>
        <span className="cg-count">{CONVERSATIONS.length}</span>
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
      <button type="button" className="cg-new-btn">
        <LuPlus aria-hidden="true" /> New conversation
      </button>
      {filtered.map((conversation) => (
        <button
          key={conversation.branch.name}
          type="button"
          className="cg-row cg-row-top"
          aria-current={conversation.branch.name === selectedBranch}
          onClick={() => onSelect(conversation)}
        >
          <span className="cg-row-copy">
            <span className="cg-row-title">{conversation.branch.name.replace("chat/", "")}</span>
            <span className="cg-row-preview">
              {conversation.messages.at(-1)?.content.slice(0, 70)}…
            </span>
            <span className="cg-row-meta">
              <span>{conversation.messages.length} messages</span>
              <span>·</span>
              <span>{(conversation.tokens / 1000).toFixed(1)}k tok</span>
            </span>
          </span>
        </button>
      ))}
      {filtered.length === 0 && (
        <p className="cg-empty-note cg-rail-search">No conversations match.</p>
      )}
    </nav>
  );
}
