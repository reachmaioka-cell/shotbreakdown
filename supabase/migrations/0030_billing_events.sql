-- Every Stripe event we have already acted on, by its own id.
--
-- Stripe redelivers: a timeout, a 500, a retry from the dashboard all arrive
-- as the same event id. Without this table a redelivered
-- customer.subscription.deleted after a re-subscribe downgrades a paying
-- customer, and a redelivered invoice.paid rewrites pro_since. The id is
-- inserted before the work, so the primary key is the lock: whoever inserts
-- it does the work, everybody else returns 200 and touches nothing.

create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table public.billing_events is
  'Stripe event ids already handled by /api/webhooks/stripe. Insert-before-work; a unique violation means another delivery got there first.';

-- Written only by the webhook, which runs as the service role. Nothing in the
-- browser has any business reading how often a customer''s card failed.
alter table public.billing_events enable row level security;

create policy "billing_events service only" on public.billing_events for all using (false);
