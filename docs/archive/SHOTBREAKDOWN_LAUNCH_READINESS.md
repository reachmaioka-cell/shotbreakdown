# ShotBreakdown — Launch Readiness

**Date:** 2026-08-23
**Verified against:** local Supabase (24 migrations applied), running dev server, real Anthropic
and OpenAI calls, real ffmpeg, real Stripe config.

Every claim below was checked by running the thing, not by reading the code. Where something is
unverified or unfinished it says so.

---

## What changed, in one paragraph

The product was a single-shot analyser: paste a link or upload a still, get one cinematography
breakdown. The vision needed a shot library: upload a video, detect every shot, analyse each one,
search the result. That capability did not exist — and `lib/extract-frames.ts` threw
unconditionally on Vercel (`if (process.env.VERCEL) throw`), so video upload did not work in
production at all. The data model has been rebuilt around `shots` as the canonical unit, a real
ffmpeg shot-detection and frame-selection pipeline now runs as durable staged background jobs, each
shot is analysed and embedded, and the whole product surface — library, search, save, collections,
sequences, video view, sharing, export, SEO — was built on top of it. The existing knowledge/RAG
corpus, learning loop, auth, storage model, billing triggers and cron auth were preserved and
re-pointed at the new model rather than replaced.

---

## COMPLETED

Verified end to end. `scripts/e2e-journey.ts` runs 58 assertions over real HTTP against a real
server, real storage and real AI: **58 passed, 0 failed**.

### Core loop

| Capability | Status | How it was verified |
|---|---|---|
| Video upload | Working | Real 1.1 MB file to private storage, progress, cancel, retry, terminal states |
| Durable processing | Working | Job survives with no browser attached; killing a worker mid-run recovers |
| Shot detection | Working | ffmpeg scene detection; on a synthetic 5-cut clip, boundaries land at exactly 3.00/6.00/9.00/12.00s in 184 ms |
| Frame extraction | Working | 5 candidates + ffmpeg `thumbnail` pick per shot; 30 frames stored for a 5-shot video |
| Representative frame | Working | Scored on detail, exposure and tonal range; user override tested and persisted |
| Shot analysis | Working | Claude `claude-sonnet-4-6` structured output, full facet set per shot |
| Embeddings | Working | `text-embedding-3-small`, 5/5 shots indexed; failure is loud and retried |
| Indexing → complete | Working | Video reaches `complete` with `analyzed_shot_count == shot_count` |

### Product surface

- **Visual library** — image-first grid, facet rail with live counts, infinite scroll, URL-synced
  state, keyboard navigation. 2 columns on a phone, up to 7 at 1440px.
- **Shot detail** — large frame, compact metadata grouped into Camera / Composition / Lens /
  Lighting / Colour / Environment / Subject, progressive disclosure, `EST` on every optical value,
  Why It Works, tags, Ask, Find Similar.
- **Search** — hybrid: structured filters ∩ (Postgres FTS ∪ pgvector), fused by reciprocal rank.
  `"moody nighttime portrait"` returns low-key dusk MCUs with no literal term overlap.
- **Filters** — 21 facet groups, all URL parameters, combinable with search, individually and
  globally clearable.
- **Find Similar** — vector similarity over the full facet-rich embedding.
- **Save / My Shots** — one click, optimistic, server-tracked, plan-capped.
- **Collections + nesting** — one table with `kind` and `parent_id`; cycle-checked in the database.
- **Sequences** — ordered, drag-and-drop and arrow reordering, per-shot notes, shot numbers.
- **Video view** — player, timeline marked with every detected shot, click-to-seek, shot grid,
  live progress with real stage names.
- **Sharing** — unguessable tokens; shared pages work logged out; revoking returns the item to
  private.
- **Export** — PDF contact sheet (written directly, no PDF dependency), CSV and JSON. Verified as a
  valid 1-page PDF with an embedded JPEG.
- **AI quality control** — every enum facet editable, tags addable/removable, representative frame
  changeable, all corrections recorded in `shot_edits` and fed to the nightly prompt distillation.
