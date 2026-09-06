# ShotBreakdown: Launch Plan (segment breakdowns, core only)

**Written:** 2026-09-05 (revised the same day after product clarification)
**For:** the implementing agent (Opus). Read this whole file before touching code.
**Branch to work on:** `launch/core`, cut from `feat/library-clip-frames` after Phase 0.
**Supersedes:** `SHOTBREAKDOWN_IMPLEMENTATION_PLAN.md` and `SHOTBREAKDOWN_LAUNCH_READINESS.md` for
scope. Their security and pipeline findings still stand and must not be regressed.

---

## 0. The thesis

**A user uploads a segment of a video, never a whole video.** They can say what they want to know
about it. ShotBreakdown detects the shots inside the segment, analyses each one, and writes one
breakdown of the segment: what is happening, how the shots are built and cut together, and what
every department would have to do to recreate it. Director, camera, lighting and grip, art
department, editorial, colour, VFX, sound, producer. Every role on a crew should open a segment and
find the part that is theirs.

The unit of the product is the **segment**. Shots are the parts of a segment. The library of
shots is an archive across segments, not the product.

Everything that depends on a pre-seeded public corpus is switched off behind flags, not deleted.
The UI is rebuilt as a Frameset-style workspace over the user's own footage: persistent left
sidebar, dense image grid, overlay detail view, keyboard-driven.

What "featured" and "trending" mean in this codebase: there is no code with those names. The
corpus-dependent surfaces are the homepage "Real shots, really analyzed" grid, the "Browse by
technique" block, the public `All shots` scope in `/library`, taxonomy pages, tag pages, learn
pages, the sitemap's shot and taxonomy URLs, "Visually similar", the admin review queue, and the
seed scripts. Those are what get flagged off.

---

## 1. Facts about the repo that shape the plan

Verified by reading the code on 2026-09-05. Re-verify anything you build on.

- **The pipeline works and is durable.** `upload -> ingest_video -> analyze_shots -> finalize_video`
  as staged jobs in `processing_jobs`, claimed with `FOR UPDATE SKIP LOCKED`, heartbeated,
  retried. `runIngestVideo` downloads the stored file to a temp dir, runs `detectShots`, creates
  shot rows, extracts five candidate frames per shot and stores frame plus thumbnail. It is
  resumable via `fromShotIndex`. Do not restructure it; insert the trim step into it (Phase 2).
- **The `videos` table has no segment or breakdown columns** (`supabase/migrations/0017_shots_model.sql`
  line 69). Phase 2 adds them in `0026_segments.sql`. Additive nullable columns only.
- **Job types are a TypeScript union** in `lib/pipeline/queue.ts` (`ProcessingJobType`) dispatched
  by a `switch` in `lib/pipeline/worker.ts`. `processing_jobs.job_type` is plain `text` with no
  check constraint (0017 line 519), so adding `generate_segment_breakdown` needs no migration,
  only the union, the switch, and the worker's failure hook.
- **Per-shot analysis returns a facet record** (`ShotRecordSchema` in `lib/validation.ts`), not a
  recreation guide. The schema sits ~200 bytes under Anthropic's compiled-grammar ceiling and a
  test fails the build if it grows. **Do not add fields to `ShotRecordSchema`.** The prompt
  (`lib/prompts/shot.ts`) can gain a line; the schema cannot gain a field.
- **The recreation guide is a separate on-demand per-shot job** (`generate_recreation_guide` in
  `lib/pipeline/stages.ts`, route `app/api/shots/[id]/recreation-guide/route.ts`, prompt
  `lib/prompts/recreation.ts`, schema `RecreationGuideSchema`). It is DP-centric. It stays in the
  code but leaves the UI at launch (section 2, D4).
- **The user-edit allowlist is derived from schemas.** `lib/overlay.ts` enumerates leaf paths of
  `BreakdownSchema` and `ShotMetadataSchema`. Anything added to `ShotMetadataSchema` becomes
  user-correctable through `metadata_edits`. The segment breakdown lives on `videos`, so it is not
  affected, but keep it that way.
- **`conversations` is keyed by `shot_id`** (`0021_shots_conversations.sql`). Segment-level Ask
  needs a nullable `video_id` column and a matching unique index.
- **Uploads are private by default**, served through signed URLs. Sharing promotes to `unlisted`
  via `/s/[token]`. Nothing in this plan changes visibility semantics.
- **Link sources and still uploads** take a separate ingest path (`ingestSingleFrameSource`)
  that analyses one cover frame. That cannot produce a segment breakdown and is flagged off.
- **Worker cadence is solved** by `.github/workflows/worker-ping.yml` (5-minute ping to
  `/api/worker`). Confirm the `SITE_URL` and `CRON_SECRET` repository secrets exist. The submit
  route also warm-starts the worker with `after()`, so short segments usually finish in the same
  invocation.
- **Sentry is wired but dormant** until `SENTRY_DSN` is set (`instrumentation.ts`, `lib/errors.ts`).
- **Filter state lives in the URL** via `lib/filters.ts`. The redesign reuses this.
- **Working tree has uncommitted work** on `feat/library-clip-frames` (`components/clip-preview.tsx`,
  `lib/clip.ts`, `lib/shots.ts`, `tests/clip.test.ts`, `package.json`) plus untracked
  `scripts/seed-music-clips.ts` and `.cursor-screenshots/`. Phase 0 deals with it.
- **Design tokens exist** in `app/globals.css` (`--ink-*`, `--text-*`, `--accent` amber). Keep the
  palette; tighten the geometry.

---

## 2. Decisions already made

Ken has confirmed the ones marked confirmed. The rest are the calls a careful colleague would make;
build to them unless Ken says otherwise.

