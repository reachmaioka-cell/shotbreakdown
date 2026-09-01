"use client";

import { useState } from "react";

type ProbeResult = {
  slug: string;
  title: string;
  source_type: string;
  similarity?: number;
  heading?: string | null;
  preview: string;
};

export function RagProbe() {
  const [query, setQuery] = useState("anamorphic neon handheld night");
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function probe(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/admin/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe_rag", query }),
      });
      const data = (await res.json()) as { results?: ProbeResult[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Probe failed");
        return;
      }
      setResults(data.results ?? []);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-10">
      <h2 className="text-xs text-zinc-500 uppercase tracking-wide mb-3">RAG probe</h2>
      <form onSubmit={(e) => void probe(e)} className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-white"
          placeholder="Test retrieval query…"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length < 3}
          className="text-xs border border-zinc-700 rounded px-3 py-2 text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {loading ? "…" : "Probe"}
        </button>
      </form>
      {error ? <p className="text-xs text-red-400 mb-2">{error}</p> : null}
      {results ? (
        <ul className="flex flex-col gap-3">
          {results.map((r) => (
            <li key={r.slug} className="border border-zinc-800 rounded-md p-3 text-xs">
              <p className="text-zinc-200">{r.title}</p>
              <p className="text-zinc-600 mt-1">
                {r.source_type}
                {r.heading ? ` · ${r.heading}` : ""}
                {r.similarity != null ? ` · ${(r.similarity * 100).toFixed(0)}% match` : ""}
              </p>
              <p className="text-zinc-500 mt-2 line-clamp-3">{r.preview}</p>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="text-zinc-600">No articles matched — check OPENAI_API_KEY and embeddings.</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
