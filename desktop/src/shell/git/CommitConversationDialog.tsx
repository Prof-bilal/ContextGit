import type { Commit } from "@/lib/api";
import Modal from "../Modal";

function readableChatText(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/^\s*[|│]\s?/, "").trim())
    .filter((line) => {
      if (!line) return false;
      return ![
        /^new session\s*-/i,
        /^context$/i,
        /^\+?\s*thought:/i,
        /^\d[\d,]*\s+tokens?$/i,
        /^\d+(?:\.\d+)?%\s+used$/i,
        /^\$[\d.]+\s+spent$/i,
        /^(?:▫|□)?\s*build\s*[·•]/i,
        /^lsp$/i,
        /^lsps?(?:\s+are)?\s+disabled$/i,
        /^\d{4}-\d{2}-\d{2}t\S+$/i,
        /^\d+z$/i,
      ].some((pattern) => pattern.test(line));
    })
    .join("\n")
    .trim();
}

export default function CommitConversationDialog({
  commit,
  onClose,
}: {
  commit: Commit;
  onClose: () => void;
}) {
  const messages = commit.messages
    .map((message) => ({ ...message, content: readableChatText(message.content) }))
    .filter((message) => message.content.length > 0);

  return (
    <Modal
      title="AI conversation"
      subtitle={`${commit.id.slice(0, 7)} · ${commit.summary ?? commit.kind}`}
      size="lg"
      onClose={onClose}
      footer={<button type="button" className="cg-btn" onClick={onClose}>Close</button>}
    >
      {messages.length === 0 ? (
        <p className="cg-empty-note">This commit has no readable conversation messages.</p>
      ) : (
        <div className="cg-conversation-modal-list">
          {messages.map((message, index) => (
            <article className="cg-commit-message" data-role={message.role === "tool" || message.role === "system" ? "assistant" : message.role} key={`${commit.id}-${index}`}>
              <div className="cg-commit-message-head">
                <strong>{message.role === "tool" || message.role === "system" ? "message" : message.role}</strong>
                <span>{message.created_at ? new Date(message.created_at).toLocaleString() : "—"}</span>
              </div>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
