"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/ui/primitives";
import { humanize } from "@/lib/filters";
import { formatDuration } from "@/lib/shot-format";
import {
  DEPARTMENT_LABELS,
  type Department,
  type StoredSegmentBreakdown,
} from "@/lib/validation";

/**
 * The thumbnail strip the sequence table hangs off. Passed in rather than
 * fetched: this component is the page's renderer, not a data source.
 */
export type SegmentBreakdownShot = {
  id: string;
  /** 0-based, matching shots.shot_index and SegmentShot.shot_index. */
  shotIndex: number;
  thumbnailUrl: string | null;
  timecode: string;
};

/*
 * Marked "use client" for one reason: the copy buttons need
 * navigator.clipboard, and a module cannot be half client and half server. The
 * component itself is a pure function of its props — it fetches nothing, holds
 * only disclosure and "copied" state, and server-renders in full on first
 * paint. Everything the user reads comes from `breakdown` and `shots`.
 */

const TIER_LABELS = {
  under_500_usd: "Under $500",
  under_5000_usd: "Under $5,000",
  full_production: "Full production",
} as const;

/** The model writes multi-paragraph prose separated by blank lines. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function Prose({ text, className = "" }: { text: string; className?: string }) {
  const parts = paragraphs(text);
  if (parts.length === 0) return null;
  return (
    <div className={`flex flex-col gap-3 ${className}`.trim()}>
      {parts.map((part, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-text-1">
          {part}
        </p>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="eyebrow mb-3">{children}</h3>;
}

/* ------------------------------------------------------------------ *
 * Markdown export
 * ------------------------------------------------------------------ */

