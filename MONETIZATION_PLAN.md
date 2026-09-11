# Monetization plan: close the spend hole, take money legitimately, prime the library

Written 2026-09-11 for Opus to implement. Read all of section 0 before touching anything.
`LAUNCH_PLAN.md` remains the scope of record for the product; this document covers the three
things standing between the deployed site and revenue.

## 0. What is true today (verified, not assumed)

Production is live at https://shotbreakdown.vercel.app on `launch/core`, Supabase project
`cohukcnhdvohutabjdao` (Pro), Vercel project `shotbreakdown` (**Hobby**). Everything below was
checked against the running code and the live services on 2026-09-11.

**The spend hole.** During the deploy verification I signed up with
`prod-smoke-…@shotbreakdown.test` — a domain that does not exist — through the raw Supabase
endpoint (`POST /auth/v1/signup` with a password) and received an **access token in the same
response**. That session uploaded a clip and ran the whole pipeline. So:

- The app's own sign-in is magic-link only (`app/auth/login/page.tsx:25`, `signInWithOtp`), which
  does require an inbox. The hole is the password path Supabase exposes by default, which the app
  never uses.
- `PLANS.free.videosPerMonth = 3` (`lib/plans.ts`) is enforced per account by `monthlyVideoUsage`
  (`lib/videos.ts:45`). Accounts are free, instant and unverified, so it bounds nothing.
- Every rate limit in `lib/rate-limit.ts` is keyed `u:<userId>` for a signed-in caller
  (`clientKey`, line ~52). The IP is only used for anonymous calls. A script that makes an account
  per upload never shares a bucket.
- There is no site-wide ceiling anywhere. `POST /api/videos` (`app/api/videos/route.ts:39`)
  checks the user's plan, then enqueues.
- Measured cost of what it enqueues (this session, Sonnet 4.6): ~100s of `analyze_shots` per shot
  and 112s avg for `generate_segment_breakdown`, one vision call per shot plus one breakdown call
  over up to 12 frames — roughly **$0.10–0.15 per short segment, $0.50–0.70 per 12-shot
  segment**. The ceiling on what a stranger can spend overnight is the provider's, not ours.

**The billing plan mismatch.** Vercel Hobby's terms prohibit commercial use. Production carries
`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` (set 71 days ago for the old
product), `/upgrade` shows a `$12 / month` Pro plan, and `POST /api/billing/checkout` creates a
subscription Checkout session. The first successful payment breaches the plan the site is on.

What the billing code does today (all read in full):

| Piece | File | State |
|---|---|---|
| Checkout | `app/api/billing/checkout/route.ts` | Creates a `subscription` session with `client_reference_id = user.id`, reuses `stripe_customer_id`, rate-limited (`billing` bucket). Sound. |
| Portal | `app/api/billing/portal/route.ts` | Needs `stripe_customer_id`; requires the Stripe **Customer Portal to be configured** in the dashboard or `billingPortal.sessions.create` throws. |
| Webhook | `app/api/webhooks/stripe/route.ts` | Verifies signature with `constructEventAsync`; handles `checkout.session.completed` (sets `plan='pro'`, `stripe_customer_id`, `pro_since`), `invoice.paid` (create/cycle → pro), `customer.subscription.updated` (`active` → pro; `canceled`/`unpaid` → free), `customer.subscription.deleted` and `invoice.payment_failed` (→ free). `trialing` and `past_due` fall through unhandled. |
| Account deletion | `app/api/account/route.ts:46` | Cancels every subscription for the customer before deleting. Sound. |
| Entitlement | `profiles.plan` (`text`), `pro_since`, `stripe_customer_id`, `is_admin` — all present in production (schema verified identical to local, 363 columns). |
| Copy | `app/terms/page.tsx:104` says cancel-anytime, no refund of the current period. `/upgrade` hardcodes `$12`. |
| Tests | **None.** `grep -rli stripe tests/` returns nothing. |
| Unknowns | Whether production's Stripe keys are **live** or **test** mode (local `.env.local` holds `rk_test_…`); whether a webhook endpoint is registered in Stripe for `/api/webhooks/stripe`; whether the Customer Portal is configured; whether the live Price matches `$12`. None of these are readable from the code or from Vercel (values are redacted on pull). Section 2 gets them from Ken; section 4 verifies them by behaviour. |

