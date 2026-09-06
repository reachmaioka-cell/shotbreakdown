# ShotBreakdown — Implementation Plan (Launch)

**Written:** 2026-08-23
**Method:** full read of the repository (10,371 LOC across `app/`, `lib/`, `components/`,
`supabase/migrations/`), `tsc --noEmit` (pass), `npm run build` (pass), live inspection of the
local Supabase instance (15 migrations applied, 41 submissions, 39 verified, 168 knowledge
articles, 227 chunks), and ffmpeg capability probing.

**Status: complete.** See `SHOTBREAKDOWN_LAUNCH_READINESS.md` for what was built, what was
verified and what remains. The security findings in `AI_CODEBASE_AUDIT.md` are folded in below and
are all fixed.

---

## 0. The gap that defines this project

**What exists:** paste a YouTube/TikTok/Instagram link or upload a still → Claude returns one
structured cinematography breakdown → admin-verified breakdowns become a public SEO library and
RAG examples. There is a genuine closed learning loop (feedback → `learning_jobs` → distilled
`prompt_insights` → next system prompt).

**What the product vision requires:** upload a video → **detect every shot** → extract and pick
a representative frame per shot → analyse each shot → a searchable, filterable visual library of
*shots* → save, collect, sequence, share, export.

**The structural gap:** the current data model has no concept of a shot. One upload = one
`submissions` row = one breakdown. `lib/extract-frames.ts` grabs 3 stills at 10%/50%/90% and
analyses them as a *single* shot — and it **throws unconditionally on Vercel**
(`if (process.env.VERCEL) throw`), so video upload does not work in production at all.

So the core differentiator is not partially built. It is absent, and the one primitive it needs
(server-side ffmpeg) is explicitly disabled in production.

**Why that disable is now wrong:** it was written against Vercel's old 250 MB function limit.
The limit is 5 GB on Fluid Compute and the default timeout is 300 s. `@ffmpeg-installer/ffmpeg`
is 35 MB. Real server-side shot detection is viable on the existing host. This unblocks Phase 1.

---

## 1. Architecture decisions

### 1.1 `shots` becomes the canonical unit — no parallel corpus

New: `videos` (an ingested source) and `shots` (a detected shot). Every ingest path — video
upload, still upload, platform link — produces one `videos` row and one-or-many `shots`.
A still or a link is simply a video with a single shot. **Everything downstream (library,
search, save, collections, sequences, sharing, export, SEO) reads `shots` and only `shots`.**

`submissions` is **backfilled into `videos` + `shots`** (all 41 rows, preserving breakdown,
embedding, tags, slug, thumbnail, frames, ratings, view counts) and then retained read-only so
`/breakdown/[id]` links and the feedback audit trail keep resolving. New code never writes it.
`breakdown_feedback` and `conversations` gain `shot_id`, backfilled.

Rejected: keeping submissions as a second shot corpus. It would force every search, collection
and export to union two tables — the "architecturally weak, patch the symptom" failure the brief
forbids.

### 1.2 Collections and sequences share one table, not two

`collections` with `kind ∈ ('collection','sequence')` and a self-referencing `parent_id` for
hierarchy; `collection_items` carries `position` + `note`. A sequence is a collection whose
order is meaningful and whose UI exposes shot numbers, notes and reordering. This satisfies
Phases 13/14/15 without the duplicate tables the brief warns against.

### 1.3 Metadata schema extends, never replaces

`BreakdownSchema` already covers shot type, angle, lens, focal length, DOF, lighting, colour,
movement, tags — and it drives the prompt, the RAG examples, the learning loop and the UI. It is
**extended** with the vision's missing sections (composition, environment, subject, mood,
description, why-it-works, camera height, symmetry, depth) as optional fields, so all 39 existing
verified breakdowns stay valid and the learning loop keeps working.

