-- Frame-to-frame change across each shot, measured at ingest.
--
-- The breakdown model is shown a handful of stills per shot. Stills cannot
-- show a speed ramp, a freeze, a hold or a rewind; a series of how much the
-- picture changed from one frame to the next can. It is stored on the shot so
-- the prompt can be rebuilt, and old rows re-described, without re-reading
-- the footage.

alter table public.shots add column if not exists motion_profile jsonb;

comment on column public.shots.motion_profile is
  '{fps, scores}: frame-to-frame change energy across the shot, sampled at fps per second from the shot''s start. Written by ingest; read when the breakdown prompt is built.';

/*
 * The pipeline owns the measurement. A client that could write it could put a
 * ramp or a freeze into the model's evidence that the footage never had.
 *
 * This replaces the function wholesale, so the WHOLE column list from migration
 * 0027 is carried forward. Dropping any line here would silently reopen the
 * storage-path hole 0027 closed.
 */
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
       or new.end_seconds is distinct from old.end_seconds
       -- Both are signed with the service role. Same hole as videos.poster_path.
       or new.poster_path is distinct from old.poster_path
       or new.thumbnail_path is distinct from old.thumbnail_path
       -- Chosen through the frame picker, which validates the frame belongs to
       -- the shot and writes as service_role.
       or new.representative_frame_id is distinct from old.representative_frame_id
       or new.representative_timestamp is distinct from old.representative_timestamp
       -- The model's record. Corrections live in metadata_edits, which stays open.
       or new.metadata is distinct from old.metadata
       or new.prompt_version is distinct from old.prompt_version
       or new.slug is distinct from old.slug
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.aspect_ratio is distinct from old.aspect_ratio
       -- Measured from the footage by ingest; the model's motion evidence.
       or new.motion_profile is distinct from old.motion_profile then
      raise exception 'cannot change pipeline-owned shot fields';
    end if;
  end if;
  return new;
end;
$$;
