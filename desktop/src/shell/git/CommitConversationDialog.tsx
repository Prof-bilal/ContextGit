import { useEffect, useRef, useState } from "react";
import { api, type Commit, type Message } from "@/lib/api";
import Modal from "../Modal";
import "./transcript.css";

export default function CommitConversationDialog({ commit, onClose }: { commit: Commit; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setMessages([]);
    setNextCursor(null);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    api.conversationPage(commit.id, 0, controller.signal).then((page) => {
      if (alive) { setMessages(page.messages); setNextCursor(page.next_cursor); }
    }).catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : "Unable to load conversation");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; requestRef.current?.abort(); };
  }, [commit.id, retry]);
  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.conversationPage(commit.id, nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      setMessages(current => [...current, ...page.messages]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load more messages");
    } finally { if (!controller.signal.aborted) setLoadingMore(false); }
  };
  return (
    <Modal title="Conversation" size="lg" onClose={onClose}>
      {error && <p role="alert">{error} <button className="cg-btn" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
      {loading ? <p>Loading conversation…</p> : messages.length === 0 && !error ? (
        <p className="cg-empty-note">No saved conversation messages in this checkpoint. Legacy terminal screens are not conversation history; link the native conversation and create a new checkpoint to save it.</p>
      ) : (
        <ol className="cg-history-transcript">
          {messages.map((message, index) => (
            <li key={index} data-role={message.role}><div>{message.content}</div></li>
          ))}
        </ol>
      )}
      {nextCursor !== null && <button className="cg-btn" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more messages"}</button>}
    </Modal>
  );
}