| # | Decision | Status | Why |
|---|---|---|---|
| D1 | **Flags, not deletion.** Corpus-dependent features go behind `lib/features.ts` booleans (default off); routes return `notFound()`. | confirmed | Tested code; re-enabling is one env var. |
| D2 | **The library is the user's own shots.** `/library` defaults to `scope=mine`, keeps `Saved`, drops `All shots`. Signed-out visitors go to login. | confirmed | No public corpus at launch. |
| D3 | **Keep Collections, sharing, export, Ask, corrections, frame picker.** Hide similar shots, taxonomy, tags, learn, onboarding, both admin pages. | confirmed | The first set works without a corpus. |
| D4 | **The breakdown attaches to the segment, always, automatically.** One `generate_segment_breakdown` job runs after `finalize_video` and writes `videos.breakdown`. The per-shot guide job stays in code but its UI button is removed; the shot overlay shows that shot's entry from the segment breakdown instead. | decided here | The product promise is "upload a segment, get the breakdown" with zero clicks. Segments are short, so cost is bounded by the duration cap, not a shot-count threshold. Replaces the earlier per-shot storage decision; per-shot deep dives can return later under `shots.metadata.breakdown`. |
| D5 | **Every department is always present** in the output. A department with nothing to do gets a one-sentence headline and empty steps; the UI collapses it. | decided here | Any role can find their part. |
| D6 | **Video uploads only at launch.** Link paste and still-image upload are flagged off (`FEATURE_LINK_SOURCES`, `FEATURE_STILL_UPLOADS`). | decided here | A cover frame cannot be "very specific to what the section is." |
| D7 | **Segment caps: 60 s free, 180 s Pro; 12 shots free, 30 Pro.** The uploader must pick a segment when the file is longer. The server trims with ffmpeg, stores the trimmed segment, deletes the original. | decided here | "Never the whole video" is enforced, storage stays small, playback is the segment. Constants in `lib/plans.ts`; change the numbers, not the mechanism. |
| D8 | **The focus prompt is optional, free text, up to 500 characters**, captured at upload, stored on the segment, and used to steer the breakdown. The owner can re-ask with a new focus (regenerates, quota-limited) and can chat about the segment (Ask). | decided here | "They would be prompting what aspect of it they want to analyze as well if they wish." |
| D9 | **Drop the `learning` cron from `vercel.json`.** Keep the route and code. | confirmed | Spends tokens distilling web sources for a public corpus that does not exist yet. |
| D10 | **Overlay detail via Next intercepting route**, full page kept for deep links. **Justified grid** for shots. | decided here | Frameset's core interactions. Fallback if intercepting routes fight you: client overlay plus `history.pushState`. |
| D11 | **Routes keep their paths; labels change.** `/videos` is labelled "Segments", `/library` is labelled "Shots". No route renames at launch. | decided here | Zero churn in links, robots, tests. Rename later if wanted. |
| D12 | **Frames sent to the segment breakdown: up to 12 representative frames at 1280 px, evenly sampled with first and last always included**, each preceded by a text label with shot number and timecode. Every shot's facet record goes in as compact text regardless. | decided here | ~1.2k tokens per image; 12 frames plus text is ~25k input tokens, roughly twelve to fifteen cents per segment at current Sonnet pricing. Verify after the first real run. |

---

## 3. Phases

Each phase ends with `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` green and at
least one commit. Phases 1 and 2 touch different files and can run in parallel (two worktrees).
Phase 3 needs Phase 2's migration; its schema, prompt and rendering can be written before that
lands. Phase 4's shell, grid and sidebar can start any time; its segment page needs Phase 3.

### Phase 0: Freeze the branch (30 minutes)

1. Run `npm test`. If green, commit the working tree on `feat/library-clip-frames` as
   "Bound clip hover playback to the detected span". Include `scripts/seed-music-clips.ts`.
2. Add `.cursor-screenshots/` to `.gitignore`. Do not commit the PNGs.
3. `git checkout -b launch/core`.

### Phase 1: Flags and structural simplification (~half a day)

**Goal:** the app has no surface that needs footage the user did not upload, and no input that
cannot become a segment.

| Task | Files | Acceptance |
|---|---|---|
| Create `lib/features.ts` exporting `FEATURES` with `publicLibrary`, `taxonomyPages`, `tagPages`, `learnPages`, `similarShots`, `onboarding`, `adminReview`, `adminLearning`, `linkSources`, `stillUploads`. Each reads `process.env.FEATURE_<NAME> === "1"`, default `false`. One comment per flag saying what it re-enables. | `lib/features.ts` | Importable from server and client. |
| Gate routes: `notFound()` at the top when the flag is off; `generateStaticParams` returns `[]` when off. | `app/(taxonomy)/[segment]/[slug]/page.tsx`, `app/tags/[tag]/page.tsx`, `app/learn/[topic]/page.tsx`, `app/onboarding/page.tsx`, `app/admin/review/page.tsx`, `app/admin/learning/page.tsx`, `app/api/admin/*` (404 when off) | Each returns 404 in dev. Legacy 301s in `app/library/[slug]/route.ts` and `app/breakdown/[id]/route.ts` keep working. |
| Library scope. Default `scope=mine`; `saved` allowed; `public` treated as `mine` when `publicLibrary` is off. Signed-out -> `redirect("/auth/login?next=/library")`. Remove the `All shots` tab. | `app/library/page.tsx`, `app/api/shots/search/route.ts` (401 for unauthenticated when off) | Signed-out `/library` redirects. Facet counts use the same scope. |
| Upload inputs. When `linkSources` is off, hide the URL field and make `POST /api/videos` reject `url` bodies with 400. When `stillUploads` is off, remove image types from the accept list and reject `sourceType: "frame_upload"`. | `components/upload-form.tsx`, `app/api/videos/route.ts`, `lib/constants.ts` (split `ALLOWED_UPLOAD_TYPES` into video and image lists) | A pasted URL or a JPEG cannot create a video row. |
| Homepage. Signed-in -> `redirect("/library")` (Phase 4 changes this to the segments list). Signed-out -> lean landing: hero ("Upload a segment. Get the breakdown every department needs to recreate it."), a live `SegmentBreakdown` render from `content/sample-segment-breakdown.json` (Phase 3 supplies it; stub with a placeholder block until then), three steps, pricing line, footer. Remove the recent-shots grid, "Browse by technique", and the FAQ. Keep `SoftwareApplication` JSON-LD. | `app/page.tsx` | Zero DB reads. |
| Shot page. Hide `SimilarShots` and the view count behind flags. Remove the "Generate recreation guide" button (D4). | `app/shots/[slug]/page.tsx` | No `similar_shots` RPC when off. |
| Auth callback. New users land on `/library` (Phase 4: `/videos`), not `/onboarding`. | `app/auth/callback/route.ts` | Fresh magic-link login lands in the app. |
| Sitemap and robots. Sitemap lists only `/`, `/privacy`, `/terms`, `/upgrade` when `publicLibrary` is off. Robots disallows `/library`, `/shots`, `/learn`, `/tags`, every segment in `TAXONOMY_GROUPS`. | `app/sitemap.ts`, `app/robots.ts` | No DB read in sitemap when off. |
| Crons. Remove the `/api/cron/learning` entry. | `vercel.json` | Two entries remain. |
| Scripts and tests asserting public-corpus behaviour: gate on the flag or remove. | `scripts/e2e-smoke.ts` (the "public shots indexed" check), `scripts/e2e-journey.ts` (public search, logged-out library), unit tests on sitemap | `npm run smoke` and `npm run e2e:journey` pass with flags off. |
| Docs. Move the three root plan/readiness/audit docs into `docs/archive/`. | `docs/archive/*` | Root has `README.md` and `LAUNCH_PLAN.md`. |

