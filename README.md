# ShotBreakdown

Turn any video into a searchable cinematography reference library.

Upload a video → every shot is detected from the footage → the strongest frame from each shot is
extracted and scored → the cinematography of each shot is analysed (camera, lens, lighting, colour,
environment, subject, mood) → each shot is embedded and indexed → you search, save, collect,
sequence, share and export.

## Stack

- **Next.js 16** (App Router, React 19, Tailwind v4)
- **Supabase** — magic-link auth, Postgres + pgvector, private storage
- **ffmpeg / ffprobe** — shot detection, frame extraction, representative-frame selection
- **Anthropic `claude-sonnet-4-6`** — per-shot analysis via structured outputs
- **OpenAI `text-embedding-3-small`** — semantic search and Find Similar
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

## Architecture

**`shots` is the canonical unit.** Every ingest — video upload, still upload, platform link —
creates one `videos` row and one-or-many `shots`. Library, search, saving, collections, sequences,
sharing, export and SEO all read `shots` and nothing else.

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

## Testing

- `tests/security.test.ts` — prototype pollution, open redirect, SSRF guards, host matching
- `tests/pipeline.test.ts` — shot segmentation, timecodes, colour normalisation, schema budget
- `tests/integration.test.ts` — RLS cross-user isolation, rate limiter, job queue (real database)
- `scripts/e2e-journey.ts` — 58 assertions across the whole product, over real HTTP

## Deployment

Vercel, with three crons in `vercel.json`: `/api/worker` every two minutes (processing),
`/api/cron/daily` (stalled-video recovery, rate-limit pruning, learning), and `/api/cron/learning`.

**The two-minute worker cron requires a paid Vercel plan.** On Hobby, cron is limited to one run
per day, which is not enough to drain a processing queue — use an external pinger against
`/api/worker` with the `CRON_SECRET` bearer token (`npm run worker:ping`, or the
`.github/workflows/worker-ping.yml` Action with `SITE_URL` and `CRON_SECRET` secrets), or upgrade.