**Email.** Magic links go out through Supabase's built-in sender because no custom SMTP is
configured (nothing in `lib/` or `app/` sends mail; `package.json` has no mail library). That
sender is rate-limited to a handful of messages per hour and is documented as not for production.
At launch volume, sign-in emails will silently not arrive — this is the failure Ken already hit
once locally ("no email was sent to me"). A custom SMTP provider needs a domain the app can send
from; the site has no custom domain today (`ktracker.io` is the only domain on the Vercel team).

**Queue draining.** `/api/worker` is driven only by `.github/workflows/worker-ping.yml` every five
minutes (the Vercel cron was removed because Hobby refuses sub-daily schedules; commit `b0ca673`).
GitHub disables scheduled workflows on repositories with **no commits for 60 days**, and schedules
can lag by many minutes under load. Fine for now; not what a paying customer's upload should depend
on.

**Guardrail on infrastructure.** In the last session, the permission classifier blocked every
production-mutating action taken through tools: `drop schema`, `alter role … password`,
`create_project`, and a `pg_trigger` read. Reads via `psql "$DATABASE_URL"` worked; `npm run
db:migrate` worked; `vercel env add/rm` and `vercel deploy --prod` worked; `gh secret set` and
`gh repo edit` worked. Plan for the same: do infrastructure changes through the project's own
tooling and the Vercel/GitHub CLIs, and if a step is refused, stop and hand Ken the exact command
rather than routing around it.

## 1. Decisions and recommendations

### 1.1 Abuse control: "verified inbox, then hard ceilings" (recommended)

Four layers, cheapest first. Each is independently useful; together they bound worst-case spend
to a number Ken chooses.

1. **Require a verified email for anything that spends** — Supabase-side *and* app-side.
   Supabase: turn **Confirm email** on. With it on, `POST /auth/v1/signup` returns a user with no
   session until the confirmation link is clicked; the magic-link flow is unchanged because
   verifying an OTP *is* confirmation. App: a `requireVerifiedUser()` guard on every route that
   enqueues a paid job, so the guarantee does not depend on a dashboard toggle staying set.
   This is the fix Ken asked for. The alternatives — CAPTCHA on signup, disposable-domain
   blocklists, phone verification — add friction for legitimate users and still leave the
   spend unbounded; a verified inbox plus a ceiling does not.
2. **A site-wide daily ceiling on new segments**, `DAILY_SEGMENT_CAP` (env, default 150). When
   reached, `POST /api/videos` returns `503` with a plain "we're at capacity for today, try
   tomorrow" and the upload page says so. 150 twelve-shot segments is ~$100 of model spend and
   ~10 hours of the two-worker queue — the most that can be lost in a day even if every other
   layer fails. Pro users bypass nothing here on purpose: a paying customer hitting the cap is
   the signal to raise it, and the cap is one env var.
3. **Per-IP budgets on spending routes, in addition to the per-user ones.** One person with
   twenty inboxes still shares one address. `video_submit_ip: 12 / 24h` applied alongside the
   existing `video_submit: 10 / 1h` per user.
4. **Provider-side monthly limits** in the Anthropic and OpenAI consoles (Ken; section 2). The
   backstop that does not depend on our code at all.

Not recommended now: a per-user prepaid credit system, or metering at the token level. Both are
real products to build; the four layers above take an afternoon and make the exposure finite.

### 1.2 Billing: "Vercel Pro, then prove the live loop before the first customer" (recommended)

- **Upgrade Vercel to Pro** ($20/mo). It is the only lawful way to charge on this host, and it
  also restores sub-daily crons (section 3.B.6 puts `/api/worker` back on a Vercel schedule as
  the primary drainer, with the GitHub pinger as the fallback) and raises function limits.
- **Run the billing loop end to end in Stripe test mode, under test, before touching live** —
  there are no billing tests today. The webhook handler is the part that grants entitlement, so
  it gets signature-verified fixture tests plus a real Stripe-CLI-driven run against a local
  server.
- **Then one real purchase in live mode with Ken's own card**, verified to flip `plan` to `pro`,
  followed by a portal cancellation and a dashboard refund. That is the only honest proof.

