# ShotBreakdown

Upload a segment of a video, say what you want to know about it, and get one breakdown of that
segment covering every film department.

Never a whole film — the scene, the sequence, the ten seconds you keep rewinding. Every shot inside
the segment is detected from the footage itself, the strongest frame of each is extracted and
analysed (camera, lens, lighting, colour, environment, subject, mood), and the segment comes back as
one document: what happens in it, how the shots are built and cut together, and what the director,
camera, lighting and grip, art department, editorial, colour, VFX, sound and production each have to
do to recreate it. Saying what you want to know is optional — ask about the grade, the coverage, the
sound design, or ask nothing and get everything.

Segment length and shot count are capped by plan in `lib/plans.ts`. Uploads are private by default
and served through signed URLs.

## Stack

- **Next.js 16** (App Router, React 19, Tailwind v4)
- **Supabase** — magic-link auth, Postgres + pgvector, private storage
- **ffmpeg / ffprobe** — shot detection, frame extraction, representative-frame selection
- **Anthropic `claude-sonnet-4-6`** — shot analysis via structured outputs
- **OpenAI `text-embedding-3-small`** — semantic search over your own shots
- **Stripe** — Pro subscriptions
- **Vercel** — hosting and cron

## Getting started

```bash
npm install
cp .env.example .env.local          # fill in the values below
npx supabase start                  # local Postgres + auth + storage
npm run db:migrate                  # apply migrations, reload PostgREST schema
npm run dev                         # http://127.0.0.1:3002
npm run worker                      # in a second terminal: processes the job queue
```

`npm run worker` is only needed locally. In production the same code runs from `/api/worker` on a
two-minute cron, plus a warm-start kicked off by the submit request.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only; pipeline and admin operations |
| `DATABASE_URL` | yes | Direct Postgres URL, used by `npm run db:migrate` |
| `ANTHROPIC_API_KEY` | yes | Shot analysis |
| `OPENAI_API_KEY` | yes | Embeddings — search and Find Similar stop working without it |
| `CRON_SECRET` | yes | Authorises `/api/worker` and `/api/cron/*` |
| `NEXT_PUBLIC_SITE_URL` | yes | Canonical URLs, share links, OG tags |
| `STRIPE_SECRET_KEY` `STRIPE_PRICE_ID` `STRIPE_WEBHOOK_SECRET` | for billing | In-app Pro upgrade |
| `SENTRY_DSN` | optional | Error monitoring. Without it, failures still go to stdout |
| `SERPER_API_KEY` | optional | Web research for clip context |

## Feature flags

Everything that needs footage the user did not upload — a public corpus, an editorial library, the
SEO surfaces built on top of one — is switched off rather than deleted. It is all built and tested;
each flag is one environment variable away from coming back. The flags live in `lib/features.ts`.

**Every flag defaults to off.** Set `FEATURE_<NAME>=1` to enable one. What "off" does is
per-surface, not uniform: a dedicated page (`/tags/[tag]`, `/learn/[topic]`, the taxonomy pages,
`/onboarding`, the admin consoles) calls `notFound()` before it queries anything; `/library` still
renders, scoped to your own shots; `/api/shots/search` coerces an anonymous caller to 401 and a
signed-in caller's scope to their own shots rather than refusing; `/api/videos` returns 400 for a
pasted link or a still upload. `FEATURE_SIMILAR_SHOTS` only hides the panel on the shot page —
`/api/shots/[id]/similar` has no flag check and is still reachable.

