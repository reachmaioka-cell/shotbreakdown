"use client";

import { useId, useRef } from "react";

/** Nothing longer than this reaches the model, so nothing longer is accepted. */
const MAX_FOCUS_LENGTH = 500;

/**
 * The count is noise until the limit is close enough to matter. 400 leaves a
 * hundred characters of warning, which is a sentence or two.
 */
const COUNT_VISIBLE_FROM = 400;

/**
 * Starting points, not answers. Each one appends a sentence so a user can stack
 * two of them, or click one and then keep typing in their own words.
 */
const CHIPS = [
  { label: "Lighting", sentence: "Focus on how this was lit and how I would match it." },
  {
    label: "Camera and movement",
    sentence: "Focus on the camera: lens, movement and how each setup was made.",
  },
  { label: "Edit and pacing", sentence: "Focus on the cut: where each edit lands and why." },
] as const;

/** Appends without gluing two sentences together or doubling a space. */
function append(current: string, sentence: string): string {
  const base = current.trimEnd();
  return base ? `${base} ${sentence}` : sentence;
}

/**
 * What the user wants to know about the segment.
 *
 * Optional on purpose: the breakdown covers all nine departments either way,
 * and asking a question the user does not have would be a toll on the upload.
 */
export function FocusField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const uid = useId();
  const fieldId = `${uid}-focus`;
  const hintId = `${uid}-focus-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remaining = MAX_FOCUS_LENGTH - value.length;
  const showCount = value.length >= COUNT_VISIBLE_FROM;

  function addSentence(sentence: string) {
    const next = append(value, sentence);
    if (next.length > MAX_FOCUS_LENGTH) return;
    onChange(next);
    // Put the caret where the user can keep writing.
    const field = textareaRef.current;
    if (field) {
      field.focus();
      requestAnimationFrame(() => field.setSelectionRange(next.length, next.length));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <label htmlFor={fieldId} className="text-[13px] text-text-0">
          What do you want to know about this segment?
        </label>
        <span className="text-[12px] text-text-3">Optional</span>
      </div>

      <textarea
        ref={textareaRef}
        id={fieldId}
        value={value}
        disabled={disabled}
        maxLength={MAX_FOCUS_LENGTH}
        rows={3}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-[3px] border border-line bg-ink-1 px-3 py-2 text-[13px] leading-relaxed text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none disabled:opacity-40"
      />

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((chip) => {
          const fits = append(value, chip.sentence).length <= MAX_FOCUS_LENGTH;
          // Asking twice is not asking harder, and the sentence is already
          // sitting in the box above where the user can see it.
          const asked = value.includes(chip.sentence);
          return (
            <button
              key={chip.label}
              type="button"
              disabled={disabled || asked || !fits}
              onClick={() => addSentence(chip.sentence)}
              className="inline-flex h-7 items-center rounded-[3px] border border-line px-2.5 text-[12px] text-text-1 hover:border-line-strong hover:bg-ink-2 hover:text-text-0 disabled:opacity-40"
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p id={hintId} className="text-[12px] text-text-3">
          Leave it blank and you get the full breakdown anyway.
        </p>
        <p aria-live="polite" className="text-[12px] text-text-3">
          {showCount ? `${remaining} characters left` : ""}
        </p>
      </div>
    </div>
  );
}