- **Deletion** — video deletion removes source, frames, shots and collection entries; account
  deletion cancels the subscription and removes everything.

### Preserved from the previous product

The closed learning loop (corrections → distillation → `prompt_insights` → next analysis prompt),
the pgvector knowledge corpus (168 articles, 227 chunks), Claude structured outputs, the private
storage model, the billing-column protection triggers, fail-closed cron auth, and the follow-up
Ask feature — all kept and re-pointed at `shots`. Published shots now distil into the knowledge
corpus via a new `distill_shot` job, so the library compounds.

---

## REMAINING

Real gaps, stated plainly.

1. **Error monitoring.** Failures go to `console.error`. Sentry or equivalent is not wired.
2. **Recreation guide on new shots.** New shots carry the facet record; the deeper recreation guide
   (ordered steps, budget tiers, common mistakes) exists only on the 39 backfilled editorial shots.
   Generating it on demand per shot is designed but not built.
3. **Two editorial shots have no facets** (37/39 enriched) — their YouTube thumbnails are no longer
   fetchable.
4. **Playwright browser tests.** Coverage is unit + integration + a scripted HTTP journey; there is
   no real-browser click-through suite.
5. **Backfilled shots keep the retired composition fields** (`subject_position`, `symmetry`,
   `foreground`, `background`). They render, they are just shaped differently from new shots.

---

## SECURITY

### Found and fixed

| Severity | Issue | Fix | Proof |
|---|---|---|---|
| CRITICAL | **Prototype pollution.** `overlayBreakdown` walked a user-supplied dotted path and wrote into a cloned object; `__proto__.x` reached `Object.prototype` for the whole Node process, was persisted, and re-fired on every render of that breakdown. | Paths are allowlisted against the schema (85 valid paths, derived so they cannot drift) and `__proto__`/`prototype`/`constructor` are rejected. Poisoned keys stripped from existing rows by migration. | 9 unit tests; journey step 12 |
| CRITICAL | **Forced publication.** The `breakdown_feedback` INSERT policy checked only that you were inserting your own `user_id`. Three accounts rating a stranger's private draft 5 stars auto-published it to the public library and into the RAG corpus. | INSERT policy now requires the target be readable by the actor; auto-verify removed from the rating trigger — publication is an editorial decision. | Migration 0016 |
| CRITICAL | **Viewer spoofing in search.** *(introduced by this work, caught by its own test)* `search_shots`, `similar_shots`, `match_shots` and `shot_facet_counts` are SECURITY DEFINER and took the viewer id as a parameter, so an authenticated client calling them directly through PostgREST with `p_viewer=<someone else's id>&p_scope=mine` read that user's private shots. | The viewer is derived from `auth.role()`/`auth.uid()` for client roles; the parameter is honoured only for `service_role`. | 4 integration tests, all asserting `[]` |
| HIGH | **Open redirect.** `next=//evil.com` passed the `startsWith("/")` check, producing a protocol-relative URL at the highest-trust moment in the session. | Parsed and origin-checked; `//`, `/\`, and encoded variants rejected. | 7 unit tests; journey step 13 |
| HIGH | **SSRF surface.** `detectLinkSource` substring-matched the whole URL (`https://evil.example/?ref=youtube.com` was accepted as YouTube), and server-side image fetches had no host allowlist, private-IP blocking or redirect validation. | Hostname parsing with exact-suffix allowlist; `safeFetch` blocks loopback / RFC1918 / link-local / CGNAT / IPv6 ULA / `169.254.169.254`, re-validates every redirect hop, enforces timeout and byte ceiling. | 24 unit tests |
| HIGH | **Silent embedding failure.** `embed()` returned `null` on any error, so a shot was stored with no vector, was permanently invisible to retrieval, and nothing alerted. | Throws with a typed retryable flag, retries 429/5xx with backoff. `embedOptional` exists only for bulk ingest loops. | Journey; smoke test asserts 39/39 public shots indexed |
| HIGH | **No user data deletion.** `submissions` had no UPDATE or DELETE policy and there was no account-deletion path anywhere. | Owner UPDATE/DELETE policies, per-video deletion including storage objects, full account deletion with Stripe cancellation. | Journey steps 19–20 |
| HIGH | **No rate limiting anywhere.** `/api/library/search` called OpenAI with no auth and no limit; retry re-ran a full Claude analysis with no credit check; the Ask turn cap was per conversation and therefore unbounded per user across a public library. | Postgres fixed-window limiter with an atomic single-statement increment, applied to all 16 spending or writing endpoints. Ask moved to a per-user rolling daily budget. | 3 integration tests including a 10-way concurrent race |
| MEDIUM | **Public rows leaked internals.** The `status='verified'` policy granted `select *` to anon, exposing `user_id`, `file_path`, `frame_paths`, `error_message` and `embedding`. | Public reads go through column-scoped views (`library_shots`, `public_shots`). | Integration test asserts absence |
| MEDIUM | **View-count inflation.** `POST /api/view` was unauthenticated with no dedupe. | Deduped per viewer per shot per day through the rate limiter; only public shots count. | Journey step 7 |

