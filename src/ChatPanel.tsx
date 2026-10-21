import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { CHAT_LIMIT, type ChatMessage, type ChatReply } from "../shared/chat";
const reactions = [
  "Namaste! 🙏",
  "Badiya deal! 🤝",
  "Arre wah! 😄",
  "Chai break? ☕",
];
export function ChatPanel({
  messages,
  you,
  connected,
  socket,
  room,
}: {
  messages: ChatMessage[];
  you: string;
  connected: boolean;
  socket: Socket;
  room: string;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [unread, setUnread] = useState(0);
  const list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    wasNearBottom = useRef(true),
    last = useRef<string>(messages.at(-1)?.id || ""),
    pending = useRef<{ clientId: string; text: string } | undefined>(undefined);
  useEffect(() => {
    const newest = messages.at(-1);
    if (!newest) return;
    if (last.current !== newest.id && !open) {
      const previous = messages.findIndex((m) => m.id === last.current);
      const incoming = messages
        .slice(previous + 1)
        .filter((m) => m.senderId !== you).length;
      if (incoming) setUnread((n) => n + incoming);
    }
    last.current = newest.id;
    if (open && wasNearBottom.current)
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: "smooth",
      });
  }, [messages, open, you]);
  useEffect(() => {
    if (open) {
      setUnread(0);
      wasNearBottom.current = true;
      list.current?.scrollTo({ top: list.current.scrollHeight });
      input.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  async function send(text = draft) {
    if (sending || !connected || !text.trim()) return;
    setError("");
    setSending(true);
    if (pending.current?.text !== text)
      pending.current = {
        clientId: crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        text,
      };
    try {
      const reply = (await socket
        .timeout(6000)
        .emitWithAck("chat:send", pending.current)) as ChatReply;
      if (reply.error) {
        setError(reply.error);
        return;
      }
      setDraft((current) => (current === text ? "" : current));
      pending.current = undefined;
    } catch {
      setError("Message not confirmed. Check your connection and try again.");
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }
  return (
    <div className={`table-chat ${open ? "chat-open" : ""}`}>
      {open && (
        <section className="chat-panel" aria-label="Table chat">
          <div className="chat-header">
            <div>
              <span className="eyebrow">BAITHAK · TABLE {room}</span>
              <h2>
                Table talk{" "}
                <span className={connected ? "chat-online" : "chat-offline"}>
                  {connected ? "Live" : "Offline"}
                </span>
              </h2>
            </div>
            <button
              className="chat-close"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div
            className="chat-messages"
            ref={list}
            role="log"
            aria-label="Room messages"
            aria-live="polite"
            aria-relevant="additions"
            onScroll={() => {
              const el = list.current!;
              wasNearBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 70;
            }}
          >
            {!messages.length && (
              <div className="chat-empty">
                <span>☕</span>
                <strong>Every good deal starts with a conversation.</strong>
                <p>
                  Say namaste to your table. Only players in this room can see
                  these messages.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <article
                className={`chat-message ${m.senderId === you ? "mine" : ""}`}
                key={m.id}
              >
                <div className="chat-meta">
                  <strong>{m.senderId === you ? "You" : m.senderName}</strong>
                  <time dateTime={new Date(m.createdAt).toISOString()}>
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
          <div className="chat-quick" aria-label="Quick messages">
            {reactions.map((text) => (
              <button
                key={text}
                disabled={!connected || sending}
                onClick={() => void send(text)}
              >
                {text}
              </button>
            ))}
          </div>
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="table-message">
              Message your table
            </label>
            <textarea
              id="table-message"
              ref={input}
              value={draft}
              maxLength={CHAT_LIMIT}
              disabled={!connected}
              placeholder={
                connected
                  ? "Bolo, kya deal hai?"
                  : "Reconnecting to your table…"
              }
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <span>
                {draft.length}/{CHAT_LIMIT} · Enter to send
              </span>
              <button
                type="submit"
                disabled={!connected || sending || !draft.trim()}
              >
                {sending ? "Sending…" : "Send ↗"}
              </button>
            </div>
            {error && (
              <p role="alert" className="chat-error">
                {error}
              </p>
            )}
          </form>
          <p className="chat-footnote">
            Private to this table · Last 100 messages saved on the host
          </p>
        </section>
      )}
      <button
        className="chat-launcher"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>💬</span>
        {open ? "Back to the table" : "Table chat"}
        {!open && unread > 0 && (
          <b
            aria-label={`${unread} unread ${unread === 1 ? "message" : "messages"}`}
          >
            {unread > 99 ? "99+" : unread}
          </b>
        )}
      </button>
    </div>
  );
}