Alternatives considered: Stripe Payment Links (`NEXT_PUBLIC_STRIPE_PAYMENT_LINK` lingers in
`.env.local`) — no `client_reference_id`, so entitlement cannot be granted reliably; rejected.
Lemon Squeezy / Paddle as merchant of record — real advantages for tax, but a rewrite of a
working integration; revisit if international sales tax becomes a problem.

### 1.3 A domain

Not strictly required to take money, but everything downstream wants one: transactional email
cannot be sent from `vercel.app`, Stripe Checkout shows the origin, and the terms page already
uses `hello@shotbreakdown.app`. Recommendation: buy the domain Ken wants (the copy assumes
`shotbreakdown.app`), add it to the Vercel project, and use it for Resend. Sections 2 and 3.A.5
are written so that the domain can land later without redoing anything.

## 2. Ken-only steps (the minimum; everything else is Opus)

Do these in order. Each is a few minutes. Where a value is produced, put it in
`/Users/kendowling/shotbreakdown/.env.production.local` — a new, gitignored file (`.env*` is
ignored) that holds **production** secrets only and is never loaded by `npm run dev`. Opus reads
it to push values to Vercel with `vercel env add`; nothing is pasted into the chat.

1. **Vercel → Pro.** https://vercel.com/reachmaioka-7121s-projects/~/settings/billing → Upgrade.
2. **Supabase Auth: Confirm email ON.**
   https://supabase.com/dashboard/project/cohukcnhdvohutabjdao/auth/providers → Email →
   **Confirm email** on → Save. (Leave "Allow new users to sign up" on.)
3. **Provider spend limits.** Anthropic console → Limits → set a monthly spend limit (suggest
   $300 to start). OpenAI → Billing → Usage limits → set a hard monthly limit (suggest $50;
   embeddings are cheap).
4. **Stripe, live mode.** In the Stripe dashboard with the **Live** toggle on:
   - Confirm the account is activated for live payments.
   - Products → create (or confirm) a recurring Price of **$12.00 / month** named ShotBreakdown
     Pro. Copy its id → `STRIPE_PRICE_ID=price_…` in `.env.production.local`.
   - Developers → API keys → copy the **secret** key → `STRIPE_SECRET_KEY=sk_live_…`.
   - Developers → Webhooks → Add endpoint → URL
     `https://shotbreakdown.vercel.app/api/webhooks/stripe` → events:
     `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
     `customer.subscription.updated`, `customer.subscription.deleted` → copy the signing secret
     → `STRIPE_WEBHOOK_SECRET=whsec_…`.
   - Settings → Billing → Customer portal → **Activate** with cancel-subscription enabled (the
     portal route fails without this).
5. **Test-mode keys for Opus** (so the loop can be proven locally without live money): Stripe
   with the **Test** toggle on → a secret key `sk_test_…`, a $12/month test Price, and
   `stripe login` on this machine (`brew install stripe/stripe-cli/stripe` if absent) so
   `stripe listen` can forward webhooks. Put `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID` for test mode
   into `.env.local` (replacing the `rk_test_…` restricted key there, which cannot create
   subscriptions).
6. **Production service-role key**, for the editorial seeder and the e2e journey only:
   Supabase → Project Settings → API → `service_role` → `SUPABASE_SERVICE_ROLE_KEY=…` in
   `.env.production.local`. This key bypasses RLS; it never goes in `.env.local` and never in
   Vercel beyond the value already there.
7. **Domain** (recommended, can be later): buy it, add to Vercel (`vercel domains add …`), then
   Resend → Domains → add it and set the DNS records it gives you. Produce
   `RESEND_SMTP_PASSWORD` (Resend → API keys) for step 3.A.5.
8. When 1–6 are done, say so. Opus does everything else and comes back only with the live
   purchase (step 4.C.3), which needs your card.

## 3. Implementation (Opus)

Work on `launch/core`. Commit per phase with the trailer already in use. Do not weaken RLS,
`safeFetch`, the rate limiter, cron auth or storage privacy (see `LAUNCH_PLAN.md` §4). Run
`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run security:audit` before every commit.

### Phase A — Abuse control

**A.1 `requireVerifiedUser` guard.** New `lib/auth-guard.ts`:

```ts
/**
 * A caller who has never received an email from us is not allowed to spend.
 * Supabase can be configured to hand a password sign-up a session before the
 * address is confirmed, and every plan limit is per account, so an unverified
 * account is an unbounded model budget. Magic-link users are confirmed by
 * construction; this only ever refuses the raw password path.
 */