### Also hardened

- Pipeline-owned columns (`status`, `embedding`, counters, timecodes, `user_id`) rejected on client
  writes by database trigger, for owners too.
- Storage stays private; every read is a short-lived signed URL; owners can now delete their own
  objects.
- Sharing promotes private → unlisted, never → public; revoking returns it to private and cascades
  to a video's shots.
- Analytics accepts only known event names; no IP or user agent is stored; rows are scrubbed on
  account deletion.
- CSV export escapes leading `= + - @` to prevent spreadsheet formula injection.
- Export runs through the same authorization as the page, so it cannot widen access.
- Service-role key confirmed server-only; no secret reaches the browser.

### Cross-user isolation, proven

`tests/integration.test.ts` signs in two real users against the real database and asserts a second
user cannot read, update, delete, insert-as, save-as, search, or facet-count another user's private
video, shot or collection — and cannot promote themselves to admin or Pro. Twenty assertions.

---

## PERFORMANCE

**Found and fixed**

- **Full-resolution frames in grids.** Every shot now stores a 640 px thumbnail alongside the
  1280 px frame; grids use the thumbnail, detail views the frame.
- **Full-resolution decode for shot detection.** Detection runs on a 320 px, 12 fps copy — a 15 s
  clip is analysed in 184 ms.
- **Missing indexes.** Added HNSW on `shots.embedding`, GIN on the search vector, tags, subjects,
  moods and colours, plus composite facet and status indexes.
- **Search fan-out.** One SQL function does filters, FTS, vector and fusion, and returns the total
  count in the same query — no N+1 and no second count round-trip.
- **Facet counts recomputed per request** over the same visibility rules, so counts never promise
  results the viewer cannot see.
- **Images** — AVIF/WebP, a 24-hour derivative cache, and device/image size sets tuned to the
  actual grid breakpoints.
- **Taxonomy and tag pages are statically generated** with a 1-hour revalidate; they no longer read
  cookies, which was forcing them dynamic.
- **Pagination** — 48 per page with intersection-observer paging; no unbounded query anywhere.

**Known cost**

Per-shot analysis is one Claude vision call plus one embedding. A 5-shot clip took ~116 s
end-to-end on a cold local worker. A 120-shot video is capped by plan and processed in resumable
batches.

---

## AI / VIDEO PIPELINE

**Production status: working, staged, resumable.**

```
upload → ingest_video ────────────────────────► analyze_shots ──► finalize_video
         probe · detect cuts · segment            per shot:          verify all
         extract 5 candidates/shot                Claude vision      shots settled
         score + pick representative              → facets           set complete
         store frame + thumbnail                  → embedding        or failed
         (resumable mid-video)                    (time-budgeted)
```

