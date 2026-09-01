# How the flywheel works

ShotBreakdown does not fine-tune a model. It gets better in two cheap loops.

## 1. Retrieval (everyone)

After a breakdown is written we embed a short text blob:

`one_line_summary + tags + lighting.key + movement.type`

That vector lives on `submissions.embedding`. Before Claude runs on a new shot we embed a query (title + source) and call `match_verified_breakdowns`. We inject the 3 nearest **verified** rows (or rows with `rating_avg >= 4`) as few-shot examples.

A shot becomes verified when `rating_count >= 3` and `rating_avg >= 4.5`, or when an admin hits Verify on `/admin/review`. Until that table has rows, we fall back to the three gold examples in `lib/prompts/examples.ts`.

So: every good, well-rated breakdown makes the next similar breakdown more specific.

## 2. Prompt insights (everyone)

Users can correct a field. That writes `breakdown_feedback` (original vs corrected) and overlays the owner's copy in `breakdown_user_edits`. The AI JSON is never mutated.

Once a night, Vercel Cron hits `GET /api/cron/prompt-insights` (Bearer `CRON_SECRET`). The job aggregates corrections from the last 30 days, asks Claude for the five most common failure modes, and stores the paragraph in `prompt_insights`. The latest row is prepended to the system prompt as "Known failure modes to avoid".

`vercel.json` already has the cron entry (`0 8 * * *`).

## 3. Personalization (one user)

`/onboarding` (skippable) and `/settings` write `user_preferences`: skill, camera, lenses, typical work, budget band, tone.

Follow-up chat and `/api/process` inject an "About this filmmaker" block so recreation steps mention *their* gear and lead with *their* budget tier.

Expanding Details increments `user_preferences.signals.expands`. If one card dominates, we say so in the prompt. Counts only — no ML.

## What this is not

No weights are updated. If you ever have ~2,000 verified rows with corrections, export `(frames, corrected breakdown)` pairs and A/B a fine-tune against this RAG setup. Not before.

## Manual work that actually matters

Seed 30–50 of your own shots, then verify them in `/admin/review`. Retrieval and the public library are empty until you do.