export function isVerified(user: User): boolean
export async function requireVerifiedUser(request): Promise<{ user } | Response>
```

`isVerified` = `Boolean(user.email_confirmed_at ?? user.confirmed_at)`. Apply the guard, after
auth and before any rate limit or enqueue, in: `app/api/videos/route.ts` (POST),
`app/api/videos/[id]/breakdown`, `app/api/videos/[id]/ai-recreation`, `app/api/videos/[id]/ask`,
`app/api/videos/[id]/retry`, `app/api/shots/[id]/recreation-guide`, `app/api/shots/[id]/frame`
(the reanalyze path), `app/api/billing/checkout`. Response: `403 {"error":"verify_email",
"message":"Confirm your email address first — check your inbox for the link."}`. The upload page
and the segment page show that message when they get it (find where `plan_limit_reached` is
rendered and handle `verify_email` beside it).

**A.2 Site-wide daily ceiling.** `lib/capacity.ts`:

```ts
export const DAILY_SEGMENT_CAP = Number(process.env.DAILY_SEGMENT_CAP ?? 150);
export async function segmentsCreatedToday(): Promise<number>   // count(videos) where created_at > now() - 24h, status <> 'failed'
export async function atDailyCapacity(): Promise<boolean>
```

In `POST /api/videos`, after the plan check and before the insert: if `atDailyCapacity()`,
return `503 {"error":"at_capacity","message":"We're at capacity for today. Try again
tomorrow.","retryAfter": <seconds to next UTC midnight>}` with a `Retry-After` header. The
upload page renders it. Count with the admin client so RLS does not hide other users' rows. Log
at 80% and 100% through `reportError` (`lib/errors.ts`) so it reaches Sentry when configured;
also expose the number on `/api/cron/daily`'s log line.

**A.3 Per-IP budgets on spend.** In `lib/rate-limit.ts` add
`video_submit_ip: { limit: 12, windowSeconds: 24 * 60 * 60 }` and a helper
`enforceIpRateLimit(bucket, request)` that keys by hashed IP **even when the caller is signed
in** (today `clientKey` prefers the user id). Apply it in `POST /api/videos` alongside the
existing per-user call. Same for `ai_recreation_ip: 10/24h` and `segment_breakdown_ip: 10/24h`.
Behind Vercel the client IP is `x-forwarded-for`'s first hop, which `clientKey` already reads.

**A.4 Signup hardening that costs nothing.** In `app/auth/login/page.tsx` the
`signInWithOtp` call is the only signup path the UI offers; leave it. Add a server-side
`POST /api/auth/otp` proxy? No — Supabase rate-limits OTP sends itself. Skip. What to add:
the `/api/me` response includes `verified: boolean` so the client can show the "confirm your
email" state.

**A.5 Custom SMTP (only once a domain exists; otherwise document the limit).** Supabase →
Auth → SMTP settings: host `smtp.resend.com`, port `465`, user `resend`, password
`RESEND_SMTP_PASSWORD`, sender `login@<domain>`. This is dashboard configuration, so it is a Ken
step with an Opus verification: send a magic link to an address outside the org and confirm
delivery within a minute. Until then, the README's deploy section must state the built-in
sender's limit plainly.

**A.6 Tests.** `tests/auth-guard.test.ts` (verified/unverified user objects → allowed/403;
every route in A.1 imports the guard — assert by reading the route files' imports so a future
route cannot forget it); `tests/capacity.test.ts` (cap arithmetic, `Retry-After`, the 80%/100%
log thresholds); rate-limit tests for the IP-keyed bucket. Extend `scripts/security-audit.ts`
with three live checks: an unverified session is refused by `POST /api/videos` (create one via
the admin API with `email_confirm: false`), a verified one is accepted, and the IP bucket trips
on the 13th submit from one address in a day (use `x-forwarded-for`).

**A.7 Docs.** README env table gains `DAILY_SEGMENT_CAP`; `LAUNCH_PLAN.md` "Known gaps" gains
a line on the built-in email sender.

### Phase B — Billing, live

**B.1 Webhook completeness.** In `app/api/webhooks/stripe/route.ts`: treat
`customer.subscription.updated` with status `trialing` as pro and `past_due` as pro (Stripe
retries the card for days; cutting access on the first failure loses the customer over a
declined card — `invoice.payment_failed` already downgrades, so change *that* to only downgrade
when `invoice.attempt_count >= 3` or the subscription is `unpaid`). Record `event.id` in a new
`billing_events` table (migration `0030_billing_events.sql`: `id text primary key, type text,
received_at timestamptz`) and skip an id already seen — Stripe redelivers, and today a redelivered
`customer.subscription.deleted` after a re-subscribe would downgrade a paying customer. Return
`200` for unknown event types (already the case).

**B.2 Entitlement race on the success page.** `/?upgraded=1` renders `UpgradedBanner`
(`components/upgraded-banner.tsx`) while the webhook may still be in flight. Have the banner
poll `/api/me` every 2s for up to 30s until `plan === "pro"`, showing "Activating your plan…"
until then, and "Still activating — you'll have Pro within a minute; refresh if not" after.
Never show "Free" on that page in that window.

**B.3 Price is data, not copy.** `/upgrade` hardcodes `$12`. Add `PRO_PRICE_USD_MONTHLY` to
`lib/plans.ts` as the single source, render from it, and add a startup-time check in
`lib/stripe.ts` (`assertPriceMatches()`, called from `checkout`) that retrieves
`STRIPE_PRICE_ID` once, caches it, and refuses checkout with a logged error if the amount or
interval differs from the constant — a mismatch between the page and the charge is a chargeback.

**B.4 Tests** (`tests/billing.test.ts`, first billing tests in the repo): signature — a body
signed with `stripe.webhooks.generateTestHeaderString` is accepted, a tampered body is `400`;
each handled event type moves `profiles.plan` the right way against the local database; a
redelivered `event.id` is a no-op; `past_due` keeps pro; `checkout.session.completed` without
`client_reference_id` is acknowledged and changes nothing. Use the real handler with the local
admin client — not mocks — so RLS/column drift is caught.

**B.5 Test-mode loop, run for real, locally.** With `stripe listen --forward-to
127.0.0.1:3002/api/webhooks/stripe` running (it prints a `whsec_…`; put it in `.env.local` as
`STRIPE_WEBHOOK_SECRET` for the run): sign in as a local user, `POST /api/billing/checkout`,
open the returned URL in headless Chrome (the CDP helper at
`scratchpad/snap.mjs` shows the pattern — reuse it as `scripts/billing-journey.ts` so it is
kept), pay with `4242 4242 4242 4242`, land on `/?upgraded=1`, assert `profiles.plan = 'pro'`
within 30s, open the portal, cancel, assert the `customer.subscription.updated`/`deleted`
events flip it back to `free`. Keep the script; it is the regression test for the whole loop.

**B.6 Queue draining on Pro.** Once Vercel is on Pro, restore
`{ "path": "/api/worker", "schedule": "*/5 * * * *" }` in `vercel.json` (five minutes, not
two — two drainers at `*/2` is more concurrency than the Anthropic tier needs) and keep the
GitHub pinger; both call an idempotent endpoint and jobs are claimed atomically. Note the
change in `LAUNCH_PLAN.md`'s deploy section.

**B.7 Production wiring** (Opus, from `.env.production.local`, never by hand in the dashboard):
`vercel env rm STRIPE_SECRET_KEY production` then `add` the live one; same for
`STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`; `vercel env rm NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
production` (nothing reads it); add `DAILY_SEGMENT_CAP` if Ken wants other than 150. Redeploy.

**B.8 Cleanup.** Remove `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` from `.env.local` and `.env.example`
if present; it is not read anywhere.

### Phase C — Editorial library priming

See the appendix at the end of this file, written from the `prime-editorial-library` workflow's
results: the seeder change, the isolation proof, and the admin runbook. In short: the seeder now
records `motion_profile`; with `FEATURE_PUBLIC_LIBRARY` off the corpus is invisible on every
surface that was exercised; `/admin/review` is gated three ways (flag, session, `is_admin`).

Production steps, once Ken's step 6 is done:

1. `vercel env add FEATURE_ADMIN_REVIEW production` = `1`; redeploy.
2. `psql "$DATABASE_URL" -c "update public.profiles set is_admin = true where email = 'reachmaioka@gmail.com';"`
3. First seed, small and against production with the production keys:
   `npx tsx --env-file=.env.production.local scripts/seed-music-clips.ts --max-videos=3 --target=30`
   then open `/admin/review` and confirm the rows are there and the public surfaces still show
   nothing (re-run the isolation checks from the appendix against production).
4. Grow it in batches of `--target=100`, at most one batch a day so a bad batch is small.
   Measured cost: one vision call per shot ≈ $0.05–0.10, so 300 shots ≈ $15–30 and ~8 hours of
   pipeline time if the seeder's own analysis is serial. Storage: one 1280px JPEG per shot plus
   thumbnails, ~0.3 MB/shot → 300 shots ≈ 100 MB.

### Phase D — Verification protocol

Every phase ends with these, all run and their output pasted into the commit message or
`LAUNCH_PLAN.md`; a step that was not run is written as "not run", never as passed.

1. `npx tsc --noEmit`, `npm run lint`, `npm test` (expect the count to go **up** from 241),
   `npm run build`, `npm run security:audit` (expect the count to go up from 88).
2. `npm run segment:journey` and `npm run full:journey` on `scratchpad/source15.mp4 3 9`, both
   green, with the worker **stopped** (two drainers steal each other's jobs in a test harness).
3. Phase A, against production after deploy: an unverified signup via `POST /auth/v1/signup`
   gets no session (Supabase) *and*, if one is minted through the admin API with
   `email_confirm: false`, `POST /api/videos` returns `403 verify_email` (app). A verified
   magic-link user still uploads. Thirteen submits from one `x-forwarded-for` in a day → `429`.
   `DAILY_SEGMENT_CAP=1` on a preview deploy → the second upload returns `503 at_capacity` with
   `Retry-After`.
4. Phase B: `scripts/billing-journey.ts` green in test mode locally; then, with Ken present, one
   live purchase on production: `plan` flips to `pro` within 30s (`psql "$DATABASE_URL" -c
   "select email, plan, pro_since from profiles where email='reachmaioka@gmail.com'"`), the
   portal opens, cancel-at-period-end shows, then refund from the Stripe dashboard and confirm
   the `charge.refunded` does **not** downgrade (it is unhandled by design; the subscription
   status does). Then cancel the subscription immediately in the dashboard and confirm `free`.
5. Phase C: the isolation table re-run against production with the seeded rows present.
6. Rerun `scripts/prod-page-check.ts` (scratchpad) equivalent — a real signup through the
   **magic-link** path now, since password signup no longer yields a session — end to end on
   production; keep it in `scripts/` as `prod-journey.ts` with the base URL and secrets from
   `.env.production.local`.

## 4. Definition of done

- A stranger cannot spend money here without an inbox we have emailed, and cannot spend more
  than `DAILY_SEGMENT_CAP` segments' worth in a day no matter how many inboxes they have.
- The site is on a Vercel plan that permits charging, a real card has bought Pro on production
  and been refunded, and the whole loop is covered by tests that fail if the webhook handler
  regresses.
- Sign-in email goes through a provider that can deliver at launch volume, or the README says in
  one sentence that it does not yet.
- The editorial corpus is growing in production and invisible to everyone but an admin.
- Every claim above is backed by a command that was run, with its output recorded.

## 5. Guardrails for the implementing agent

- Never paste a secret into a commit, a test fixture, a log line or the chat. Secrets live in
  `.env.local` (local) and `.env.production.local` (production) and reach Vercel only via
  `vercel env add`.
- Never run the seeder uncapped, and never against production before Phase C's isolation check
  has been re-run there.
- Never test live billing without Ken on the line; test mode is for everything else.
- If a production-mutating step is refused by the permission layer, stop and hand Ken the exact
  command. Do not find another route to the same mutation.
- Word ceilings, RLS, the rate limiter, cron auth and storage privacy do not get loosened to
  make a test pass.
