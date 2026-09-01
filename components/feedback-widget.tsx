"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function FeedbackWidget({ submissionId }: { submissionId: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => setAuthed(!!data.user));
    void fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
    });
  }, [submissionId]);

  async function rate(n: number) {
    setRating(n);
    await fetch(`/api/breakdown/${submissionId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: n }),
    });
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!authed) {
      window.location.href = "/auth/login";
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer("");
    const res = await fetch(`/api/breakdown/${submissionId}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 402) {
        setError("Follow-up limit reached.");
      } else {
        setError(data.error ?? "Ask failed");
      }
      setBusy(false);
      return;
    }
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      setBusy(false);
      return;
    }
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setAnswer(acc);
    }
    setQuestion("");
    setBusy(false);
  }

  return (
    <div className="sticky bottom-0 mt-12 border-t border-zinc-800 bg-black/90 backdrop-blur px-4 py-3">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-400">Was this accurate?</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => void rate(n)}
                className={`text-lg ${rating && n <= rating ? "text-white" : "text-zinc-600"}`}
                aria-label={`${n} star`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={(e) => void ask(e)} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a follow-up"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
          />
          <button
            type="submit"
            disabled={busy || !question}
            className="bg-white text-black text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-40"
          >
            {busy ? "…" : "Ask"}
          </button>
        </form>
        {error ? (
          <p className="text-red-400 text-sm">
            {error}{" "}
            {error.includes("limit") ? (
              <Link href="/upgrade" className="text-zinc-300 hover:text-white underline">
                Upgrade to Pro
              </Link>
            ) : null}
          </p>
        ) : null}
        {answer ? <p className="text-sm text-zinc-300 whitespace-pre-wrap">{answer}</p> : null}
      </div>
    </div>
  );
}
