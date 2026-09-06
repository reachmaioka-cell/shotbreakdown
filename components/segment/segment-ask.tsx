"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Message = { role: "user" | "assistant"; content: string };

/**
 * One per department the user is most likely to be standing in when they read
 * a breakdown. They fill the box rather than firing: the useful version of each
 * of these is the one the user has edited.
 */
const PRESETS = [
  "As the editor, where does this cut and why?",
  "Gaffer: cheapest way to get this key?",
  "Production design: what dresses these frames?",
  "Colourist: how do I get this grade in Resolve?",
];

/**
 * Follow-up questions about the whole segment, grounded server-side in the
 * breakdown and every shot record. Streams, so the answer starts appearing
 * immediately.
 */
export function SegmentAsk({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/videos/${videoId}/ask`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: Message[] }) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setQuestion("");
    setMessages((m) => [
      ...m,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/videos/${videoId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (res.status === 401) {
        router.push(`/auth/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setMessages((m) => m.slice(0, -2));
        setError(
          data.message ?? "You've hit today's question limit. Try again tomorrow, or upgrade for more."
        );
        return;
      }
      if (!res.ok || !res.body) {
        setMessages((m) => m.slice(0, -2));
        setError("Could not get an answer. Try again.");
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

  const showPresets = loaded && !streaming && !question.trim();

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
      ) : null}

      {/*
       * The answer streams token by token; announcing that would read every
       * partial word aloud. Announce the state change instead and let the
       * reader move to the text itself.
       */}
      <p role="status" aria-live="polite" className="sr-only">
        {streaming ? "Writing an answer" : messages.length > 0 ? "Answer ready" : ""}
      </p>

      {showPresets ? (
        <ul className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <li key={preset}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(preset);
                  inputRef.current?.focus();
                }}
                className="rounded-[3px] border border-line bg-ink-1 px-2 py-1 text-left text-[11px] text-text-1 hover:border-line-strong hover:text-text-0"
              >
                {preset}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex gap-2"
      >
        <label htmlFor="segment-ask-input" className="sr-only">
          Ask about this segment
        </label>
        <input
          id="segment-ask-input"
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this segment…"
          disabled={streaming}
          aria-busy={streaming}
          className="h-9 flex-1 rounded-[3px] border border-line bg-ink-1 px-2.5 text-[13px] text-text-0 placeholder-text-3 focus:border-line-strong disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !question.trim()}
          className="inline-flex h-9 items-center rounded-[3px] border border-line px-3 text-[13px] text-text-0 hover:border-line-strong hover:bg-ink-2 disabled:opacity-40"
        >
          {streaming ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