/** A pipe or a newline inside a cell breaks a Markdown table row. */
function cell(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function displayNumber(shotIndex: number): number {
  // shot_index is 0-based on the record; every number a human reads is 1-based.
  return shotIndex + 1;
}

export function breakdownToMarkdown(breakdown: StoredSegmentBreakdown): string {
  const out: string[] = [];
  const push = (line = "") => out.push(line);

  push(`# ${breakdown.title}`);
  push();

  const facts = [
    `Difficulty: ${humanize(breakdown.difficulty)}`,
    breakdown.minimum_crew ? `Minimum crew: ${breakdown.minimum_crew}` : null,
    `Shots: ${breakdown.shot_sequence.length}`,
  ].filter(Boolean);
  if (facts.length > 0) {
    push(facts.join(" · "));
    push();
  }

  if (breakdown.focus_answer.trim()) {
    push("## The question you asked");
    push();
    if (breakdown.focus?.trim()) {
      push(`> ${cell(breakdown.focus)}`);
      push();
    }
    for (const part of paragraphs(breakdown.focus_answer)) {
      push(part);
      push();
    }
  }

  if (breakdown.what_happens.trim()) {
    push("## What happens");
    push();
    for (const part of paragraphs(breakdown.what_happens)) {
      push(part);
      push();
    }
  }
  if (breakdown.setting.trim()) {
    push(`**Setting.** ${breakdown.setting}`);
    push();
  }
  if (breakdown.approach.trim()) {
    push("## Approach");
    push();
    for (const part of paragraphs(breakdown.approach)) {
      push(part);
      push();
    }
  }

  if (breakdown.shot_sequence.length > 0) {
    const withCuts = breakdown.shot_sequence.some((s) => s.cut_note.trim());
    push("## Shot sequence");
    push();
    const header = ["Shot", "Timecode", "What happens", "How it was made"];
    if (withCuts) header.push("The cut");
    push(`| ${header.join(" | ")} |`);
    push(`| ${header.map(() => "---").join(" | ")} |`);
    for (const shot of breakdown.shot_sequence) {
      const row = [
        String(displayNumber(shot.shot_index)),
        cell(shot.timecode),
        cell(shot.what_happens),
        cell(shot.how_it_was_made),
      ];
      if (withCuts) row.push(cell(shot.cut_note));
      push(`| ${row.join(" | ")} |`);
    }
    push();
  }

  if (breakdown.departments.length > 0) {
    push("## Departments");
    push();
    for (const dept of breakdown.departments) {
      push(`### ${DEPARTMENT_LABELS[dept.role]}`);
      push();
      if (dept.headline) {
        push(dept.headline);
        push();
      }
      if (dept.steps.length > 0) {
        dept.steps.forEach((step, i) => push(`${i + 1}. ${step}`));
        push();
      }
      if (dept.gear.length > 0) {
        push(`**Gear.** ${dept.gear.join("; ")}`);
        push();
      }
      if (dept.pitfalls.length > 0) {
        push("**Watch for**");
        push();
        for (const pitfall of dept.pitfalls) push(`- ${pitfall}`);
        push();
      }
    }
  }

  if (breakdown.shot_list.length > 0) {
    push("## Shot list");
    push();
    breakdown.shot_list.forEach((line, i) => push(`${i + 1}. ${line}`));
    push();
  }

  if (breakdown.prep_checklist.length > 0) {
    push("## Prep checklist");
    push();
    for (const item of breakdown.prep_checklist) push(`- [ ] ${item}`);
    push();
  }

  const tiers = (Object.keys(TIER_LABELS) as (keyof typeof TIER_LABELS)[]).filter(
    (key) => breakdown.budget_tiers[key].length > 0
  );
  if (tiers.length > 0) {
    push("## Budget");
    push();
    for (const key of tiers) {
      push(`### ${TIER_LABELS[key]}`);
      push();
      for (const item of breakdown.budget_tiers[key]) push(`- ${item}`);
      push();
    }
  }

  if (breakdown.common_mistakes.length > 0) {
    push("## Common mistakes");
    push();
    for (const item of breakdown.common_mistakes) push(`- ${item}`);
    push();
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

/**
 * `build` is a thunk so the whole Markdown document is only assembled when the
 * user actually asks for it, not on every render of the page.
 */
function CopyButton({
  build,
  label,
  describes,
  className = "",
}: {
  build: () => string;
  label: string;
  /** Named in the live announcement, so two copy buttons do not sound alike. */
  describes: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(build());
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-8 items-center rounded-[3px] border border-line px-2.5 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
      >
        {state === "copied" ? "Copied" : label}
      </button>
      <span role="status" aria-live="polite" className="text-[12px] text-text-2">
        {state === "copied"
          ? `${describes} copied`
          : state === "failed"
            ? "This browser will not let the page copy. Select the text and copy it."
            : ""}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The breakdown
 * ------------------------------------------------------------------ */

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "breakdown"
  );
}

export function SegmentBreakdown({
  breakdown,
  shots,
  openRole = null,
  segmentSeconds = null,
}: {
  breakdown: StoredSegmentBreakdown;
  shots: SegmentBreakdownShot[];
  /** Which department disclosure starts open. Falls back to camera. */
  openRole?: Department | null;
  /** Segment length in seconds, when the page knows it. Never invented here. */
  segmentSeconds?: number | null;
}) {
  const sequence = breakdown.shot_sequence;
  const showCutNotes = sequence.some((shot) => shot.cut_note.trim().length > 0);
  const thumbs = new Map(shots.map((shot) => [shot.shotIndex, shot]));

  // A department with nothing in it renders flat, so it has no drawer to open.
  const expandable = new Set(
    breakdown.departments
      .filter((d) => d.steps.length > 0 || d.gear.length > 0 || d.pitfalls.length > 0)
      .map((d) => d.role)
  );
  // Asking for a department that turned out to be empty should not leave the
  // whole list shut; camera is the fallback because it always has work in it.
  const initiallyOpen =
    openRole && expandable.has(openRole) ? openRole : expandable.has("camera") ? "camera" : null;

  const [expanded, setExpanded] = useState<Partial<Record<Department, boolean>>>(() =>
    initiallyOpen ? { [initiallyOpen]: true } : {}
  );

  // A new openRole means the page has pointed at a department — follow it,
  // without collapsing anything the reader opened for themselves.
  const [seenRole, setSeenRole] = useState(openRole);
  if (seenRole !== openRole) {
    setSeenRole(openRole);
    if (openRole && expandable.has(openRole)) {
      setExpanded((prev) => ({ ...prev, [openRole]: true }));
    }
  }

  const facts: string[] = [];
  if (breakdown.minimum_crew.trim()) facts.push(breakdown.minimum_crew.trim());
  if (sequence.length > 0) facts.push(`${sequence.length} shot${sequence.length === 1 ? "" : "s"}`);
  if (segmentSeconds !== null && Number.isFinite(segmentSeconds) && segmentSeconds > 0) {
    facts.push(formatDuration(segmentSeconds));
  }

  /*
   * Built on click rather than rendered into an href: a data: URL would ship a
   * second, URL-encoded copy of the whole document inside every page load, for
   * a button most readers never press.
   */
  function downloadJson() {
    const blob = new Blob([JSON.stringify(breakdown, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(breakdown.title)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked a tick later: some browsers need the URL alive past the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const tiers = (Object.keys(TIER_LABELS) as (keyof typeof TIER_LABELS)[]).filter(
    (key) => breakdown.budget_tiers[key].length > 0
  );

  return (
    <article className="flex flex-col gap-10">
      {/* 1. Header */}
      <header className="flex flex-col gap-3">
        <h2 className="max-w-[40ch] text-[22px] leading-tight text-text-0 md:text-[26px]">
          {breakdown.title}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Pill
            tone={
              breakdown.difficulty === "hard" || breakdown.difficulty === "specialist"
                ? "accent"
                : "default"
            }
            title="How hard this segment is to shoot"
          >
            {humanize(breakdown.difficulty)}
          </Pill>
          {facts.length > 0 ? (
            <p className="text-[12px] text-text-2">{facts.join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            build={() => breakdownToMarkdown(breakdown)}
            label="Copy as Markdown"
            describes="Breakdown"
          />
          <button
            type="button"
            onClick={downloadJson}
            className="inline-flex h-8 items-center rounded-[3px] border border-line px-2.5 text-[12px] text-text-0 hover:border-line-strong hover:bg-ink-2"
          >
            Download JSON
          </button>
        </div>
      </header>

      {/* 2. The answer to what they asked, first, because it is why they are here. */}
      {breakdown.focus_answer.trim() ? (
        <section className="border-l-2 border-accent pl-4">
          <SectionTitle>The question you asked</SectionTitle>
          {breakdown.focus?.trim() ? (
            <p className="mb-3 max-w-[72ch] text-[13px] leading-relaxed text-text-2">
              &ldquo;{breakdown.focus.trim()}&rdquo;
            </p>
          ) : null}
          <Prose text={breakdown.focus_answer} className="max-w-[72ch]" />
        </section>
      ) : null}

      {/* 3. What happens */}
      {breakdown.what_happens.trim() ||
      breakdown.setting.trim() ||
      breakdown.approach.trim() ? (
        <section>
          <SectionTitle>What happens</SectionTitle>
          <div className="max-w-[72ch] flex flex-col gap-4">
            <Prose text={breakdown.what_happens} />
            {breakdown.setting.trim() ? (
              <p className="text-[13px] leading-relaxed text-text-1">
                <span className="text-text-2">Setting. </span>
                {breakdown.setting}
              </p>
            ) : null}
            {breakdown.approach.trim() ? (
              <div>
                <h4 className="eyebrow mb-2">How it was approached</h4>
                <Prose text={breakdown.approach} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4. Shot sequence */}
      {sequence.length > 0 ? (
        <section>
          <SectionTitle>Shot sequence</SectionTitle>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left align-top">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">
                    Frame
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">
                    Shot
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">
                    Timecode
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">
                    What happens
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-3 font-normal">
                    How it was made
                  </th>
                  {showCutNotes ? (
                    <th scope="col" className="eyebrow py-2 font-normal">
                      The cut
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sequence.map((shot) => {
                  const thumb = thumbs.get(shot.shot_index);
                  const number = displayNumber(shot.shot_index);
                  const timecode = shot.timecode || thumb?.timecode || "";
                  return (
                    <tr
                      key={shot.shot_index}
                      data-shot-index={shot.shot_index}
                      className="border-b border-line/60 align-top last:border-0 hover:bg-ink-1"
                    >
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          data-shot-index={shot.shot_index}
                          aria-label={
                            timecode
                              ? `Jump to shot ${number} at ${timecode}`
                              : `Jump to shot ${number}`
                          }
                          className="block w-24 overflow-hidden rounded-[2px]"
                        >
                          <span className="relative block aspect-video w-24 bg-ink-2">
                            {thumb?.thumbnailUrl ? (
                              <Image
                                src={thumb.thumbnailUrl}
                                alt=""
                                fill
                                sizes="96px"
                                className="object-cover"
                              />
                            ) : (
                              <span className="absolute inset-0 rounded-[2px] border border-dashed border-line" />
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="mono py-3 pr-3 text-[12px] text-text-2">
                        {String(number).padStart(2, "0")}
                      </td>
                      <td className="mono py-3 pr-3 text-[12px] whitespace-nowrap text-text-2">
                        {timecode}
                      </td>
                      <td className="max-w-[30ch] py-3 pr-3 text-[13px] leading-relaxed text-text-0">
                        {shot.what_happens}
                      </td>
                      <td className="max-w-[34ch] py-3 pr-3 text-[13px] leading-relaxed text-text-1">
                        {shot.how_it_was_made}
                      </td>
                      {showCutNotes ? (
                        <td className="max-w-[26ch] py-3 text-[13px] leading-relaxed text-text-2">
                          {shot.cut_note}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {sequence.map((shot) => {
              const thumb = thumbs.get(shot.shot_index);
              const number = displayNumber(shot.shot_index);
              const timecode = shot.timecode || thumb?.timecode || "";
              return (
                <li
                  key={shot.shot_index}
                  data-shot-index={shot.shot_index}
                  className="rounded-[3px] border border-line bg-ink-1 p-3"
                >
                  <button
                    type="button"
                    data-shot-index={shot.shot_index}
                    aria-label={
                      timecode ? `Jump to shot ${number} at ${timecode}` : `Jump to shot ${number}`
                    }
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className="relative block aspect-video w-20 shrink-0 overflow-hidden rounded-[2px] bg-ink-2">
                      {thumb?.thumbnailUrl ? (
                        <Image
                          src={thumb.thumbnailUrl}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 rounded-[2px] border border-dashed border-line" />
                      )}
                    </span>
                    <span className="mono text-[12px] text-text-2">
                      Shot {String(number).padStart(2, "0")}
                      {timecode ? ` · ${timecode}` : ""}
                    </span>
                  </button>
                  {shot.what_happens ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-text-0">
                      {shot.what_happens}
                    </p>
                  ) : null}
                  {shot.how_it_was_made ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-1">
                      {shot.how_it_was_made}
                    </p>
                  ) : null}
                  {showCutNotes && shot.cut_note ? (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                      <span className="eyebrow mr-1.5">Cut</span>
                      {shot.cut_note}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 5. Departments */}
      {breakdown.departments.length > 0 ? (
        <section>
          <SectionTitle>Departments</SectionTitle>
          <div className="border-t border-line">
            {breakdown.departments.map((dept) => {
              const label = DEPARTMENT_LABELS[dept.role];
              const isExpandable = expandable.has(dept.role);

              // "No VFX, this is entirely practical" is the whole answer. A
              // disclosure that opens onto nothing is a lie about there being
              // more to read.
              if (!isExpandable) {
                return (
                  <div
                    key={dept.role}
                    className="grid gap-1 border-b border-line py-3 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-4"
                  >
                    <p className="text-[13px] text-text-1">{label}</p>
                    <p className="max-w-[72ch] text-[13px] leading-relaxed text-text-2">
                      {dept.headline}
                    </p>
                  </div>
                );
              }

              const isOpen = !!expanded[dept.role];
              return (
                <details
                  key={dept.role}
                  open={isOpen}
                  onToggle={(event) =>
                    setExpanded((prev) => ({
                      ...prev,
                      [dept.role]: event.currentTarget.open,
                    }))
                  }
                  className="group border-b border-line"
                >
                  <summary
                    aria-expanded={isOpen}
                    className="grid cursor-pointer list-none gap-1 py-3 md:grid-cols-[11rem_minmax(0,1fr)_1.5rem] md:gap-4"
                  >
                    <span className="text-[13px] text-text-0">{label}</span>
                    <span className="max-w-[72ch] text-[13px] leading-relaxed text-text-2">
                      {dept.headline}
                    </span>
                    <span
                      aria-hidden
                      className="mono hidden justify-self-end text-[13px] text-text-3 md:block"
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </summary>

                  <div className="flex flex-col gap-4 pb-5 md:pl-[calc(11rem+1rem)]">
                    {dept.steps.length > 0 ? (
                      <ol className="flex max-w-[72ch] flex-col gap-2">
                        {dept.steps.map((step, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="mono shrink-0 text-[12px] text-text-3">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-[13px] leading-relaxed text-text-1">{step}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {dept.gear.length > 0 ? (
                      <div>
                        <h4 className="eyebrow mb-2">Gear</h4>
                        <ul className="flex flex-wrap gap-1.5">
                          {dept.gear.map((item, i) => (
                            <li key={i}>
                              <Pill>{item}</Pill>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {dept.pitfalls.length > 0 ? (
                      <div>
                        <h4 className="eyebrow mb-2">Watch for</h4>
                        <ul className="flex max-w-[72ch] flex-col gap-1.5">
                          {dept.pitfalls.map((item, i) => (
                            <li
                              key={i}
                              className="border-l border-line pl-3 text-[13px] leading-relaxed text-text-2"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 6. Shot list */}
      {breakdown.shot_list.length > 0 ? (
        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="eyebrow">Shot list</h3>
            <CopyButton
              build={() =>
                `${breakdown.shot_list.map((line, i) => `${i + 1}. ${line}`).join("\n")}\n`
              }
              label="Copy shot list"
              describes="Shot list"
            />
          </div>
          <ol className="rounded-[3px] border border-line bg-ink-1">
            {breakdown.shot_list.map((line, i) => (
              <li
                key={i}
                className="mono flex gap-3 border-b border-line/60 px-3 py-2 text-[12px] leading-relaxed text-text-1 last:border-0"
              >
                <span className="shrink-0 text-text-3">{String(i + 1).padStart(2, "0")}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* 7. Prep checklist */}
      {breakdown.prep_checklist.length > 0 ? (
        <section>
          <SectionTitle>Prep checklist</SectionTitle>
          <ul className="flex max-w-[72ch] flex-col gap-2">
            {breakdown.prep_checklist.map((item, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-text-1">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 8. Budget tiers */}
      {tiers.length > 0 ? (
        <section>
          <SectionTitle>What it costs</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            {tiers.map((key) => (
              <div key={key} className="rounded-[3px] border border-line bg-ink-1 p-3">
                <h4 className="mb-2 text-[13px] text-text-0">{TIER_LABELS[key]}</h4>
                <ul className="flex flex-col gap-1.5">
                  {breakdown.budget_tiers[key].map((item, i) => (
                    <li key={i} className="text-[13px] leading-relaxed text-text-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 9. Common mistakes */}
      {breakdown.common_mistakes.length > 0 ? (
        <section>
          <SectionTitle>Common mistakes</SectionTitle>
          <ul className="flex max-w-[72ch] flex-col gap-2">
            {breakdown.common_mistakes.map((item, i) => (
              <li
                key={i}
                className="border-l border-line pl-3 text-[13px] leading-relaxed text-text-1"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