- **Detection**: ffmpeg scene score at 0.3 on a downscaled copy. Runs under 1 s for short clips.
  Sub-0.8 s runs are merged (flash frames are not shots); held takes over 30 s are subdivided so a
  locked-off shot still yields usable references; capped at 40 shots (free) / 120 (Pro).
- **Representative frame**: ffmpeg's `thumbnail` filter proposes the histogram-most-representative
  frame; it competes with evenly spaced candidates on a score combining JPEG detail, exposure
  distance from mid-grey, and tonal range. Every candidate is kept so the user can override.
- **Analysis**: first / representative / last frame per shot, so the model has motion evidence
  without paying for every candidate. Published shots are retrieved as few-shot examples.
- **Durability**: `FOR UPDATE SKIP LOCKED` claim, attempts with exponential backoff, dedupe keys,
  heartbeats, stalled-job reclaim, and stalled-*shot* reclaim. Verified: a shot force-stalled in
  `analyzing` with a 20-minute-old timestamp was recovered and the video reached `complete`.
- **Idempotency**: re-running ingest skips shots that already have frames; `content_hash` is
  uniquely indexed per user so a double-submit resolves to the existing video.

**Two real pipeline bugs were found by testing and fixed:**

1. **Clock skew made jobs unclaimable.** `scheduled_at` was set from the app server's clock. The
   app ran ~57 ms ahead of the database, so "immediate" jobs were briefly in the future and the
   claim query skipped them — intermittently, which is the worst kind. Immediate jobs now let the
   column default to the database's `now()`.
2. **Analyze/finalize ping-pong.** A shot stuck in `analyzing` was invisible to `analyze_shots`
   (which selected only `pending`/`failed`) but counted as outstanding by `finalize_video`, so the
   two stages bounced the video between them forever. Stale `analyzing` shots are now released, and
   finalize hands back at most five times before settling the video.

**Structured-output grammar ceiling.** The analysis schema sits near Anthropic's compiled-grammar
limit; adding one optional array once pushed it over and every shot failed with a 400. The schema
was reduced (sparse prose fields consolidated, an unused confidence score dropped) to 5,590 bytes
against a measured failure point of ~5,941, and a test now fails the build if it grows past 5,800.
Measured against the live API, not guessed.

---

## SEARCH

**Status: hybrid, real, and honest about degradation.**

- Structured facet filters always apply. 21 groups, all URL parameters.
- A query adds Postgres full text (weighted: description and summary A, title and tags B, why-it-
  works and location C) **and** pgvector semantic search, fused by reciprocal rank with a slight
  bias toward semantic.
- The embedding is built description-first from every facet family, which is why
  `"moody nighttime portrait"` returns low-key dusk medium-close-ups with no literal overlap.
- Verified live: `"moody nighttime portrait"` → 24 results, semantic on; `shot_size=close-up` ∩
  `lighting_key=low-key` → 3 results; `q=neon` ∩ `color_temperature=cool` → 8.
- If the embedding provider fails, keyword results still return **and the UI says semantic search
  is unavailable**, rather than silently returning worse results.
