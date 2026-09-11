-- A high-water mark for entitlement, so a late Stripe event cannot undo a newer one.
--
-- 0030 recorded every event id we had acted on, which stops the SAME event
-- being applied twice. It does nothing about two DIFFERENT events arriving in
-- the wrong order, and Stripe guarantees no order and retries for days:
--
--   checkout.session.completed (new subscription)  -> pro
--   customer.subscription.deleted (the OLD one, created 10 minutes EARLIER) -> free
--
-- Both are first deliveries, both have their own id, and the paying customer
-- ends on free. The reverse shape re-grants Pro after a cancellation. Two
-- columns close it:
--
--   billing_event_at         Stripe's own `event.created` for the newest event
--                            we let decide this account's plan. An event older
--                            than this is news we have already superseded.
--   billing_subscription_id  the subscription that decision was about. A
--                            cancellation of some OTHER subscription says
--                            nothing about the one being paid for, whatever
--                            its timestamp.
--
-- Both stay null until the first event decides something, and null means "no
-- decision recorded yet, let it through" -- the right default for the accounts
-- that already exist when this lands, which must not be frozen by a watermark
-- they never got.
--
-- Stripe's clock is the only clock that orders Stripe's events, so the
-- watermark is `event.created` and never now().

alter table public.profiles
  add column if not exists billing_event_at timestamptz,
  add column if not exists billing_subscription_id text;

comment on column public.profiles.billing_event_at is
  'event.created of the newest Stripe event allowed to decide this account''s plan. Older events are ignored.';

comment on column public.profiles.billing_subscription_id is
  'Stripe subscription id the current entitlement rests on. A revoking event naming a different subscription is ignored.';

-- The watermark is part of the entitlement, so it needs the same protection the
-- entitlement has. A user who could write their own billing_event_at -- the
-- profiles update policy lets them write their own row -- could set it to the
-- year 3000 and no future cancellation would ever downgrade them. This is 0007's
-- function with the two new columns added to the same list.
create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.plan is distinct from old.plan
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.pro_since is distinct from old.pro_since
      or new.billing_event_at is distinct from old.billing_event_at
      or new.billing_subscription_id is distinct from old.billing_subscription_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'cannot change billing fields';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_billing_columns on public.profiles;
create trigger protect_billing_columns
  before update on public.profiles
  for each row execute function public.protect_billing_columns();
