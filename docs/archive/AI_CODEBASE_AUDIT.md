# AI Codebase Audit — ShotBreakdown

**Audit date:** 2026-08-23
**Auditor:** Claude Opus 5 (static code audit + targeted runtime verification)
**Commit/state:** working tree at `/Users/kendowling/shotbreakdown` (not a git repository)

---

## 0. Preface — read this first

This file did not exist before this audit. A previous brief asserted an `AI_CODEBASE_AUDIT.md`
was already present and should be treated as source of truth; it was not in the repository.
Everything below is derived from reading the actual code, the SQL migrations, and running
`tsc`, `eslint`, and one targeted runtime proof-of-concept.

**The application is not a marketing/brand content platform.** It is **ShotBreakdown**, a
cinematography analysis tool. Any plan written against a "Marketing Studio" domain model
(brands, campaigns, funnel variants, canvas editor, social publishing) does not describe this
codebase. The domain mapping is in §2.

Nothing in this audit is inferred from a prior document. Where a claim was verified by
execution it is marked **[VERIFIED]**. Where it is a code-reading conclusion it is marked
**[STATIC]**.

---

## 1. What the product actually is

Paste a YouTube / TikTok / Instagram link, or upload a still or clip. Claude analyses the
frame(s) and returns a structured cinematography breakdown: shot type, lens, focal length,
aperture, sensor format, lighting (key/fill/back/practicals/ratio), colour, movement + rig,
VFX, post-production, ordered recreation steps, budget tiers, common mistakes, tags.

Breakdowns that are admin-verified (or crowd-rated ≥4.5 across ≥3 ratings) are published to a
public, SEO-indexed library and become few-shot retrieval examples for future analyses.

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase (magic-link auth,
Postgres + pgvector, private Storage) · Anthropic `claude-sonnet-4-6` (structured outputs) ·
OpenAI `text-embedding-3-small` · Stripe subscriptions · Vercel Cron.

### 1.1 Scale

| Area | Size |
|---|---|
| App routes (pages + API) | 47 files |
| `lib/` modules | 42 files |
| React components | 20 files |
| SQL migrations | 15 files, 935 lines |
| Automated tests | **0** (2 ad-hoc smoke scripts, no test runner) |

---

## 2. Domain mapping (for anyone arriving with a generic SaaS brief)

| Generic brief concept | Real ShotBreakdown equivalent | Status |
|---|---|---|
| Brand profile | `user_preferences` — skill, camera, lenses, budget band, tone | Exists, used in prompt |
| Brand-aware generation | `formatAboutFilmmaker()` injected into system prompt | Working |
| Generation job | `submissions` row → `processSubmission()` → `breakdown` jsonb | Working, **not durable** |
| Multiple variants | ✗ Does not exist — one breakdown per submission | Absent by design |
| Visual canvas editor | ✗ Does not exist — field-level inline text edits only | Absent by design |
| Version history | ✗ Does not exist — edits overwrite `breakdown_user_edits` | **Missing** |
| Retrieval / context | pgvector RAG over `knowledge_chunks` + verified breakdowns | Working |
| Feedback / learning | `breakdown_feedback` → `learning_jobs` → `prompt_insights` → system prompt | Working, closed loop |
| Export | ✗ Does not exist | Absent |
| Publish | Admin verify → public library (`/library/[slug]`) | Working |
| Monetisation | Stripe subscription, free (10 breakdowns) / pro | Working |

**The learning loop is genuinely closed and is the product's real differentiator.** Corrections
are aggregated nightly by Claude into `prompt_insights`, and the newest row is prepended to the
next analysis prompt as "Known failure modes to avoid" (`lib/process.ts:57`,
`lib/prompts/breakdown.ts:44`). This is not a stub. Preserve it.

---

## 3. Baseline health

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **Pass**, 0 errors |
| `npm run lint` | **1 error** — `lib/knowledge-chunks.ts:167` `prefer-const` |
| `npm run build` | Not yet run in this audit |
| TODO / FIXME / HACK markers | **0** |
| Test runner installed | **None** (no vitest/jest/playwright) |
| Rate limiting | **None anywhere** |
| Analytics | **None** |
| Error monitoring | **None** |
| Account deletion | **None** |

---

## 4. Findings

Severity: **CRITICAL** = exploitable now, data/integrity loss · **HIGH** = security or money
loss · **MEDIUM** = correctness/UX · **LOW** = polish.

### CRITICAL

---

#### C-1 · Server-side prototype pollution via breakdown edits **[VERIFIED]**

