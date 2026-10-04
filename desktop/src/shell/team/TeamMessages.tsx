import type { TeamMessage } from "@/lib/api";

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The board feed: how runs talk across their worktrees. */
export default function TeamMessages({
  messages,
  titles,
}: {
  messages: TeamMessage[];
  /** Task id → title, for naming the sender. */
  titles: Record<string, string>;
}) {
  if (messages.length === 0) {
    return <p className="cg-empty-note">No messages yet. Handoffs land here as tasks finish.</p>;
  }
  return (
    <ul className="cg-feed" aria-label="Team messages">
      {[...messages].reverse().map((message) => (
        <li key={message.id} data-kind={message.kind}>
          <span className="cg-feed-kind">{message.kind}</span>
          <span className="cg-feed-who">
            {titles[message.from_task_id ?? message.task_id ?? ""] ?? "team"}
          </span>
          <span className="cg-feed-body">{message.body}</span>
          <span className="cg-feed-time">{relativeTime(message.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
