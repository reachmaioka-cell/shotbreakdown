-- Security fixes: authorization, abuse control, data ownership.
-- Addresses C-1, C-2, H-1/2/3, H-8, M-7, M-9 from the codebase audit.

-- ---------------------------------------------------------------------------
-- C-1 cleanup: strip prototype-pollution keys written before the allowlist.
-- ---------------------------------------------------------------------------
update public.submissions s
set breakdown_user_edits = (
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(s.breakdown_user_edits) e(key, value)
  where key not like '%\_\_proto\_\_%'
    and key not like '%constructor%'
    and key not like '%prototype%'
)
where breakdown_user_edits is not null
  and exists (
    select 1 from jsonb_object_keys(s.breakdown_user_edits) k
    where k like '%\_\_proto\_\_%' or k like '%constructor%' or k like '%prototype%'
  );

-- ---------------------------------------------------------------------------
-- C-2a: feedback may only target a submission the actor can actually see.
-- Previously any authenticated user could POST feedback at any UUID.
-- ---------------------------------------------------------------------------
drop policy if exists "Users insert own feedback" on public.breakdown_feedback;
create policy "Users insert own feedback"
  on public.breakdown_feedback for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.submissions s
      where s.id = submission_id
        and (s.user_id = auth.uid() or s.status = 'verified')
    )
  );

-- ---------------------------------------------------------------------------
-- C-2b: publication is an editorial decision, not a crowd signal.
-- Three 5-star ratings used to flip another user's private draft to public.
-- Rating aggregation stays; the status transition is removed.
-- ---------------------------------------------------------------------------
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
  set rating_avg = v_avg,
      rating_count = v_count
  where id = new.submission_id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- H-8: owners can update and delete their own submissions.
-- Without this there was no way for a user to delete their own data at all.
-- Status/slug/rating/embedding stay service-role territory.
-- ---------------------------------------------------------------------------
drop policy if exists "Users update own submissions" on public.submissions;
create policy "Users update own submissions"
  on public.submissions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own submissions" on public.submissions;
create policy "Users delete own submissions"
  on public.submissions for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.protect_submission_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if new.status is distinct from old.status
       or new.slug is distinct from old.slug
       or new.rating_avg is distinct from old.rating_avg
       or new.rating_count is distinct from old.rating_count
       or new.view_count is distinct from old.view_count
       or new.embedding is distinct from old.embedding
       or new.user_id is distinct from old.user_id then
      raise exception 'cannot change moderated submission fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_submission_columns on public.submissions;
create trigger protect_submission_columns
  before update on public.submissions
  for each row execute function public.protect_submission_columns();

-- ---------------------------------------------------------------------------
-- M-7: the public library used to expose select * on verified rows, leaking
-- user_id, file_path, frame_paths, error_message, research_context, embedding.
-- Public reads now go through a column-scoped view.
-- ---------------------------------------------------------------------------
drop policy if exists "Verified submissions are publicly viewable" on public.submissions;

create or replace view public.library_shots
with (security_invoker = off) as
  select
    s.id,
    s.slug,
    s.title,
    s.thumbnail_url,
    s.source_url,
    s.source_type,
    s.tags,
    s.breakdown,
    s.breakdown_user_edits,
    s.rating_avg,
    s.rating_count,
    s.view_count,
    s.created_at,
    s.updated_at,
    public.credited_name(s.user_id) as credited_to
  from public.submissions s
  where s.status = 'verified'
    and s.slug is not null;

grant select on public.library_shots to anon, authenticated;

-- ---------------------------------------------------------------------------
-- H-1/H-2/H-3 + M-9: shared fixed-window rate limiter.
-- Postgres-backed so it works across serverless instances with no new infra.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, subject, window_start)
);

alter table public.rate_limits enable row level security;
drop policy if exists "rate_limits service only" on public.rate_limits;
create policy "rate_limits service only" on public.rate_limits for all using (false);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

/*
 * Atomically consume one unit from a fixed window.
 * Returns (allowed, remaining, reset_at). One statement, so concurrent
 * requests on the same key cannot both slip past the limit.
 */
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1)
  );

  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, p_subject, v_window_start, 1)
  on conflict (bucket, subject, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window_start + make_interval(secs => greatest(p_window_seconds, 1));
end;
$$;

grant execute on function public.consume_rate_limit(text, text, int, int) to service_role;

create or replace function public.prune_rate_limits()
returns int
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.rate_limits
    where window_start < now() - interval '2 days'
    returning 1
  )
  select count(*)::int from deleted;
$$;

grant execute on function public.prune_rate_limits() to service_role;
