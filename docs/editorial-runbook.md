# The editorial corpus: how it is built, curated and published

The library that ShotBreakdown launches with is a corpus of music-video shots nobody here
filmed. It is accumulated for weeks before launch, looked at one row at a time, and made public
in a single act on the day. This is how, and why it is shaped this way.

## Why it is private

A row stored with `visibility = 'public'` is readable by **anyone**, with no session and no
page of ours involved. The `shots public select` RLS policy is granted to `anon`, and the
publishable anon key ships in the browser bundle, so this works from a terminal:

```
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/shots?is_editorial=eq.true&visibility=eq.public&select=id,summary,metadata" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Measured on the local stack, that returned 114 rows with their full metadata. `FEATURE_PUBLIC_LIBRARY`
does not change it. The `editorialHidden()` helper in `lib/shots.ts` does not change it. Nothing
written in Next.js can, because none of it runs for that request.

So the corpus is stored **private**, and privacy is what hides it: an editorial row has no
`user_id`, so under RLS nobody is its owner and nobody but the service role can read it.

## The state machine

Curation and publication are separate axes on purpose, so Ken can approve for weeks while
nothing is exposed:

```
seeded   →  review_status = 'pending'    visibility = 'private'
approve  →  review_status = 'approved'   visibility = 'private'    (still invisible)
reject   →  review_status = 'rejected'   visibility = 'private'    (durable, auditable)
LAUNCH   →  npm run editorial:publish    visibility = 'public'  for approved rows only
            + FEATURE_PUBLIC_LIBRARY=1 for the listing, search and sitemap surfaces
```

`review_status`, `reviewed_at` and `reviewed_by` are on `shots` (migration
`0031_editorial_review.sql`) and are service-role-only, like every other pipeline-owned column.

## Seeding

```
npm run db:seed:music -- --dry-run --max-videos=1 --target=4     # resolve and detect, write nothing
npm run db:seed:music -- --max-videos=1 --target=4               # one video, four shots
npm run db:seed:music -- --target=100                            # a batch; at most one a day
```

Each run downloads the video, detects cuts, picks shots **spread across the whole runtime**
(not the first N — that built a corpus of intros and title cards), stores one still per shot as
a `shot_frames` row, analyses it, embeds it, and writes everything `private` /
`review_status = 'pending'`.

Measured cost: one vision call plus one embedding per shot, roughly $0.05–0.10 a shot, about
0.3 MB of storage a shot, and several hours of wall clock for a few hundred because the seeder
analyses serially. No segment breakdown is written for a seeded video: the editorial artefact is
the per-shot recreation guide, generated on demand, and a whole music video is not a segment.

## Curation

`/admin/review`, behind `FEATURE_ADMIN_REVIEW=1` and `profiles.is_admin`. Two tabs: the queue
(`is_editorial and review_status = 'pending'`) and the approved rows, each with a count and each
row's exposure spelled out. Approve and Reject are the only actions — there is no Publish button,
because publishing is the launch script and not something to do sixty times while curating.

An admin can open a private editorial shot page; that exception exists only for the corpus, and
a customer's private upload stays refused.

## Publishing, at launch

```
npm run editorial:publish -- --dry-run     # count, change nothing
npm run editorial:publish                  # local
npm run editorial:publish -- --yes         # production; refuses without this
npm run editorial:unpublish                # the way back
```

It publishes shots where `is_editorial and review_status = 'approved' and visibility = 'private'`,
and the videos those shots belong to. It is idempotent. A target counts as production unless both
`NEXT_PUBLIC_SUPABASE_URL` and `DATABASE_URL` are `127.0.0.1`/`localhost`, so ambiguity fails
closed.

Publishing is what makes the rows readable through REST with the anon key. It is the launch
switch, not a preview.

## Taking an existing corpus private

Rows seeded by earlier runs are `public`. Migration `0031` deliberately does **not** flip them —
that is a data decision, not a schema one. Run this **before the first production seed**, and on
any environment that still holds a public corpus:

```sql
update public.shots set visibility = 'private' where is_editorial and visibility = 'public';
update public.videos set visibility = 'private' where is_editorial and visibility = 'public';
```

`npm run editorial:unpublish` does the same thing with the same guard and a count printed, and is
the safer way to run it.

## Proving it, rather than assuming it

Against whichever environment you care about, with only the anon key:

```
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/shots?is_editorial=eq.true&select=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

`[]` is the answer while the library is unlaunched. `tests/editorial-isolation.test.ts` and the
editorial suite in `tests/integration.test.ts` pin both halves — nothing readable before the
script runs, the approved row readable after it.