- Colour was fragmenting into dozens of near-duplicate free-text values ("dark brown", "deep
  brown", "near black", "charcoal"). Colours are normalised to 16 canonical families for filtering
  while the model's descriptive names are kept for display. 38 existing shots renormalised.

---

## SEO

- **Shot pages** `/shots/[slug]` — unique title and description from the analysis, canonical, Open
  Graph with the actual frame, Twitter card, `ImageObject` structured data. Private and unlisted
  shots are `noindex, nofollow`.
- **Taxonomy pages** — 7 groups, 32 curated entries across camera movement, shot size, lighting,
  mood, colour, lens and time of day. Statically generated, 1-hour revalidate. Each carries real
  written craft explanation, the matching shots, related pages and cross-group links.
- **Thin-page protection** — a taxonomy or tag page with fewer than 3 shots renders `noindex` and
  is excluded from the sitemap. Quality over quantity, enforced in code.
- **Sitemap** — 97 URLs, only genuinely public and populated pages.
- **robots.txt** — blocks `/api/`, `/admin`, `/s/`, `/videos`, `/collections`, `/upload`,
  `/settings`, `/onboarding`, `/history`, `/breakdown/`, `/auth/`.
- **Filtered library views are `noindex, follow`** — a view of the library, not its own page.
- **Legacy URLs preserved** — `/library/[slug]` and `/breakdown/[id]` 301 to the new shot pages,
  because the backfill kept the slugs.
- **Landing page** — `SoftwareApplication` and `FAQPage` structured data, real product frames,
  six-step explanation, five honest FAQs.

---

## TESTING

**111 automated tests, plus a 58-assertion end-to-end journey. All passing.**

| Suite | Tests | What it covers |
|---|---|---|
| `tests/security.test.ts` | 48 | Prototype pollution, path allowlist, open redirect, private-address blocking, host allowlist, source detection |
| `tests/pipeline.test.ts` | 34 | Shot segmentation (merge, split, caps, edge cases), aspect ratios, timecodes, colour canonicalisation, record normalisation, embedding text, grammar budget |
| `tests/integration.test.ts` | 29 | RLS cross-user isolation (20), rate limiter incl. a concurrent race, job queue lifecycle and SKIP LOCKED |
| `scripts/e2e-journey.ts` | 58 | Signup → upload → processing → shots → search → save → similar → collections → nesting → sequences → reorder → share → logged-out access → cross-user denial → pollution → redirect → corrections → frame override → exports → plan limits → return later → delete video → delete account |
| `scripts/pipeline-smoke.ts` | — | Upload → detect → extract → analyse → embed → index, asserting every shot has frames, facets, a thumbnail and a vector |
| `scripts/e2e-smoke.ts` | 9 | Embeddings, RAG, chunking, shot search, facet filtering, full index coverage |

CI runs types, lint, unit tests and build on every push. The integration suite skips itself when no
Supabase instance is configured.

**Tests that caught real bugs during this work:** the integration suite caught the viewer-spoofing
hole in code written the same day; the journey caught the clock skew, the save-count trigger
conflict, and the analyze/finalize ping-pong.

---

## KNOWN ISSUES

1. **Two editorial shots lack facets** — their source thumbnails no longer resolve. They appear in
   text and vector search but not in filtered search.
2. **No error monitoring.** Failures are logged to stdout only.
3. **The analysis schema has ~350 bytes of headroom** before the grammar ceiling. Roughly 6–8 more
   fields. The guard test fails the build first, but a future facet may require trading another out.
4. **Colour normalisation loses nuance in the filter** — "deep teal" and "pale teal" both file
   under `teal`. The descriptive name survives on the shot page; only the facet is coarse.
5. **Very long videos are capped**, not streamed — 30 minutes and 120 shots on Pro. A feature
   film needs chunked ingest that does not exist yet.
6. **`submissions` and its learning jobs are still referenced** by the older knowledge-distillation
   paths. They work, but there are two distillation paths (`distill_submission` for the legacy
   corpus, `distill_shot` for new content) where there should eventually be one.

---

## LAUNCH BLOCKERS

Two, both operational rather than code.

1. **The two-minute worker cron requires a paid Vercel plan.** Hobby allows one cron run per day,
   which cannot drain a processing queue — a user's video would sit unprocessed for up to 24 hours.
   Either upgrade, or point an external pinger at `/api/worker` with the `CRON_SECRET` bearer
   token. The code is correct either way; this is a hosting decision that must be made before
   anyone uploads. Flagged rather than worked around.
2. **Production environment variables must be set and verified**, in particular `OPENAI_API_KEY`
   (search and Find Similar fail loudly without it), `CRON_SECRET` (the worker refuses to run
   without it — fails closed, correctly), and `NEXT_PUBLIC_SITE_URL` (share links and canonicals
   are wrong without it). Run `npm run e2e:smoke` against production after deploying.

Everything else on the definition-of-done list is done and verified.

---

## POST-LAUNCH

Deliberately deferred, with reasons.

- **Error monitoring (Sentry).** A wiring task, not a design one; needs a production DSN.
- **On-demand recreation guide per shot.** Designed (the schema and prompt exist for it); not built
  because generating it for all 120 shots of an upload is wasteful, and generating it on demand
  needs its own job type.
- **Playwright suite.** The scripted HTTP journey covers the same paths at lower cost; a real
  browser adds value for drag-and-drop and focus management specifically.
- **Chunked ingest for feature-length video.** Only worth building once someone asks.
- **Team accounts and shared collections.** No data model work has been done; would need a
  `memberships` table and a rethink of every RLS policy.
- **Consolidating the two distillation paths.** Waiting until the legacy submissions corpus is no
  longer the majority of the knowledge base.
- **Learning from corrections influencing behaviour automatically.** Corrections are recorded and
  distilled into the prompt nightly, which is real. Anything stronger would be a claim the system
  does not currently earn.

---

## FINAL SCORES

| Dimension | Score | Reasoning |
|---|---|---|
| Product readiness | **8/10** | The core loop works end to end and the surface around it is complete. Held back by the missing per-shot recreation guide and by a library that is still small. |
| Technical readiness | **8/10** | Durable staged jobs, resumable ingest, idempotency, proven recovery. Held back by no error monitoring and the tight schema headroom. |
| Security | **9/10** | Three CRITICALs fixed and regression-tested, cross-user isolation proven against a real database, every spending endpoint metered. Held back only by the absence of production monitoring and a live-instance penetration test. |
| UX | **8/10** | Image-first, dense, fast, keyboard-friendly, accessible contrast, honest labelling of estimates. Held back by a landing hero with a lot of empty space and no browser-tested drag-and-drop. |
| Search | **9/10** | Genuinely hybrid, honest when degraded, canonical facet vocabulary, URL-addressable. Held back by coarse colour families. |
| AI / video pipeline | **8/10** | Real detection with exact boundaries, principled frame selection, resumable staged analysis, verified recovery from a stalled shot. Held back by the grammar ceiling and the per-video shot cap. |
| SEO | **8/10** | Real content, structured data, thin-page protection, legacy 301s, correct private-content exclusion. Held back by a library too small to rank yet. |
| Performance | **8/10** | Thumbnails everywhere, lazy loading, static taxonomy pages, one-query search, real indexes. Held back by unmeasured production Core Web Vitals. |
| **Overall launch readiness** | **8/10** | Ready to launch once the worker cadence is resolved. |

---

## TOP 10 NEXT ACTIONS

Ranked by impact.

1. **Resolve the worker cadence** — paid Vercel cron or an external pinger on `/api/worker`.
   Nothing else matters if uploads sit unprocessed. *(Launch blocker.)*
2. **Set and verify production environment variables**, then run `npm run e2e:smoke` and one real
   upload against production. *(Launch blocker.)*
3. **Wire error monitoring** with alerts on failed processing jobs and provider errors — the
   pipeline is durable but currently silent about repeated failures.
4. **Seed the public library to a few hundred shots.** Search quality, Find Similar and every SEO
   page are all functions of corpus size; at 39 shots the product understates itself.
5. **Build the on-demand recreation guide** on the shot page. It is the strongest reason a working
   filmmaker returns, and the prompt and schema for it already exist.
6. **Measure production Core Web Vitals** on `/library` with a real corpus and a cold CDN.
7. **Add a Playwright pass** over sequence drag-and-drop, modal focus and mobile drawers — the
   paths the HTTP journey cannot reach.
8. **Instrument the funnel end to end** (landing → signup → first upload → first completion →
   first save → first collection) and watch where new users stop.
9. **Re-analyse the two editorial shots** whose thumbnails no longer resolve, or retire them.
10. **Consolidate the two distillation paths** once the shot corpus outgrows the legacy one, so
    there is a single answer to "where does knowledge come from".