Do **not** touch: RLS policies, `lib/safe-url.ts`, `lib/overlay.ts` allowlisting, storage privacy,
Stripe, cron auth. Rate-limit buckets may be added (Phase 3), not loosened.

### Phase 2: The segment model (~1 day)

**Goal:** a video row is a segment. The uploader picks the range and says what they want to know.
The stored file is the segment.

#### 2.1 Migration `supabase/migrations/0026_segments.sql`

```sql
alter table public.videos
  add column if not exists focus text,
  add column if not exists segment_start numeric,
  add column if not exists segment_end numeric,
  add column if not exists source_duration_seconds numeric,
  add column if not exists breakdown jsonb,
  add column if not exists breakdown_status text
    check (breakdown_status in ('pending', 'ready', 'failed')),
  add column if not exists breakdown_error text,
  add column if not exists breakdown_prompt_version text,
  add column if not exists breakdown_generated_at timestamptz;

alter table public.conversations
  add column if not exists video_id uuid references public.videos on delete cascade;
create unique index if not exists conversations_video_user_idx
  on public.conversations (video_id, user_id) where video_id is not null;
```

Add `breakdown`, `breakdown_status`, `breakdown_error`, `breakdown_prompt_version`,
`breakdown_generated_at`, `segment_start`, `segment_end`, `source_duration_seconds` to the
pipeline-owned-column trigger that rejects client writes (find the existing trigger in 0017 and
extend its column list). `focus` is client-writable by the owner. Run `npm run db:migrate` and regenerate
`supabase/schema.sql` if the repo keeps it current.

#### 2.2 Plan limits (`lib/plans.ts`)

```ts
free: { videosPerMonth: 3,  maxVideoSeconds: 60,  maxShotsPerVideo: 12, maxUploadBytes: 300 MB, ... }
pro:  { videosPerMonth: 100, maxVideoSeconds: 180, maxShotsPerVideo: 30, maxUploadBytes: 2 GB,  ... }
```

Rename nothing; change the numbers. `formatDurationLimit` should render seconds under two minutes
as "60 seconds", not "1 minute". No current test pins the old values; the upload form and the
`too_long` pipeline error copy do, so update both.

#### 2.3 Upload: trimmer and focus (`components/upload-form.tsx`, `app/api/videos/route.ts`)

- After a file is chosen, create an object URL and load it into a muted `<video preload="metadata">`.
  On `loadedmetadata`, read `duration`. If the browser cannot decode the file (ProRes MOV, MKV),
  `error` fires: fall back to two timecode inputs (In, Out) with the same validation.
- **Trimmer** (`components/segment-trimmer.tsx`): the preview video, a two-handle range over the
  duration, In/Out timecodes, selected length vs the plan cap ("0:42 of 1:00 allowed"), play-selection
  button that plays In to Out and stops. Keyboard: `I` and `O` set In/Out at the playhead;
  arrows nudge the active handle by one frame (use `1/fps` if known else 1/30 s).
  - If `duration <= maxVideoSeconds`: trimmer collapsed under a "Trim" toggle; default is the
    whole file.
  - If `duration > maxVideoSeconds`: trimmer open and required; Out defaults to In + cap; the
    submit button is disabled until `out - in <= cap`. Copy: "Segments are limited to 60 seconds
    on the free plan. Pick the part you want broken down."
- **Focus** (`components/focus-field.tsx`): one textarea, optional, `maxLength 500`, label "What
  do you want to know about this segment? (optional)", three rotating placeholders: "How was the
  kitchen lit and how would I match it?", "Break down the whip-pan into the close-up at 0:04.",
  "I'm an editor. Focus on the cut rhythm and the speed ramp." Three quick chips: "Lighting",
  "Camera and movement", "Edit and pacing" that append a sentence.
- `POST /api/videos` body gains `segmentStart`, `segmentEnd` (numbers, seconds, optional) and
  `focus` (string, optional, trimmed, max 500). Validate `segmentEnd - segmentStart <= limits.maxVideoSeconds`
  when present. Store on the row. `content_hash` becomes `file:${filePath}:${start}-${end}` so
  the same file trimmed differently is a different segment.
- Upload page copy: title "Break down a segment"; the "What happens next" list gains "The file is
  trimmed to your segment on the server; the original is not kept."

#### 2.4 Ingest: trim, replace, then detect (`lib/pipeline/stages.ts`, `lib/video/ffmpeg.ts`)

In `runIngestVideo`, after `downloadToTemp` and before `detectShots`:

1. `probeVideo(localPath)`. Store `source_duration_seconds`.
2. Decide the range: `segment_start ?? 0` to `segment_end ?? source duration`. If the range is
   longer than `limits.maxVideoSeconds` by more than 0.5 s, throw
   `PipelineError("Segments are limited to N seconds on your plan. Trim the clip and try again.", "too_long", false)`.
3. If the range does not cover the whole file (start > 0.05 or end < duration - 0.05) **and**
   `file_path` does not already end with `/segment.mp4`: new helper `trimVideo(input, output, start, end)`
   in `lib/video/ffmpeg.ts` that re-encodes for frame-accurate cuts
   (`-ss <start> -to <end> -i in -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -movflags +faststart`,
   with `-ss` after `-i` or `-accurate_seek`; measure that the output duration matches within
   0.1 s). Upload to `${user_id}/videos/${videoId}/segment.mp4` with `contentType: video/mp4`,
   update `videos.file_path`, delete the original object, and continue with the trimmed local
   file. This branch is skipped on a resumed ingest (`fromShotIndex > 0`) because `file_path`
   already points at the segment.
4. `detectShots(trimmedPath, { maxShots })` as today. All shot timecodes are relative to the
   segment. The existing duration check now sees the segment length.

Delete the original **after** the trimmed upload succeeds. The DELETE route already removes
`file_path`; with the original gone there is nothing else to clean up.

#### 2.5 Per-shot analysis knows the focus

`analyzeShotFrames` gains `focus?: string | null`; `shotSystemPrompt` gains one line when present:
"The uploader asked: '<focus>'. The record must still be complete; where relevant, let
`description`, `why_it_works`, `lighting_notes` and `color_notes` speak to that question."
`runAnalyzeShots` reads `videos.focus` once and passes it. No schema change.