| Variable | Re-enables |
|---|---|
| `FEATURE_PUBLIC_LIBRARY` | The public shot library: the `All shots` scope on `/library`, anonymous search, public shot pages and the shot URLs in the sitemap. (The homepage shot grid the flag comment mentions no longer exists — `app/page.tsx` is a static marketing page and reads no data.) |
| `FEATURE_TAXONOMY_PAGES` | Programmatic technique pages under `/camera-movements`, `/lighting` and the rest of `TAXONOMY_GROUPS` |
| `FEATURE_TAG_PAGES` | `/tags/[tag]` pages |
| `FEATURE_LEARN_PAGES` | `/learn/[topic]` articles |
| `FEATURE_SIMILAR_SHOTS` | The "Visually similar" panel on the shot page — meaningless over one user's own shots. The `/api/shots/[id]/similar` route is flagged too and returns 404 for everyone while off |
| `FEATURE_ONBOARDING` | The `/onboarding` interstitial. Off, new users go straight to the app |
| `FEATURE_ADMIN_REVIEW` | `/admin/review`, the editorial queue that publishes shots to the library |
| `FEATURE_ADMIN_LEARNING` | `/admin/learning`, the knowledge-ingestion console |
| `FEATURE_LINK_SOURCES` | Pasting a YouTube / TikTok / Instagram link. That path analyses the cover frame as a single shot, which cannot answer "what happens in this segment" |
| `FEATURE_STILL_UPLOADS` | Uploading a still image instead of a video segment. Same reason |

`lib/features.ts` is **server only**. Next.js inlines `process.env` into client bundles for
`NEXT_PUBLIC_*` names only, so a client component that imported it would read `undefined` and see
every flag as false. Read the flag in a server component and pass it down as a prop.

## Architecture

**`shots` is the canonical unit.** Every ingest creates one `videos` row and one-or-many `shots`.
Library, search, saving, collections, sequences, sharing and export all read `shots` and nothing
else. Video upload is the only ingest at launch; the still-upload and platform-link paths are behind
`FEATURE_STILL_UPLOADS` and `FEATURE_LINK_SOURCES`.

**Processing is durable and staged.** `processing_jobs` mirrors the existing `learning_jobs`
pattern (`FOR UPDATE SKIP LOCKED`, attempts, dedupe key, backoff). A job runs one stage and
enqueues the next: `ingest_video → analyze_shots → finalize_video`. Ingest is resumable mid-video,
so a long upload survives a function timeout. Nothing depends on a browser staying open.

**Search is hybrid.** Structured facet filters ∩ (Postgres full text ∪ pgvector), fused with
reciprocal rank fusion in `search_shots()`. Facets are generated columns over the metadata JSON, so
there is one source of truth and no drift.

**Every optical estimate is labelled.** Focal length, aperture, sensor format and lens character
cannot be measured from an image. They are surfaced as `EST` throughout and users can correct any
field; corrections are stored separately from the original record and feed the nightly prompt
distillation.

## Commands

```bash
npm run dev              # dev server on :3002
npm run worker           # local processing worker
npm run build            # production build
npm test                 # unit + integration (integration needs local Supabase)
npm run e2e:journey path/to/clip.mp4   # full new-user journey over real HTTP
npm run pipeline:smoke path/to/clip.mp4 # upload → detect → analyse → index
npm run e2e:smoke        # embeddings, RAG and search health
npm run db:migrate       # apply SQL migrations
npm run db:seed              # report new YouTube references that would be added
npm run db:seed:analyze      # ingest them as public editorial shots (Claude + embeddings)
npm run db:enrich-shots      # backfill facets on shots analysed before the facet schema
```

The `db:seed` scripts fill the public corpus, so they are only useful with
`FEATURE_PUBLIC_LIBRARY=1`.

## Testing

- `tests/security.test.ts` — prototype pollution, open redirect, SSRF guards, host matching
- `tests/pipeline.test.ts` — shot segmentation, timecodes, colour normalisation, schema budget
- `tests/integration.test.ts` — RLS cross-user isolation, rate limiter, job queue (real database)
- `scripts/e2e-journey.ts` — the whole product over real HTTP. Checks that belong to a flagged-off
  feature skip themselves and print the flag that skipped them; a skip is never counted as a pass

## Deployment

Vercel, with two crons in `vercel.json`: `/api/worker` every two minutes (processing) and
`/api/cron/daily` (stalled-video recovery, rate-limit pruning, the nightly learning tick).

**The two-minute worker cron requires a paid Vercel plan.** On Hobby, cron is limited to one run
per day, which is not enough to drain a processing queue — use an external pinger against
`/api/worker` with the `CRON_SECRET` bearer token (`npm run worker:ping`, or the
`.github/workflows/worker-ping.yml` Action with `SITE_URL` and `CRON_SECRET` secrets), or upgrade.
