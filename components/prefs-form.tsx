"use client";


import { useState } from "react";
import type { UserPreferences } from "@/lib/preferences";
import { DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/validation";

const WORK = ["branded", "music-video", "doc", "narrative", "social"] as const;

type ProfileBits = { display_name: string; credit_me: boolean };

/** Derived from the shared vocabulary, plus an opt-out, so it cannot drift. */
const DEPARTMENT_CHOICES: [string, string][] = [
  ...DEPARTMENTS.map((d) => [d, DEPARTMENT_LABELS[d]] as [string, string]),
  ["other", "Something else"],
];

export function PrefsForm({
  initial,
  profile,
  redirectTo,
  skipHref,
}: {
  initial: Partial<UserPreferences> | null;
  profile?: ProfileBits;
  redirectTo: string;
  skipHref?: string;
}) {
  const [skill, setSkill] = useState(initial?.skill_level ?? "intermediate");
  const [camera, setCamera] = useState(initial?.primary_camera ?? "");
  const [work, setWork] = useState<string[]>(initial?.typical_work ?? []);
  const [budget, setBudget] = useState(initial?.budget_band ?? "under_5000");
  const [role, setRole] = useState<string>(initial?.role ?? "");
  const [tone, setTone] = useState(initial?.tone ?? "concise");
  const [lenses, setLenses] = useState((initial?.lenses ?? []).join(", "));
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [credit, setCredit] = useState(profile?.credit_me ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleWork(value: string) {
    setWork((w) => (w.includes(value) ? w.filter((x) => x !== value) : [...w, value]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill_level: skill,
        primary_camera: camera || null,
        typical_work: work,
        budget_band: budget,
        role: role || null,
        tone,
        lenses: lenses
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        display_name: displayName || null,
        credit_me: credit,
      }),
    });
    if (!res.ok) {
      setError("Save failed");
      setBusy(false);
      return;
    }
    window.location.href = redirectTo;
  }

  async function skip() {
    setBusy(true);
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill_level: "intermediate", tone: "concise" }),
    });
    window.location.href = skipHref ?? redirectTo;
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-6">
      <fieldset>
        <legend className="text-sm text-zinc-400 mb-2">Skill</legend>
        <div className="flex gap-2">
          {(["beginner", "intermediate", "pro"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setSkill(v)}
              className={`text-sm rounded-lg px-3 py-2 border ${skill === v ? "border-white text-white" : "border-zinc-800 text-zinc-500"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="text-sm text-zinc-400">Primary camera</span>
        <input
          value={camera}
          onChange={(e) => setCamera(e.target.value)}
          placeholder="FX3, iPhone 15, Alexa Mini…"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
        />
      </label>

      <fieldset>
        <legend className="text-sm text-zinc-400 mb-2">Typical work</legend>
        <div className="flex flex-wrap gap-2">
          {WORK.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggleWork(v)}
              className={`text-sm rounded-lg px-3 py-2 border ${work.includes(v) ? "border-white text-white" : "border-zinc-800 text-zinc-500"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm text-zinc-400 mb-2">Your department</legend>
        <p className="text-xs text-zinc-500 mb-2">
          Every breakdown covers all nine departments. This decides which one leads and which
          one opens first.
        </p>
        <div className="flex flex-wrap gap-2">
          {DEPARTMENT_CHOICES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => setRole(role === value ? "" : value)}
              className={`text-sm rounded-lg px-3 py-2 border ${role === value ? "border-white text-white" : "border-zinc-800 text-zinc-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm text-zinc-400 mb-2">Budget</legend>
        <div className="flex flex-wrap gap-2">
          {([
            ["under_500", "Under $500"],
            ["under_5000", "Under $5k"],
            ["unlimited", "Unlimited"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setBudget(v)}
              className={`text-sm rounded-lg px-3 py-2 border ${budget === v ? "border-white text-white" : "border-zinc-800 text-zinc-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {profile ? (
        <>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Tone</span>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as "concise" | "detailed")}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="concise">Concise</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Lenses you own</span>
            <input
              value={lenses}
              onChange={(e) => setLenses(e.target.value)}
              placeholder="35mm f/1.8, 85mm…"
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
            Credit me on public pages
          </label>
        </>
      ) : null}

      {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="bg-white text-black text-sm font-medium rounded-lg px-4 py-2.5 disabled:opacity-40">
          Save
        </button>
        {skipHref ? (
          <button type="button" onClick={() => void skip()} className="text-sm text-zinc-500">
            Skip
          </button>
        ) : null}
      </div>
    </form>
  );
}
