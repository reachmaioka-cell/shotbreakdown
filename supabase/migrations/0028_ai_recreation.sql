-- The generative route to the same segment, stored beside the camera route.
--
-- The breakdown answers "how was this shot, and how would I shoot it". A reader
-- who has no camera, no permit and no crew wants the other answer: which tools,
-- which prompts, which settings, and what will still be wrong. That answer is
-- generated ON DEMAND, never automatically — most people opening a breakdown
-- intend to shoot the thing, and spending a model call on an answer nobody
-- asked for is padding — so it needs its own columns and its own status rather
-- than riding along inside videos.breakdown.
--
-- Additive only. Every column is nullable, so existing rows read as "nobody has
-- asked for the AI route yet".

alter table public.videos
  -- The document itself, validated by StoredAiRecreationSchema.
  add column if not exists ai_recreation jsonb,
  add column if not exists ai_recreation_status text,
  add column if not exists ai_recreation_error text,
  add column if not exists ai_recreation_prompt_version text,
  add column if not exists ai_recreation_generated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_ai_recreation_status_check'
  ) then
    alter table public.videos
      add constraint videos_ai_recreation_status_check
      check (ai_recreation_status is null or ai_recreation_status in ('pending', 'ready', 'failed'));
  end if;
end
$$;

/*
 * The pipeline owns the AI recreation and its status, exactly as it owns the
 * breakdown: a client that could write these could fabricate a document, or
 * mark a failed generation ready and bill nobody for it.
 *
 * This replaces the function wholesale, so the WHOLE column list from migration
 * 0027 is carried forward. Dropping any line here would silently reopen the
 * storage-path hole 0027 closed.
 */
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
       or new.duration_seconds is distinct from old.duration_seconds
       or new.segment_start is distinct from old.segment_start
       or new.segment_end is distinct from old.segment_end
       or new.source_duration_seconds is distinct from old.source_duration_seconds
       or new.breakdown is distinct from old.breakdown
       or new.breakdown_status is distinct from old.breakdown_status
       or new.breakdown_error is distinct from old.breakdown_error
       or new.breakdown_prompt_version is distinct from old.breakdown_prompt_version
       or new.breakdown_generated_at is distinct from old.breakdown_generated_at
       -- Signed with the service role, so it must never be client-chosen.
       or new.poster_path is distinct from old.poster_path
       -- Probe- and ingest-derived; a client rewriting these misreports the file.
       or new.content_hash is distinct from old.content_hash
       or new.size_bytes is distinct from old.size_bytes
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.fps is distinct from old.fps
       or new.aspect_ratio is distinct from old.aspect_ratio
       or new.completed_at is distinct from old.completed_at
       -- Written only by the generate_ai_recreation job.
       or new.ai_recreation is distinct from old.ai_recreation
       or new.ai_recreation_status is distinct from old.ai_recreation_status
       or new.ai_recreation_error is distinct from old.ai_recreation_error
       or new.ai_recreation_prompt_version is distinct from old.ai_recreation_prompt_version
       or new.ai_recreation_generated_at is distinct from old.ai_recreation_generated_at then
      raise exception 'cannot change pipeline-owned video fields';
    end if;
  end if;
  return new;
end;
$$;