#### 2.6 Status API

`GET /api/videos/[id]` adds `focus`, `segment_start`, `segment_end`, `source_duration_seconds`,
`breakdown_status`, `breakdown_error` to its select. `PATCH /api/videos/[id]` (new, owner) accepts
`{ title?, focus? }` (focus alone does not regenerate; Phase 3's regenerate route does).

#### 2.7 Tests

- `trimVideo` on the synthetic 5-cut clip used by `tests/pipeline.test.ts`: trimming 3.0 to 9.0
  yields a file of 6.0 s (±0.1) with cuts detected at 3.0 and 6.0 relative.
- `POST /api/videos` rejects a 61 s range on free, accepts 60 s, rejects `url` and `frame_upload`
  when flags are off (route test with mocked auth, or extend `scripts/e2e-journey.ts`).
- `content_hash` differs for different ranges of the same file.
- Journey: upload a 20 s clip whole (no trim), then the same file trimmed 5 to 15; both reach
  `complete`; the second has `duration_seconds` 10 and `file_path` ending in `segment.mp4`.

### Phase 3: The segment breakdown (~1.5 days)

**Goal:** every completed segment carries one breakdown that is specific to what happens in it,
answers the uploader's focus, and gives each department its part.

#### 3.1 Schema (`lib/validation.ts`)

```ts
export const DEPARTMENTS = [
  "director", "camera", "lighting_grip", "art_department", "editorial",
  "color", "vfx", "sound", "producer",
] as const;

export const DepartmentBriefSchema = z.object({
  role: z.enum(DEPARTMENTS),
  headline: z.string(),          // one sentence: this department's job in THIS segment
  steps: z.array(z.string()),    // ordered, imperative, <= 2 sentences each, cite shot numbers/timecodes
  gear: z.array(z.string()),     // "Aputure 600d through 4x4 diffusion (sub: 2x LED panels + shower curtain)"
  pitfalls: z.array(z.string()), // specific to this segment
});

export const SegmentShotSchema = z.object({
  shot_index: z.number(),        // 0-based, matches shots.shot_index
  timecode: z.string(),          // "0:04.20-0:07.05"
  what_happens: z.string(),      // the action/beat in this shot, one or two sentences
  how_it_was_made: z.string(),   // size, angle, move, lens (est.), light, one or two sentences
  cut_note: z.string(),          // why the cut into/out of this shot lands where it does; "" for single-shot segments
});

export const SegmentBreakdownSchema = z.object({
  title: z.string(),             // "Kitchen argument: three-shot coverage ending on a whip-pan"
  what_happens: z.string(),      // 2-4 sentences: who, where, the beat, the turn
  setting: z.string(),           // one sentence
  approach: z.string(),          // 2-3 sentences: coverage, blocking, look, why it reads
  focus_answer: z.string(),      // direct answer to the uploader's focus; "" when none given
  shot_sequence: z.array(SegmentShotSchema),
  departments: z.array(DepartmentBriefSchema),
  shot_list: z.array(z.string()),      // one line per shot: "1 / MCU / low / slow push-in / ~85mm / dusk side-light / A"
  prep_checklist: z.array(z.string()),
  minimum_crew: z.string(),
  difficulty: z.enum(["easy", "moderate", "hard", "specialist"]),
  budget_tiers: z.object({
    under_500_usd: z.array(z.string()),
    under_5000_usd: z.array(z.string()),
    full_production: z.array(z.string()),
  }),
  common_mistakes: z.array(z.string()),
});

export const StoredSegmentBreakdownSchema = SegmentBreakdownSchema.extend({
  version: z.number(),
  prompt_version: z.string(),
  focus: z.string().nullable(),
  generated_at: z.string(),
});
```

Rules:
- No `minItems`/`maxItems`, no literals. Add a grammar-budget test next to the existing ones in
  `tests/pipeline.test.ts`: `JSON.stringify(zodOutputFormat(SegmentBreakdownSchema)).length < 4500`.
  **Measure before writing the prompt.** If it is over, flatten `SegmentShotSchema` into fewer
  strings first.
- `normalizeSegmentBreakdown(raw, shots)`: all nine departments present in canonical order (insert
  an empty brief with headline "Nothing specific to this segment beyond standard practice" if
  missing); `shot_sequence` sorted by `shot_index`, clamped to indices that exist, one entry per
  shot (insert a minimal entry from the facet record if the model skipped one); `shot_list` length
  equals shot count; strip `Step N:` prefixes; trim and dedupe arrays.
- `readSegmentBreakdown(row)` parses `videos.breakdown` with `StoredSegmentBreakdownSchema.safeParse`.

#### 3.2 Prompt (`lib/prompts/segment.ts`, version `segment-v1`)

Message layout (Anthropic content blocks, in this order):

1. System prompt (below).
2. For each selected shot (D12): a text block `Shot 3 of 7 · 0:08.20–0:11.05 · 2.85 s · representative frame`
   followed by the image block. For a single-shot segment send first, representative and last
   frames labelled as such.
3. A text block "Facet records for every shot in the segment (compact JSON, one per line):" then
   one line per shot with: `shot_index`, `timecode`, `one_line_summary`, `description`,
   `composition.shot_size/camera_angle/camera_height`, `movement_facets`, `optics.lens_type/focal_length_range/depth_of_field`,
   `lighting_facets.quality/key_level/key_direction/source/contrast/color_temperature`,
   `color_facets.palette`, `environment.interior_exterior/location_type/time_of_day`,
   `subject.description`, `mood`, `rig_guess`, `ai_tools`. Drop everything else to save tokens.
4. A text block with the uploader's focus, or "The uploader gave no specific focus."
5. "Write the segment breakdown."

System prompt content, in the house voice (plain, committed, no "it depends"):

- "You are the heads of department on a working set, in a room together: director, DP, gaffer and
  key grip, production designer, editor, colourist, VFX supervisor, sound designer, line
  producer. You have watched this segment and you have the per-shot records. Write one breakdown
  of the segment so a crew could recreate it this week."
- Specificity: "Every sentence is about THIS segment. Name shots by number and timecode. Never write
  advice that would be true of any segment."
- `what_happens`: "the action and the emotional beat, who and where, what turns. Plain description,
  no interpretation beyond what the frames show."
- `approach`: "how the segment was covered and built: number of setups, blocking, where the camera
  lives, the look, why the cutting pattern works."
- `focus_answer`: "If the uploader asked something, answer it first and directly, in as much depth as
  it deserves, citing shots. Then still write everything else. If nothing was asked, leave it empty."
- `shot_sequence`: "one entry per shot in order. `how_it_was_made` covers size, angle, move, lens
  estimate, key light; `cut_note` says why the cut into and out of this shot lands where it does
  (motion, eyeline, sound, beat)."
- Departments, one line each (reuse from Appendix B). Editorial is inherently about the segment
  (in/out, rhythm, matching action, what to shoot long enough for). Sound only from visible cues.
  VFX "none beyond grade and grain" when practical. Producer: crew count, hours, permits, what to
  cut first under budget pressure.
- Estimation honesty (copy the paragraph from `lib/prompts/shot.ts`): optical values are estimates
  and are shown as such; never invent camera or lens models not visible.
- `shot_list` format, `difficulty` rubric, `minimum_crew` format, budget tiers definition (reuse the
  existing wording for under $500 and under $5,000; `full_production` is "what a funded shoot would
  actually book").
- Existing blocks when present: about-this-filmmaker, knowledge, failure modes.

#### 3.3 Generation stage and routes

- `lib/segment-breakdown.ts`: `generateSegmentBreakdown({ frames, shots, focus, videoTitle, preferences, insights })`
  using `anthropic.messages.parse` with `zodOutputFormat(SegmentBreakdownSchema)`, `max_tokens`
  6000, same retry shape as `lib/recreation-guide.ts`.
- New job `generate_segment_breakdown` in `ProcessingJobType`, the worker switch, and
  `runGenerateSegmentBreakdown(job)` in `lib/pipeline/stages.ts`: load video and its complete
  shots with their representative frames (`shot_frames.is_representative`), select frames per D12,
  fetch via `fetchAnalysisImage`, call the generator, `normalizeSegmentBreakdown`, write
  `videos.breakdown`, `breakdown_status='ready'`, `breakdown_prompt_version`, `breakdown_generated_at`,
  clear `breakdown_error`. On non-retryable failure or after max attempts: `breakdown_status='failed'`,
  `breakdown_error` set (the worker's failure hook must handle this job type without marking the
  video itself failed).
- `runFinalizeVideo`: after setting `status='complete'` with `complete > 0`, set
  `breakdown_status='pending'` and enqueue `generate_segment_breakdown` with
  `dedupeKey: segment-breakdown:${videoId}`, `priority: limits.jobPriority`, `userId`.
- `POST /api/videos/[id]/breakdown` (owner): body `{ focus?: string }`. Updates `focus` if given,
  sets `breakdown_status='pending'`, enqueues with the same dedupe key (returns `pending` if one is
  active). Rate limit: new bucket `segment_breakdown: { limit: 10, windowSeconds: 86400 }` free,
  route override 60 for Pro. The automatic post-finalize generation does not count against it.
- `POST /api/videos/[id]/ask` (owner): mirrors `app/api/shots/[id]/ask/route.ts`. Context is the
  compact facet lines from 3.2 step 3 plus `videos.breakdown` JSON plus `focus`. Conversation
  row keyed by `video_id`. Shares the `ask` bucket. `lib/prompts/ask.ts` gets a segment variant and
  the line "Answer in the voice of whichever department the question concerns; if the question names
  a role, answer as that role."
- `GET /api/videos/[id]` already exposes `breakdown_status` (Phase 2.6). Add `breakdown` to the
  response when `ready`.

#### 3.4 Rendering (`components/segment/*`)

- `segment-breakdown.tsx` (server component with small client islands):
  - **Header**: `title`, `difficulty` badge, `minimum_crew`, segment length and shot count, the
    uploader's focus shown as a quoted line with "Ask something else" (opens the refocus dialog).
  - **Focus answer** (only when non-empty): first, in a bordered block with the accent rule on the
    left, headed by the focus text.
  - **What happens** and **Setting**, then **Approach**.
  - **Shot sequence**: a table (or stacked cards under 768px): thumbnail, `#`, timecode,
    `what_happens`, `how_it_was_made`, `cut_note`. Clicking a row seeks the player to the shot and
    highlights it (Phase 4 wires this; render a `data-shot-index` now).
  - **Departments**: nine disclosures in canonical order. Headline always visible; steps
    (numbered), gear (chips), pitfalls when open. Empty departments render the headline in `text-3`
    and cannot open. The user's own department opens first when `user_preferences.role` exists
    (3.6), otherwise `camera`.
  - **Shot list** (monospace lines, copy button), **Prep checklist**, **Budget tiers** (three
    columns), **Common mistakes**.
  - "Copy as Markdown" for the whole breakdown; "Download JSON".
- `segment-breakdown-status.tsx` (client): polls `GET /api/videos/[id]` while
  `breakdown_status === 'pending'`, shows "Writing the breakdown…" with the stage copy, renders
  the failure with a Retry button (calls the regenerate route) when `failed`.
- `refocus-dialog.tsx` (client): textarea prefilled with the current focus, submit calls the
  regenerate route, shows remaining daily quota from the 429 body when hit.
- `segment-ask.tsx`: adapt `components/ask-panel.tsx` to the video route with four preset chips
  ("As the editor, where does this cut and why?", "Gaffer: cheapest way to get this key?",
  "Production design: what dresses these frames?", "Colourist: how do I get this grade in Resolve?").
- Shot overlay / shot page: the "Breakdown" tab shows this shot's `shot_sequence` entry plus the
  department steps that mention its shot number, with a link "Open the segment breakdown".
- `lib/export.ts`: JSON export of a video includes `breakdown`. CSV of a video adds `shot_list`
  lines. PDF: add a page after the contact sheet with title, what happens, approach and the
  department headlines. Collections export unchanged.
- `app/s/[token]/page.tsx`: a shared **video** renders the segment breakdown read-only (no Ask,
  no refocus). Shared shots unchanged.

#### 3.5 Sample content

Run one real upload locally (a short segment Ken owns), let the breakdown generate, and save
`videos.breakdown` to `content/sample-segment-breakdown.json` for the landing page. Ask Ken for a
clip if none is available; do not fabricate one from footage you do not have rights to.

#### 3.6 Optional, small: the user's department

Migration line in `0026`: `alter table public.user_preferences add column if not exists role text;`
Add `role` (enum of `DEPARTMENTS` plus `other`, nullable) to `PreferencesSchema`, a select in
`components/prefs-form.tsx`, one line in `formatAboutFilmmaker` ("Primary department: gaffer. Give
that department the most detail; still write all nine."). `segment-breakdown.tsx` opens that
department first. Skip if Phase 4 is running late.

#### 3.7 Tests

- Grammar-budget test for `SegmentBreakdownSchema`.
- `normalizeSegmentBreakdown` fills missing departments and shot entries in order; strips prefixes.
- `runFinalizeVideo` enqueues exactly one `generate_segment_breakdown` and sets `pending` (mock
  `enqueueJob`); does not enqueue when zero shots completed.
- Frame selection helper: 7 shots -> 7 frames; 20 shots -> 12 frames including indices 0 and 19.
- `POST /api/videos/[id]/breakdown` returns 429 past the daily quota; 404 for non-owners.
- `scripts/pipeline-smoke.ts`: assert `breakdown_status === 'ready'`,
  `breakdown.departments.length === 9`, `breakdown.shot_sequence.length === shot_count`.

### Phase 4: Frameset-style redesign (~2 days)

**Goal:** the app feels like a reference-library workspace whose home is the segment page. Images
dominate; chrome is a thin frame around them; everything important is one key away.

#### 4.1 Shell

- `components/shell/app-shell.tsx`: three regions.
  - **Sidebar** (left, `--sidebar-w: 240px`, fixed, full height, `bg-ink-1`, right border
    `--line`): wordmark; primary nav **Segments** (`/videos`), **Shots** (`/library`),
    **Collections**; "Upload a segment" button (accent, full width); a `sidebar` slot for
    page-specific content (filters on Shots, the shot strip on a segment); account block pinned to
    the bottom (initial, plan, menu: Settings, Upgrade, Sign out; Admin only when flags are on).
  - **Top bar** (48px, sticky): page title or search input (Shots page reuses
    `components/search-bar.tsx`), result count, sort, density toggle, and a "Filters" button under
    1024px that opens the sidebar as a drawer.
  - **Content**: `main`, 12px padding, no max-width cap on grids; prose blocks cap at 72ch.
- Use the shell on `/videos`, `/videos/[id]`, `/library`, `/collections`, `/collections/[id]`,
  `/shots/[slug]`, `/settings`, `/upload`. Minimal header on `/`, `/privacy`, `/terms`, `/upgrade`,
  `/auth/login`, `/s/[token]`. Retire `components/site-header.tsx` from app pages.
- Signed-in `/` and the auth callback now land on `/videos`.
- Mobile (< 1024px): sidebar becomes a `<dialog>` drawer; bottom nav with Segments, Shots,
  Collections, Upload.

#### 4.2 Segments list (`app/videos/page.tsx`)

Grid of segment cards: poster at the segment's aspect ratio, title, duration, shot count, a
breakdown status dot (pending, ready, failed), the focus as a one-line quote when present,
created date. Processing cards show the real stage label and progress. Empty state is a large
drop target ("Drop a segment here") plus the three steps. Cards open `/videos/[id]`.

#### 4.3 Segment page (`app/videos/[id]/page.tsx`, `components/video-workspace.tsx`)

The primary page of the product. Layout at >= 1280px: two columns, `minmax(0,1fr) 380px`.

- **Left column**: the player (the stored segment), the shot timeline (existing), a horizontal
  shot strip under it (thumbnails at aspect ratio, current shot outlined in accent, shot number
  and timecode), then `SegmentBreakdown`. Clicking a shot-sequence row or strip thumbnail seeks the
  player and highlights both. `←`/`→` step shots (existing behaviour kept).
- **Right column** (sticky, scrolls independently): tabs **Shot** (the selected shot's
  `ShotMetadataPanel`, renamed in place to `components/shot/specs-panel.tsx`, `EST` labels kept;
  "Open shot" and "Change frame" for the owner), **Ask** (`segment-ask.tsx`), **Details**
  (source file name, original duration and the trimmed range "from 1:12 to 1:42 of the original",
  created date, share state).
- Under 1280px: single column; the right-column tabs move below the player as a segmented control.
- Action row under the player: Share, Export, Ask something else (refocus), Delete. Processing
  and failure states as today (real stage names, retry).

#### 4.4 Shots page: filter sidebar and justified grid (`app/library/page.tsx`)

- `components/library/filter-sidebar.tsx` replaces `components/filter-rail.tsx`. Same URL state,
  same `FILTER_GROUPS`, same `facets` prop. Collapsible groups (`<details>`), primary groups open.
  Each option is a row: checkbox, label, count right-aligned in `text-3`. Colour group shows a
  swatch. Hide options with count 0; hide empty groups. "Clear all" at the top when anything is
  active. Scope tabs (Mine, Saved) at the top of the slot. Add a "Segment" group listing the
  user's segments by title (filter `video_id`, already supported).
- `components/library/justified-grid.tsx` replaces the layout of `components/shot-grid.tsx`;
  keep its infinite scroll, `aria-live` count and roving-tabindex keyboard navigation. Rows of
  `flex` cells with `flex-grow` and `flex-basis` from the aspect ratio; target row height 220px
  comfortable, 160px compact; 4px gap; 2px radius; no border. Fallback 16:9 when width or height
  is null.
- `components/library/shot-cell.tsx` replaces `components/shot-tile.tsx`: image fills the cell;
  hover shows a bottom gradient strip with the one-line summary, the segment title and shot number;
  save icon top-right. Touch shows the strip on the current cell only. Should-have: hover scrub
  across the shot's five candidate frames (add `scrubUrls` to `ShotCard`, sign with one
  `createSignedUrls` call per page). Skip if signed-URL volume is a problem.

#### 4.5 Shot overlay

- `app/@modal/default.tsx` returns `null`; `app/layout.tsx` renders the `modal` slot.
  `app/@modal/(.)shots/[slug]/page.tsx` loads the same data as the full page and renders
  `components/shot/shot-overlay.tsx` in a `<dialog>` that closes on Esc, backdrop click and
  `router.back()`. The full page `app/shots/[slug]/page.tsx` renders the same
  `components/shot/shot-detail.tsx` inside the shell.
- Layout >= 1024px: media left (2/3), panel right (1/3). Below: stacked, full screen.
- Media: `ClipPlayer` bounded to the shot. Under it: one-line summary, description, tags, action
  row (Save, Add to collection, Share, Correct for owners), timecode.
- Panel tabs: **Specs** (default), **In segment** (the shot's `shot_sequence` entry and the
  department steps that cite it, link to the segment), **Frames** (owner), **Ask** (shot-level, existing).
- Prev/next: `lib/result-set.ts` (`useSyncExternalStore`) populated by the grid with the ordered ids
  on the current page; overlay binds `ArrowLeft`/`ArrowRight`; hidden when opened from a deep link.
  `S` toggles save, `Esc` closes and returns focus to the cell that opened it.

#### 4.6 Upload dialog

`components/upload-dialog.tsx` wraps `UploadForm` (with the trimmer and focus field) in a
`<dialog>` opened by the sidebar button; `/upload` stays as a page. Drag-and-drop anywhere over
the Segments or Shots page opens the dialog with the file selected.

#### 4.7 Tokens and type

`app/globals.css`: `--radius: 2px`, `--grid-gap: 4px`, add `--sidebar-w`, `--topbar-h`. Body 13px.
Eyebrow 10px stays. No borders on image cells. Accent reserved for the upload CTA, active filter
state, focus rings, the current-shot outline and the focus-answer rule. Keep every existing
accessibility rule (focus visible, contrast, reduced motion, `aria-live`). No component library;
extend `components/ui/primitives.tsx` with `Dialog`, `Tabs`, `Checkbox` if needed.

#### 4.8 Tests and checks

- Unit: justified row math (16:9, 2.39:1 and 9:16 cells in one row sum to the container width).
- Keyboard: grid roving tabindex still moves focus; overlay Esc closes and restores focus;
  segment page `←`/`→` still steps shots.
- `npm run e2e:journey` updated for the new landing routes (the overlay is not exercised over
  HTTP; the full page is).
- Manual: Segments, segment page and Shots at 390px, 768px, 1280px, 1920px; a 9:16 shot next to a
  2.39:1 shot; hover strip contrast on a bright frame.

### Phase 5: Launch verification (~half a day)

1. `npx tsc --noEmit && npm run lint && npm test && npm run build`.
2. `npx supabase start && npm run db:migrate && npm run test:integration`.
3. `npm run pipeline:smoke` (nine departments, one sequence entry per shot), `npm run e2e:journey`,
   `npm run smoke`.
4. Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`,
   `NEXT_PUBLIC_SITE_URL`, `STRIPE_*`, `SENTRY_DSN`. No `FEATURE_*` set.
5. GitHub secrets `SITE_URL` and `CRON_SECRET` present; `worker-ping.yml` last run green.
6. Deploy preview. `npm run http:smoke` against it. Upload one real segment with a focus, trimmed
   from a longer file. Watch it reach `complete`, then `breakdown_status = ready`. Read the
   breakdown: it must name shots by number, answer the focus first, and have nine departments.
   Open a shot in the overlay, share the segment, open the share logged out, export JSON, refocus
   once, delete the segment and confirm storage is empty for it.
7. Promote. Repeat step 6 on production once.
8. `README.md`: rewrite positioning to section 0; document the trim step, the focus field, the
   segment caps, and every `FEATURE_*` variable.

---

## 4. Guardrails for the implementing agent

- **Flag it off; do not delete it.** Tested code that is out of scope stays in the tree.
- **Never add fields to `ShotRecordSchema`.** Prompt lines are fine; schema fields are not.
- **Never add the breakdown to `ShotMetadataSchema`.** It would become user-editable through the
  corrections path. The segment breakdown lives on `videos`.
- **Additive migrations only.** New nullable columns in `0026`. No renames, no new tables, no
  changes to existing RLS policies except extending the pipeline-owned-column trigger.
- **Do not weaken** RLS, `safeFetch`, the rate limiter, cron auth, storage privacy, or the
  pipeline-owned-column trigger. Adding buckets or columns to them is fine.
- **Delete the original upload only after the trimmed segment is stored.** A failed trim must
  leave the original in place and the job retryable.
- **Measure the grammar budget before writing the prompt.** The guard test is the last line of
  defence, not the first.
- **Verify by running, not reading.** If a step cannot be verified, say so in the commit message.
- **One commit per phase minimum.** Message says what changed and what was run.
- **When a decision in section 2 turns out wrong in practice**, write the reason in the commit and
  take the nearest alternative given here. Do not stop and wait unless the alternative would be
  unsafe.

---

## 5. Definition of done

A new user with no data can: sign in, pick a two-minute file they own, trim it to a 45-second
segment in the browser, type "how was the lighting done in the close-ups", upload, watch real stage
progress, land on the segment page, and read a breakdown that opens by answering their question,
describes what happens in the segment, lists every shot with timecode and how it was made and why
the cuts land, and gives nine departments their steps, gear and pitfalls. They can seek the player
from the shot table, open a shot in the overlay and see its specs with estimates labelled, ask a
follow-up as the editor, refocus the breakdown on the edit, save a shot to a collection, share the
segment with a link that works logged out, export JSON, correct one facet, and delete the segment.
Nothing on any page references footage they did not upload. Storage holds the trimmed segment, not
the original. All verification commands are green and production has processed one real segment
end to end.

---

## Appendix A: Future plan for the public library, "featured" and "trending"

Not for this launch. Sketch so the flags in Phase 1 have a destination.

1. **Rights-cleared corpus.** Public segments must come from footage with clear rights: the
   founder's own work, contributors who opt in to publish, or open-licensed sources (Blender
   Foundation open movies, CC0 stock). YouTube stills and embeds are a legal and availability risk
   for a public catalogue; the seed scripts are development fixtures, not a launch corpus.
2. **Publish flow.** Owner toggles a segment to "submit for library"; `admin/review` (built,
   flagged off) approves; approval sets `visibility = public` and enqueues `distill_shot`.
   Re-enable `FEATURE_ADMIN_REVIEW`, then `FEATURE_PUBLIC_LIBRARY` once a few hundred shots are
   public.
3. **Featured.** An admin-owned collection flagged `featured = true` (one boolean on
   `collections`), surfaced on the homepage and at the top of Shots for signed-out users.
   Editorial, not algorithmic.
4. **Trending.** Seven-day decayed score over `analytics_events` (`shot_view`, `shot_save`) for
   public shots, materialised nightly by the `daily` cron into `shots.trending_score`. Sort option
   in Shots; a "Trending" row on the homepage. Needs the view-count dedupe that already exists.
5. **Per-shot deep dives.** Re-enable the `generate_recreation_guide` UI with its schema swapped
   to `DepartmentBriefSchema`, stored under `shots.metadata.breakdown`.
6. **Link sources.** Only worth re-enabling with a legal way to fetch the actual segment, not the
   cover frame.
7. **Re-enable in order:** admin review, public library, taxonomy pages, tag pages, similar shots,
   learn pages, learning cron. Each is one environment variable. `MIN_SHOTS_FOR_INDEX` already
   protects SEO from an under-populated corpus.

## Appendix B: Department roster, for the prompt and the UI

| Key | Label in UI | What they need from a breakdown |
|---|---|---|
| `director` | Director | Blocking, performance beats, eyelines, what each shot is for in the segment |
| `camera` | Camera | Format, lens (estimated), movement and rig per shot, exposure, framing marks, setups count |
| `lighting_grip` | Lighting and grip | Fixtures and modifiers with substitutes, placement relative to subject and camera, ratios, rigging, power, continuity across shots |
| `art_department` | Art department | Set and dressing, props, wardrobe, hair and makeup, textures and palette in the world, continuity |
| `editorial` | Editorial | In and out points, rhythm, matching action, speed changes, transitions, what to shoot long enough for |
| `color` | Colour | Grade path, contrast curve, secondaries, LUT or process, match across shots, deliverable notes |
| `vfx` | VFX | Plates, tracking, cleanup, comp order, or "none beyond grade and grain" |
| `sound` | Sound | Room and practicals implied by frame, foley, music energy, or "nothing implied" |
| `producer` | Producer | Crew count, hours on set, permits and location notes, budget tier, what to cut first |

---

# Build status

**Built:** 2026-09-05, on branch `launch/core`.

Every phase in this plan was executed. What follows is what was actually verified by running
it, not by reading the code.

## Verified by running

| Check | Result |
|---|---|
| `npm test` | 152 unit and integration tests pass |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |
| `scripts/segment-journey.ts` | 32 of 32, over real HTTP with two real signed-in users |
| `scripts/full-journey.ts` | 24 of 24, real ffmpeg and real Claude, upload through to rendered pages |
| `scripts/pipeline-smoke.ts` | passes with and without a focus question |
| `scripts/http-smoke.ts` | passes, with two checks honestly skipped by their flags |

The end-to-end run trims a 15-second source to 4–13 seconds, detects four shots, analyses each
one, writes a nine-department breakdown that answers the uploader's question citing shots by
number, renders all nine briefs on the segment page, deletes the original from storage, and
cleans up completely on delete.

## Defects found and fixed while building

Each of these was found by running the thing, not by reading it.

1. **A staged job could not enqueue its own continuation.** `runAnalyzeShots` re-enqueued
   itself under `analyze:<videoId>`, the key its own running job still held, so the dedupe
   index rejected the insert and the segment stalled in `analyzing` with no queued work.
   Predates this work; only reachable when a segment has more shots than fit in one analysis
   budget, which every earlier test clip was too short to hit. Continuations now number each
   pass. Locked in by an integration test.
2. **Raw pipeline errors leaked to non-owners.** `GET /api/videos/[id]` returned
   `breakdown_error` verbatim to any signed-in reader of a public segment, and the poller put
   it back into client state after the page had blanked it. Gated on ownership in the route.
3. **The public-library flag stopped restoring the feature.** The login wall and the
   anonymous-safe paths had been hardcoded rather than gated, so turning the flag back on
   would have left the page behind login and thrown on `user.id`. Restored to a real gate.
4. **A question asked mid-generation was charged and discarded.** The dedupe index blocks a
   second active job, so a refocus during a running generation was stored, billed, and never
   answered. The stage now compares the question it answered against the row's current
   question and queues a follow-up.
5. **The overlay's arrow-key navigation was dead** — nothing published the result set.
6. **The segments list signed up to sixty poster URLs one call at a time** in front of first
   paint, and never updated a processing segment without a reload.
7. **The trimmer kept a stale stop point**, so after using "Play selection" the preview could
   not be played past the out point by any other means.
8. **A footer column of links into now-404 routes** shipped on every page, the landing page
   included.

## Known gaps, stated plainly

- **No browser-driven test.** There is no headless browser in the project and no dependency
  was added for one. The interactive half of the trimmer — pointer dragging, the arrow, Home,
  End, `i` and `o` keys, "Play selection" stopping at the out point — is verified by types,
  lint, pure-helper tests and reading, not by driving a real browser. A manual pass with a
  two-minute MP4, a twenty-second MP4 and a ProRes MOV is the remaining gap.
- **The landing page shows the shape of a breakdown, not a sample of one.** Writing a
  convincing fake would have been the single dishonest thing on the page. Supplying one short
  clip you own turns that section into a real worked example.
- ~~A stranded breakdown has no automatic retry.~~ **Fixed.** `sweepStuckBreakdowns` runs in the
  daily cron: a segment that reached `complete` with `breakdown_status` stuck at `pending` for
  half an hour, with no live job and at least one analysed shot, is requeued. A `failed`
  breakdown is deliberately not swept — that one is the owner's to retry, and re-running it
  automatically would spend against a cause that has not changed.
- **Cost is unmeasured against the real bill.** A segment costs one Claude vision call per
  shot plus one breakdown call over up to twelve frames. Confirm against the console after the
  first real week and adjust the plan caps in `lib/plans.ts`.

## Post-build security audit

Run after the build was complete, against the running app and the real database, with two real
signed-in users plus an anonymous caller.

**One real vulnerability, found and fixed.** `videos.poster_path` and `shots.poster_path` /
`thumbnail_path` are signed with the service role and were client-writable. An authenticated
user could point one of their own rows at another user's storage key and be handed a working
signed URL to that file. Reproduced end to end before fixing: the attacker read a victim's
private frame. Closed by migration `0027_protect_storage_paths.sql`, and guarded by four
regression tests that were checked against the pre-fix trigger first — three of them fail
without it.

**Everything else held.** Every route was probed cross-user and anonymously: no owner data was
read and nothing was mutated. The column-protection triggers rejected all thirteen
pipeline-owned fields. Storage refused a cross-user download, an upload into another user's
folder, a signed URL for someone else's object, and a public fetch. Row-level security returned
empty sets for a stranger reading videos, shots and conversations directly through PostgREST.
No client component imports a server-only module. Every internal link on every reachable page
resolves; `robots.txt` disallows all ten flagged-off surfaces and the sitemap lists only the
four public marketing URLs.

## Before deploying

1. Set the production environment variables listed in `README.md`. No `FEATURE_*` variable
   should be set: every one defaults off, which is the launch configuration.
2. Confirm the `SITE_URL` and `CRON_SECRET` repository secrets exist, so
   `.github/workflows/worker-ping.yml` can drain the queue every five minutes. The two-minute
   Vercel cron needs a paid plan; the pinger is the alternative.
3. Deploy a preview, run `npm run http:smoke <preview-url>`, then upload one real segment with
   a question and read the breakdown.
4. Promote, and repeat step 3 once against production.