**Files:** `lib/overlay.ts:8-22` · `app/api/breakdown/[id]/edit/route.ts:8,36`

`overlayBreakdown()` walks a dotted path from a user-supplied key and assigns into a cloned
object. `field_key` is validated only as `z.string().min(1)`.

```ts
// lib/overlay.ts:12-21
const parts = key.split(".");
let cur: Record<string, unknown> = clone;
for (let i = 0; i < parts.length - 1; i++) {
  const next = cur[part];
  if (typeof next !== "object" || next === null) cur[part] = {};
  cur = cur[part] as Record<string, unknown>;   // ← "__proto__" yields Object.prototype
}
cur[parts[parts.length - 1]] = value;           // ← writes onto Object.prototype
```

**Proof of concept (executed against the exact function body):**

```
before: undefined
after : PWNED
Object.prototype polluted? true
```

`POST /api/breakdown/{id}/edit` with `{"field_key":"__proto__.polluted","corrected_value":"PWNED"}`
by any authenticated user, on their own submission, pollutes `Object.prototype` for the entire
Node process — affecting every concurrent user on that serverless instance.

**Worse: it persists.** `save_breakdown_edits` stores the key into `breakdown_user_edits` jsonb
(`0005_feedback.sql:196`), and `overlayBreakdown` re-runs on every server render of that
breakdown (`app/breakdown/[id]/page.tsx:26`) and inside `/ask` (`ask/route.ts:59`) — so the
pollution re-fires on every page load, indefinitely.

Note `constructor.prototype` does **not** work (the `typeof !== "object"` guard replaces it),
so `__proto__` is the single live vector. Both must be blocked regardless.

**Root cause:** unvalidated path segments + no allowlist of editable fields.
**Fix:** reject `__proto__`, `prototype`, `constructor` segments; better, allowlist `field_key`
against the known `BreakdownSchema` paths; use `Object.create(null)` or a `Map` for traversal.
**Risk of change:** Low. Pure function, one call path, easily unit-tested.
**Cleanup required:** existing rows may already carry poisoned keys — sanitise
`breakdown_user_edits` in a migration.

---

#### C-2 · Any user can force another user's private breakdown public **[STATIC]**

**Files:** `supabase/migrations/0005_feedback.sql:49-52` (INSERT policy) and `:74-92` (trigger)

The feedback INSERT policy checks only that you are inserting *your own* `user_id`:

```sql
create policy "Users insert own feedback"
  on public.breakdown_feedback for insert to authenticated
  with check (auth.uid() = user_id);        -- no check that the submission is visible
```

There is no constraint tying `submission_id` to a row the actor may read. Meanwhile
`refresh_submission_rating()` auto-promotes on rating:

```sql
status = case when v_count >= 3 and v_avg >= 4.5 and status in ('draft','verified')
              then 'verified' else status end
```

`status = 'verified'` is the public-read condition (`0001_initial.sql:57-59`) and triggers slug
generation (`0006_library_slug.sql:31`). So **three accounts POSTing 5-star ratings at a
victim's private draft UUID publishes it to the public library**, exposing the title, thumbnail,
tags and full breakdown — and injecting it into the RAG corpus used for everyone's future
generations.

`POST /api/breakdown/[id]/feedback` does not verify the submission is readable either
(`feedback/route.ts:36-45` inserts directly).

**Root cause:** missing visibility predicate on the INSERT policy; publication decided by an
unauthenticated-in-effect signal.
**Fix:** add `exists (select 1 from submissions s where s.id = submission_id and (s.user_id = auth.uid() or s.status = 'verified'))` to the policy; remove auto-verify from the trigger and make
publication admin-only (or owner opt-in). Rate-limit feedback per user.
**Risk of change:** Medium — removing auto-verify changes how the library fills. Given the
library is seeded and admin-reviewed (`/admin/review`), this is the correct trade.

---

### HIGH

---

#### H-1 · Unauthenticated paid-API abuse on library search **[STATIC]**

**Files:** `app/api/library/search/route.ts:11-20` · `lib/library-search.ts:10`

`GET /api/library/search?q=…` has **no auth and no rate limit**, and calls
`embed()` → OpenAI `text-embedding-3-small` on every request. Anyone can bill the operator's
OpenAI account in a loop. Trivially scriptable.

**Fix:** cache embeddings by normalised query; add IP/user rate limiting; consider requiring
auth or falling back to `searchLibraryText()` for anonymous callers.

---

