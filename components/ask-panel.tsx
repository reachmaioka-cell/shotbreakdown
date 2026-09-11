"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How would I recreate this lighting on a small budget?",
  "What lens and distance gets this framing?",
  "How do I match this grade in DaVinci?",
];

/**
 * Ask a question about this specific shot, grounded in its record and the
 * knowledge base. Streams, so the answer starts appearing immediately.
 */
export function AskPanel({ shotId }: { shotId: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/shots/${shotId}/ask`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: Message[] }) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [shotId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/shots/${shotId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (res.status === 429) {
        setMessages((m) => m.slice(0, -2));
        setError("You've hit today's question limit. Try again tomorrow, or upgrade for more.");
        return;
      }
      if (!res.ok || !res.body) {
        // A refusal is JSON even though a good answer is a text stream, and the
        // spending guards put the sentence a reader can act on in message.
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setMessages((m) => m.slice(0, -2));
        setError(data.message ?? "Could not get an answer. Try again.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: answer }]);
      }
    } catch {
      setMessages((m) => m.slice(0, -2));
      setError("Connection lost. Try again.");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {messages.map((message, i) => (
            <li key={i} className={message.role === "user" ? "" : "border-l-2 border-line pl-3"}>
              <p className="eyebrow mb-1">{message.role === "user" ? "You" : "ShotBreakdown"}</p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-1">
                {message.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </p>
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      ) : loaded ? (
        <ul className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => void ask(s)}
                className="rounded-[3px] border border-line bg-ink-1 px-2 py-1 text-[11px] text-text-1 hover:border-line-strong hover:text-text-0"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex gap-2"
      >
        <label htmlFor="ask-input" className="sr-only">
          Ask about this shot
        </label>
        <input
          id="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this shot…"
          disabled={streaming}
          className="h-9 flex-1 rounded-[3px] border border-line bg-ink-1 px-2.5 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !question.trim()}
          className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2 disabled:opacity-40"
        >
          {streaming ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
