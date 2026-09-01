-- Pro plan + Stripe customer mapping. Additive; does not alter applied migrations.

alter table public.profiles
  add column if not exists plan text not null default 'free',
  add column if not exists stripe_customer_id text,
  add column if not exists pro_since timestamptz;

alter table public.profiles
  drop constraint if exists profiles_plan_check;

alter table public.profiles
  add constraint profiles_plan_check check (plan in ('free', 'pro'));

create unique index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Users can update display_name / credit_me. Billing columns only move via service_role (webhook).
create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.plan is distinct from old.plan
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.pro_since is distinct from old.pro_since)
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

-- Same signature as 0002. Pro skips the cap; free keeps it. Ownership check unchanged.
create or replace function public.increment_breakdown_count(p_user_id uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
  v_plan text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return false;
  end if;

  select plan into v_plan
  from public.profiles
  where id = p_user_id;

  if v_plan is null then
    return false;
  end if;

  if v_plan = 'pro' then
    update public.profiles
    set breakdown_count = breakdown_count + 1
    where id = p_user_id
    returning id into updated_id;
    return updated_id is not null;
  end if;

  update public.profiles
  set breakdown_count = breakdown_count + 1
  where id = p_user_id
    and breakdown_count < p_limit
  returning id into updated_id;

  return updated_id is not null;
end;
$$;

grant execute on function public.increment_breakdown_count(uuid, int) to authenticated;
