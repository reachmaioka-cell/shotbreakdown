-- The column-protection triggers rejected writes made by our own SECURITY
-- DEFINER counter functions.
--
-- auth.role() reads the caller's JWT claim, which stays 'authenticated' inside a
-- SECURITY DEFINER function — so refresh_shot_save_count() and
-- increment_shot_view() were raising "cannot change pipeline-owned shot fields"
-- and a plain save returned a 500. current_user is the right discriminator: it
-- is the function owner inside SECURITY DEFINER, and the request role otherwise.

create or replace function public.protect_shot_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status
       or new.embedding is distinct from old.embedding
       or new.user_id is distinct from old.user_id
       or new.video_id is distinct from old.video_id
       or new.view_count is distinct from old.view_count
       or new.save_count is distinct from old.save_count
       or new.rating_avg is distinct from old.rating_avg
       or new.is_editorial is distinct from old.is_editorial
       or new.start_seconds is distinct from old.start_seconds
       or new.end_seconds is distinct from old.end_seconds then
      raise exception 'cannot change pipeline-owned shot fields';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_video_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status
       or new.progress is distinct from old.progress
       or new.shot_count is distinct from old.shot_count
       or new.analyzed_shot_count is distinct from old.analyzed_shot_count
       or new.user_id is distinct from old.user_id
       or new.file_path is distinct from old.file_path
       or new.duration_seconds is distinct from old.duration_seconds then
      raise exception 'cannot change pipeline-owned video fields';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_submission_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
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