Every AI-estimated optical value (focal length, aperture, sensor) renders behind an explicit
**Estimated** label. Non-negotiable per Phase 5.

### 1.4 Durable jobs reuse the pattern already in the repo

`learning_jobs` + `claim_learning_jobs()` (`FOR UPDATE SKIP LOCKED`, attempts, max_attempts,
dedupe key, backoff) is a correct queue that already exists. `processing_jobs` mirrors it rather
than inventing a second mechanism.

Long videos exceed any single function invocation, so a job runs **one stage then re-enqueues the
next**: `detect_shots → extract_frames → analyze_shots (batched, resumable) → index → complete`.
Each stage is idempotent and restartable, so nothing depends on a browser staying open.

### 1.5 Search is hybrid, not vector-only

Structured filters (SQL on typed columns) ∩ full-text (`tsvector`) ∪ semantic (pgvector) with
reciprocal-rank fusion. Real embeddings only — `embed()` currently fails open and returns `null`,
silently making a shot invisible to retrieval forever. That becomes a hard, retried, tracked
failure.

---

## 2. Findings carried forward from the security audit

Re-verified against current code; all still present.

| ID | Severity | Finding |
|---|---|---|
| C-1 | CRITICAL | Prototype pollution via `overlayBreakdown` dotted path (`lib/overlay.ts:12`), persisted and replayed on every render |
| C-2 | CRITICAL | Any 3 users can force another user's private breakdown public (feedback INSERT policy has no visibility predicate + auto-verify trigger) |
| H-1 | HIGH | `/api/library/search` — unauthenticated, unmetered OpenAI spend |
| H-2 | HIGH | `/api/submissions/[id]/retry` — unmetered Claude spend, no cap |
| H-3 | HIGH | `/ask` turn cap is per conversation, so unbounded per user across library items |
| H-4 | HIGH | Processing bound to the HTTP invocation; only recovery is a once-daily sweep |
| H-5 | HIGH | Open redirect: `next=//evil.com` passes the `startsWith("/")` check |
| H-6 | HIGH | `embed()` fails open → shot permanently unretrievable, nothing alerts |
| H-7 | HIGH | `detectLinkSource` substring-matches the whole URL; no SSRF guard on server-side image fetches |
| H-8 | HIGH | No UPDATE/DELETE policy on `submissions`; **no way for a user to delete their data** |
| M-1…M-10 | MEDIUM | Broken history thumbnails, infinite poller, credit charged before insert, no stage progress, `rating_avg` always undefined, host-header-controlled Stripe URLs, public rows leak `user_id`/`file_path`/`embedding`, no version history, view-count inflation, learning worker starved by cron cadence |

Absent entirely: rate limiting, analytics, tests, account deletion, export, error monitoring.

---

## 3. Ranked work

### CRITICAL — must ship before any public launch

| # | Item | Phase |
|---|---|---|
| K1 | Real server-side shot detection + frame extraction (remove the Vercel throw) | 1, 3, 4 |
| K2 | `videos`/`shots` data model + backfill of all existing content | 24 |
| K3 | Durable staged `processing_jobs` queue + worker; survives browser close | 1 |
| K4 | Per-shot Claude analysis producing the full metadata schema | 5 |
| K5 | Real per-shot embeddings, failing loudly and retried | 10 |
| K6 | C-1 prototype pollution + stored-row cleanup | 23 |
| K7 | C-2 authorization: feedback visibility predicate, remove auto-publish | 23 |
| K8 | RLS on every new table, proven by cross-user tests | 23, 32 |
| K9 | Rate limiting on every endpoint that spends money | 23 |
| K10 | H-5 open redirect; H-7 SSRF `safeFetch` + hostname allowlist | 23 |
| K11 | Account + video + shot deletion, with defined cascade | 33 |
| K12 | Upload UX with real progress and terminal states — no infinite spinner | 2, 31 |

### HIGH — launch-quality product

