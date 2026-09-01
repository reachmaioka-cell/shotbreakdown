"use client";

import { useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { hasPendingSubmit } from "@/lib/pending";

function subscribe() {
  return () => {};
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const pending = useSyncExternalStore(subscribe, hasPendingSubmit, () => false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const nextParam = new URLSearchParams(location.search).get("next");
    const callback = new URL("/auth/callback", location.origin);
    if (nextParam?.startsWith("/")) callback.searchParams.set("next", nextParam);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
    });
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <SiteHeader />
      <main className="flex-1 px-6 py-10">
        <div className="w-full max-w-sm">
          <h1 className="text-white text-sm font-medium mb-2">Sign in</h1>
          <p className="text-zinc-500 text-sm mb-2">We&apos;ll email a magic link.</p>
          {pending ? (
            <p className="text-zinc-400 text-sm mb-6">We&apos;ll send you back to your breakdown.</p>
          ) : (
            <div className="mb-6" />
          )}

          {sent ? (
            <p className="text-zinc-300 text-sm">
              Check your inbox — a login link is on its way to <span className="text-white font-medium">{email}</span>.
            </p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 rounded-md px-3 py-3 text-sm focus:outline-none focus:border-zinc-600"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-white text-black font-medium rounded-md px-4 py-2 text-sm hover:bg-zinc-200 disabled:opacity-50 self-start"
              >
                {loading ? "Sending…" : "Send magic link"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
