-- Storage paths are pipeline-owned. A client that can write one can read any file.
--
-- videos.poster_path and shots.poster_path / thumbnail_path are handed to
-- resolveMediaUrl(), which signs them with the SERVICE ROLE. Nothing downstream
-- re-checks who owns the object, because until now nothing could point one of
-- those columns at a file it did not own.
--
-- Both tables carry an owner UPDATE policy, so an authenticated user could PATCH
-- their own row through PostgREST, set poster_path to another user's object key,
-- load the page, and receive a working signed URL to that file. Confirmed by
-- running it: the attacker read a victim's private frame end to end.
--
-- The fix is to say what was already true in the code: only the pipeline writes
-- these. Every legitimate writer — lib/pipeline/stages.ts, the frame picker at
-- app/api/shots/[id]/frame/route.ts, the corrections route at
-- app/api/shots/[id]/metadata/route.ts — already goes through the service role,
-- so none of them is affected. shot_frames has no UPDATE policy at all and needs
-- nothing.
--
-- Deliberately still client-writable: videos.title, videos.focus,
-- videos.visibility and shots.visibility (the user's own naming, question and
-- sharing), and shots.metadata_edits (corrections are stored beside the AI
-- record, never over it).

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
       or new.completed_at is distinct from old.completed_at then
      raise exception 'cannot change pipeline-owned video fields';
    end if;
  end if;
  return new;
end;
$$;

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
       or new.aspect_ratio is distinct from old.aspect_ratio then
      raise exception 'cannot change pipeline-owned shot fields';
    end if;
  end if;
  return new;
end;
$$;
