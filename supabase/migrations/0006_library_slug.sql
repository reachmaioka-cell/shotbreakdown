create or replace function public.generate_slug(p_title text, p_id uuid)
returns text
language plpgsql
immutable
as $$
declare
  base text;
  short_id text;
begin
  short_id := substr(replace(p_id::text, '-', ''), 1, 8);
  base := lower(coalesce(p_title, ''));
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := regexp_replace(base, '(^-+|-+$)', '', 'g');
  if base is null or length(base) < 3 then
    base := 'shot';
  end if;
  base := left(base, 48);
  return base || '-' || short_id;
end;
$$;

create or replace function public.ensure_verified_slug()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'verified' and (new.slug is null or new.slug = '') then
    new.slug := public.generate_slug(new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_verified_slug on public.submissions;
create trigger ensure_verified_slug
  before update on public.submissions
  for each row execute function public.ensure_verified_slug();

-- Verified rows must keep a slug. Enforced for new verifies; backfill existing.
update public.submissions
set slug = public.generate_slug(title, id)
where status = 'verified' and (slug is null or slug = '');

-- Public credit line without exposing email.
create or replace function public.credited_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select display_name
  from public.profiles
  where id = p_user_id
    and credit_me = true
    and display_name is not null
    and length(display_name) > 0;
$$;

grant execute on function public.credited_name(uuid) to anon, authenticated;
