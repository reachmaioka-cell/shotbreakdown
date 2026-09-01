-- Failed processing + metadata used by async jobs and the public library.
alter type public.submission_status add value if not exists 'failed';

alter table public.submissions
  add column if not exists error_message text,
  add column if not exists thumbnail_url text,
  add column if not exists title text,
  add column if not exists slug text,
  add column if not exists view_count int not null default 0;

create unique index if not exists submissions_slug_key on public.submissions (slug);

-- Atomic free-tier increment. Returns false when the user is at the cap (or has no profile).
create or replace function public.increment_breakdown_count(p_user_id uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return false;
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