| # | Item | Phase |
|---|---|---|
| H01 | Visual-first shot library grid (image-dominant, dense, minimal chrome) | 7 |
| H02 | Shot detail view: large frame, compact metadata sections, Estimated labels | 6 |
| H03 | Hybrid search (filters ∩ FTS ∪ vector) with URL-synced state | 8, 9, 10 |
| H04 | Find Similar | 11 |
| H05 | Save / My Shots | 12 |
| H06 | Collections + nested hierarchy | 13, 14 |
| H07 | Sequences with ordering and notes | 15 |
| H08 | Video view: player + shot markers + shot grid | 16 |
| H09 | Sharing with public tokens; private stays private | 18 |
| H10 | Representative-frame override (scrub + choose) | 4, 17 |
| H11 | Metadata editing with correction tracking | 17 |
| H12 | Export: PDF contact sheet, CSV, JSON | 19 |
| H13 | Critical-path tests incl. RLS cross-user suite | 32 |
| H14 | Analytics events | 25 |

### MEDIUM

SEO shot/taxonomy pages (20, 21) · marketing landing page (34) · performance: thumbnails,
lazy loading, pagination, indexes (22) · mobile (29) · accessibility (30) · error states (31) ·
onboarding (26) · keyboard shortcuts (28) · legal copy for uploads and AI processing (33) ·
server-side plan limits (35).

### LOW

Version history · presentation/treatment exports · admin analytics · lint cleanup.

---

## 4. Stage sequence

Each stage ends with `tsc` + `lint` + `build` clean and the new path exercised for real against
the local Supabase instance. No stage is "done" because a UI renders.

1. **Security base** — C-1, C-2, H-5, H-7, rate limiter, RLS hardening. Fix before building on
   top, so the new surface inherits a correct base rather than a durable vulnerability.
2. **Data model** — `videos`, `shots`, `shot_frames`, `collections`, `collection_items`,
   `saved_shots`, `shares`, `processing_jobs`, `shot_edits`, `analytics_events`, `rate_limits`;
   RLS + indexes; backfill from `submissions`.
3. **Pipeline** — ffmpeg shot detection, frame extraction, representative-frame selection,
   per-shot analysis, embeddings, staged worker, retries, idempotency.
4. **Upload & progress** — real upload UX, live stage reporting, terminal states, retry.
5. **Library & shot detail** — the visual-first surface.
6. **Search** — filters, FTS, vector, fusion, URL state, Find Similar.
7. **Organisation** — save, collections, hierarchy, sequences.
8. **Video view** — player, markers, shot grid.
9. **Sharing & export** — tokens, public pages, PDF/CSV/JSON.
10. **SEO & marketing** — shot pages, taxonomy pages, landing page.
11. **Quality** — tests, analytics, performance, mobile, a11y, error states, polish.
12. **End-to-end launch test** — zero-data new-user run through all 30 steps of Phase 37.

---

## 5. Explicit non-goals for this pass

- Rebuilding the Claude integration, storage model, billing triggers, cron auth, or the
  knowledge/learning loop. All four were read end-to-end and are correct.
- Replacing Supabase or the host.
- Complex pricing. Limits are enforced server-side against the existing free/pro flag.
- Anything that produces a UI without a working backend path behind it.

---

## 6. Known risks

- **Long-video processing cost and duration.** Mitigated by staged jobs, a shot cap per video,
  and server-enforced duration/size limits by plan.
- **Backfilling 41 live rows.** Migration is additive and idempotent; `submissions` is left
  intact so it is reversible.
- **Cron cadence on Vercel Hobby** (1 job/day) starves any queue. The worker is designed to be
  driven by `after()` on write plus cron; a sustained backlog needs a paid plan or an external
  pinger. Flagged to the operator rather than silently worked around.
- **Removing crowd auto-publish** changes how the public library fills. Intentional — it is the
  C-2 exploit primitive, and admin review already exists.
