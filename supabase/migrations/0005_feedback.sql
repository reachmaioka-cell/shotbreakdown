alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists display_name text,
  add column if not exists credit_me boolean not null default false;

create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'cannot change is_admin';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_admin_flag on public.profiles;
create trigger protect_admin_flag
  before update on public.profiles
  for each row execute function public.protect_admin_flag();

alter table public.submissions
  add column if not exists rating_avg numeric,
  add column if not exists rating_count int not null default 0,
  add column if not exists breakdown_user_edits jsonb,
  add column if not exists admin_rejected boolean not null default false;

create table if not exists public.breakdown_feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  rating smallint check (rating is null or (rating >= 1 and rating <= 5)),
  field_key text,
  original_value jsonb,
  corrected_value jsonb,
  comment text,
  created_at timestamptz not null default now()
);

create unique index if not exists breakdown_feedback_rating_once
  on public.breakdown_feedback (submission_id, user_id)
  where rating is not null;

alter table public.breakdown_feedback enable row level security;

drop policy if exists "Users insert own feedback" on public.breakdown_feedback;
create policy "Users insert own feedback"
  on public.breakdown_feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users select own feedback" on public.breakdown_feedback;
create policy "Users select own feedback"
  on public.breakdown_feedback for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users delete own feedback" on public.breakdown_feedback;
create policy "Users delete own feedback"
  on public.breakdown_feedback for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.refresh_submission_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric;
  v_count int;
begin
  select avg(rating)::numeric, count(*)::int
    into v_avg, v_count
  from public.breakdown_feedback
  where submission_id = new.submission_id
    and rating is not null;

  update public.submissions
  set
    rating_avg = v_avg,
    rating_count = v_count,
    status = case
      when v_count >= 3 and v_avg >= 4.5 and status in ('draft', 'verified')
        then 'verified'::public.submission_status
      else status
    end
  where id = new.submission_id;

  return new;
end;
$$;

drop trigger if exists breakdown_feedback_rating on public.breakdown_feedback;
create trigger breakdown_feedback_rating
  after insert on public.breakdown_feedback
  for each row execute function public.refresh_submission_rating();

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  skill_level text check (skill_level in ('beginner', 'intermediate', 'pro')),
  primary_camera text,
  lenses text[] not null default '{}',
  typical_work text[] not null default '{}',
  budget_band text check (budget_band in ('under_500', 'under_5000', 'unlimited')),
  tone text not null default 'concise' check (tone in ('concise', 'detailed')),
  signals jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences"
  on public.user_preferences for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (submission_id, user_id)
);

alter table public.conversations enable row level security;

drop policy if exists "Users manage own conversations" on public.conversations;
create policy "Users manage own conversations"
  on public.conversations for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.prompt_insights (
  id uuid primary key default gen_random_uuid(),
  summary text not null,
  created_at timestamptz not null default now()
);

alter table public.prompt_insights enable row level security;

create or replace function public.save_breakdown_edits(p_submission_id uuid, p_edits jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.submissions
  set breakdown_user_edits = coalesce(breakdown_user_edits, '{}'::jsonb) || p_edits
  where id = p_submission_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.save_breakdown_edits(uuid, jsonb) to authenticated;

create or replace function public.record_preference_signal(p_card text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_preferences (user_id, signals)
  values (
    auth.uid(),
    jsonb_build_object('expands', jsonb_build_object(p_card, 1))
  )
  on conflict (user_id) do update
  set
    signals = jsonb_set(
      coalesce(user_preferences.signals, '{}'::jsonb),
      array['expands', p_card],
      to_jsonb(
        coalesce(
          (user_preferences.signals -> 'expands' ->> p_card)::int,
          0
        ) + 1
      )
    ),
    updated_at = now();
end;
$$;

grant execute on function public.record_preference_signal(text) to authenticated;

create or replace function public.increment_view_count(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.submissions
  set view_count = view_count + 1
  where id = p_submission_id
    and status = 'verified';
end;
$$;

grant execute on function public.increment_view_count(uuid) to anon, authenticated;

create or replace function public.match_verified_breakdowns(
  query_embedding vector(1536),
  match_k int default 3
)
returns table (
  id uuid,
  slug text,
  title text,
  thumbnail_url text,
  tags text[],
  breakdown jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.slug,
    s.title,
    s.thumbnail_url,
    s.tags,
    s.breakdown,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.submissions s
  where s.embedding is not null
    and (
      s.status = 'verified'
      or coalesce(s.rating_avg, 0) >= 4
    )
  order by s.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;