#### H-2 · Unmetered AI spend via retry **[STATIC]**

**File:** `app/api/submissions/[id]/retry/route.ts`

Retry checks ownership and `status !== 'processing'`, then reprocesses — a full Claude vision
call plus OpenAI embedding — with **no credit check, no attempt counter, no rate limit**. A free
user who has exhausted their 10 breakdowns can re-run analysis on an owned submission
indefinitely.

`increment_breakdown_count` is called only in `/api/submit` (`submit/route.ts:58`), never here.

**Fix:** cap retries per submission (persist `retry_count`), require a credit or plan
entitlement, add rate limiting.

---

#### H-3 · Follow-up chat spend is unbounded across submissions **[STATIC]**

**File:** `app/api/breakdown/[id]/ask/route.ts:70-80`

`FREE_ASK_TURNS` (10) is enforced per **conversation**, and conversations are unique per
`(submission_id, user_id)` (`0005_feedback.sql:170`). Every verified library breakdown is
readable by every authenticated user, so a free user gets 10 Claude calls **per library item** —
unbounded in aggregate. Each call includes full-resolution frames as base64 image blocks.

**Fix:** enforce a per-user rolling window (e.g. daily ask budget) server-side, independent of
conversation.

---

#### H-4 · Generation is bound to the HTTP invocation; recovery is up to 24h **[STATIC]**

**Files:** `lib/http.ts:22-26` · `app/api/submit/route.ts:78` · `lib/cron-jobs.ts:8-30` · `vercel.json`

`triggerProcessing()` awaits `processSubmission()` inside `after()`. There is no queue, no job
row, no attempt counter, and no cancellation. If the function is frozen or the invocation dies
mid-analysis the submission is left in `processing` forever.

The only recovery is `sweepStuckSubmissions()`, which requires `updated_at` older than 5 minutes
— but it runs from `/api/cron/daily`, scheduled `0 8 * * *`, i.e. **once per day**. A failed
generation can therefore sit stuck for up to 24 hours. The sweep also processes at most 10 rows
and calls `processSubmission` serially inside a 60s `maxDuration` route, so it will time out
under any real backlog.

Compounding: `app/api/submit/route.ts` declares **no `maxDuration`**, while `/api/process` (the
same work) declares 60s.

Note a durable queue pattern **already exists in this codebase** for the learning system —
`learning_jobs` with `claim_learning_jobs()` using `FOR UPDATE SKIP LOCKED`, attempts,
max_attempts, dedupe keys, backoff (`0009_learning_queue.sql`, `lib/learning/queue.ts`). The
correct fix is to reuse that pattern for submissions, not invent a new one.

**Fix:** persist a job row with the states the product needs (`queued/processing/analyzing/
indexing/complete/failed/cancelled`), claim via `SKIP LOCKED`, add attempts + backoff, and run a
frequent worker tick (Vercel Cron min 1/day on Hobby — use an external pinger or upgrade, as the
existing `/api/cron/learning` comment already acknowledges).

---

#### H-5 · Open redirect in auth callback **[STATIC]**

**File:** `app/auth/callback/route.ts:27-28`

```ts
const safeNext = next.startsWith("/") ? next : "/";
return NextResponse.redirect(`${origin}${safeNext}`);
```

`next=//evil.com` starts with `/`, producing `https://site.com//evil.com` — a protocol-relative
URL that browsers resolve to `https://evil.com`. Reachable on the post-login redirect, i.e. the
highest-trust moment in the session.

**Fix:** reject values starting with `//` or `/\`; parse with `new URL(next, origin)` and verify
`.origin === origin`.

---

#### H-6 · Embeddings fail open, silently degrading retrieval **[STATIC]**

**File:** `lib/embeddings.ts:7-10,25-27`

`embed()` returns `null` when `OPENAI_API_KEY` is absent, and `null` on any non-OK response
(logging only a status code). Callers treat `null` as "no vector":

- `lib/process.ts:78` stores `embedding: null` → the breakdown is permanently invisible to
  `match_verified_breakdowns` retrieval, with no error surfaced and no backfill trigger.
- `lib/library-search.ts:12` silently falls back to `ILIKE` title matching.

This is exactly the "fake production functionality" class: production appears to work while the
core differentiator (retrieval) is dead. Nothing alerts.

**Fix:** fail loudly in production (throw / mark job `failed` with a typed reason), retry
transient 429/5xx with backoff, and add a startup env assertion. Keep the graceful path for
local dev behind an explicit flag.

---

#### H-7 · `detectLinkSource` matches substrings anywhere in the URL **[STATIC]**

**File:** `lib/source.ts:96-101`

```ts
if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
```

Tested against the whole URL, not the host. `https://evil.example/?ref=youtube.com` is accepted
as a YouTube submission and persisted to `source_url`.

Actual SSRF impact is currently limited — that URL is only ever forwarded to fixed third-party
endpoints (`youtube.com/oembed`, `noembed.com`, `wikipedia.org`), never fetched directly. But
the *pattern* is wrong and the one place arbitrary URLs are fetched server-side is
`lib/breakdown.ts:127` (`imageBlock()` fetches `thumbnail_url` values returned by TikTok /
Instagram oembed providers) with **no host validation, no private-IP blocking, and no redirect
validation**.

**Fix:** parse with `new URL()` and match on `hostname` with an exact-suffix allowlist. Add a
shared `safeFetch()` that rejects private/loopback/link-local/metadata ranges and re-validates
after each redirect; route every server-side outbound fetch through it.

---

#### H-8 · `submissions` has no UPDATE or DELETE policy — users cannot delete their own data **[STATIC]**

**File:** `supabase/migrations/0001_initial.sql:48-59`

Only SELECT (own + verified) and INSERT policies exist. RLS default-denies the rest, so a user
cannot delete or modify their own submissions through the anon key. Combined with the complete
absence of an account-deletion path anywhere in the app, there is **no way for a user to delete
their data** — a GDPR/CCPA problem and a launch blocker for a paid consumer product.

**Fix:** add owner DELETE (and a narrow UPDATE) policy; build an account-deletion endpoint that
removes submissions, storage objects, feedback, conversations, preferences, and the auth user;
cancel any Stripe subscription first.

---

### MEDIUM

| ID | Finding | File |
|---|---|---|
| M-1 | **Broken thumbnails in history.** `thumbnail_url` holds a *storage path* for uploads (`process.ts:158`), but History renders it directly as `<img src>` — never signed. Uploaded frames show as broken images. | `app/history/page.tsx:44` |
| M-2 | **Infinite spinner.** `StatusPoller` polls every 2.5s forever with no timeout, no backoff, no max attempts, and no stage detail. A stuck job spins indefinitely — the exact failure mode a launch checklist forbids. | `app/breakdown/[id]/status-poller.tsx` |
| M-3 | **Credit consumed before insert.** `increment_breakdown_count` runs before the `submissions` insert; if the insert fails the user has silently lost a breakdown with no refund path. | `app/api/submit/route.ts:58-72` |
| M-4 | **No progress stages.** UI shows only "Analyzing shot…" though the backend has genuinely distinct phases (frames → research → RAG → Claude → embedding → indexing). Real stage data exists and is discarded. | `app/breakdown/[id]/page.tsx:48-53` |
| M-5 | **`rating_avg` always undefined in vector search results.** `match_verified_breakdowns` does not return `rating_avg` (`0014:60-72`), but the mapper reads `row.rating_avg`. Silently `undefined` on every semantic search hit. | `lib/library-search.ts:38` |
| M-6 | **Host-header-influenced Stripe URLs.** `getAppUrl(request)` derives origin from the request, so a spoofed `Host` controls `success_url` / `cancel_url` / `return_url`. | `lib/env.ts:2` |
| M-7 | **Public library rows expose internals.** The `status='verified'` SELECT policy grants `select *` — including `user_id`, `file_path`, `frame_paths`, `error_message`, `research_context`, `embedding` — to anon. | `0001_initial.sql:57-59` |
| M-8 | **No version history.** Edits merge into a single `breakdown_user_edits` jsonb; the previous value is not retained anywhere except the `breakdown_feedback` audit row. Users cannot view or restore prior versions. | `0005_feedback.sql:190-200` |
| M-9 | **View-count inflation.** `POST /api/view` is unauthenticated with no throttle or dedupe. | `app/api/view/route.ts` |
| M-10 | **Learning worker starves on Hobby.** `vercel.json` schedules `/api/cron/learning` once daily; the code comments say it needs to run every 1–5 minutes. The learning queue will not drain. | `vercel.json`, `app/api/cron/learning/route.ts:9-12` |

### LOW

- **L-1** Lint error: `lib/knowledge-chunks.ts:167` `prefer-const`.
- **L-2** `robots.ts` disallows `/breakdown/`, `/admin`, `/api` but leaves `/history`, `/settings`, `/onboarding`, `/upgrade` indexable.
- **L-3** No `<html lang>` issues, but no skip-link, and interactive cards lack visible focus styling in several components.
- **L-4** `README.md` documents `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` as a fallback that "cannot auto-unlock Pro" — a payment path that takes money without granting entitlement. Should be removed before launch.

---

## 5. What is genuinely working (do not rebuild)

Verified by reading the implementation end-to-end:

- **Claude integration is real and correct.** `messages.parse()` + `zodOutputFormat(BreakdownSchema)` for guaranteed structured output, with a re-prompt retry on parse failure (`lib/breakdown.ts:104-116,160-180`). Model `claude-sonnet-4-6` is a valid current ID.
- **Storage is already private.** Bucket created with `public: false`; per-user folder RLS on INSERT and SELECT keyed to `(storage.foldername(name))[1] = auth.uid()::text`; all reads go through short-lived signed URLs (`0003_uploads.sql`, `lib/media.ts`, `SIGNED_URL_TTL_SEC = 600`).
- **Cron auth fails closed.** `isInternalRequest()` returns `false` when no secret is configured, so an unset `CRON_SECRET` denies rather than bypasses (`lib/http.ts:9-20`). No production bypass exists.
- **Billing column protection.** DB triggers reject non-service-role changes to `plan`, `stripe_customer_id`, `pro_since`, and `is_admin` (`0007:31-48`, `0005:9-21`) — privilege escalation via the anon key is blocked at the database.
- **Stripe webhook verifies signatures** with `constructEventAsync` and handles the full lifecycle (checkout, invoice.paid, subscription.updated/deleted, payment_failed).
- **Service-role key is server-only** — `lib/supabase/admin.ts` is never imported from a `"use client"` module. No secret reaches the browser.
- **Learning loop is closed and real** — feedback → `learning_jobs` → distillation → `prompt_insights` → next system prompt.
- **SEO foundations exist** — `sitemap.ts`, `robots.ts`, per-breakdown `opengraph-image.tsx`, metadata templates, JSON-LD component.
- **Legal pages exist** — `/privacy`, `/terms`.

---

## 6. Gaps against a production launch bar

| Requirement | State |
|---|---|
| Rate limiting | **Absent entirely** |
| Durable generation jobs | **Absent** (H-4) |
| Automated tests | **Absent** — no runner, 0 tests |
| RLS regression tests | **Absent** |
| Error monitoring | **Absent** |
| Product analytics | **Absent** |
| Account / data deletion | **Absent** (H-8) |
| Version history | **Absent** (M-8) |
| Export | **Absent** |
| Email verification | Implicit via magic link — adequate |
| Password recovery | N/A — passwordless |
| CI | **Absent** |

---

## 7. Recommended order of work

Ordered by exploitability and blast radius, not by phase number.

1. **C-1** prototype pollution — smallest fix, largest blast radius. Sanitise stored rows.
2. **C-2** feedback authorisation + remove auto-verify.
3. **H-5** open redirect (one-line).
4. **H-1/H-2/H-3** rate limiting + entitlement enforcement on all paid-API paths.
5. **H-6** embeddings fail loudly; **H-7** `safeFetch` + host allowlist.
6. **H-4** durable job queue, reusing the existing `learning_jobs` pattern.
7. **H-8** account deletion + owner DELETE policy.
8. M-1 → M-10, then tests, monitoring, analytics.

---

## 8. Audit method and limits

**Covered:** all 15 SQL migrations; all 24 API routes; all page components; `lib/` security-,
AI-, and job-relevant modules; both smoke scripts; env configuration; `vercel.json`; `proxy.ts`.

**Verified by execution:** `tsc --noEmit` (pass), `eslint` (1 error), and the C-1 prototype
pollution proof-of-concept.

**Not covered / not verified:**
- `npm run build` was not run.
- No live database was queried; RLS conclusions are read from migration DDL, not from a
  `SET ROLE` cross-user test. **The C-2 escalation should be confirmed against a live instance
  before and after the fix.**
- Runtime behaviour of the learning worker, ffmpeg frame extraction, and Stripe webhooks was not
  exercised.
- No browser/mobile/accessibility testing was performed; §4 L-3 is a static observation only.
- `lib/learning/jobs.ts` (732 lines) was read at the interface level, not line-by-line.

**Recommended next verification step:** stand up the local Supabase stack
(`npx supabase start`), then write the RLS cross-user tests described in §7 item 2 — they are
the fastest way to convert the C-2 finding from STATIC to VERIFIED.
