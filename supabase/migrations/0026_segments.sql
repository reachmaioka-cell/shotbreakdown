-- The unit of the product becomes the segment.
--
-- A user uploads a SEGMENT of a video, never a whole video, and may say what
-- they want to know about it. The breakdown that answers them belongs to the
-- segment, not to any one shot inside it: what happens, how the shots are built
-- and cut together, and what each department has to do to recreate it.
--
-- Additive only. Every column is nullable, so the 103 existing rows stay valid
-- and read as "whole file, no focus, no breakdown".

alter table public.videos
  -- What the uploader asked. Free text, theirs to edit, steers the breakdown.
  add column if not exists focus text,
  -- The chosen range within the ORIGINAL file, in seconds. Null on both means
  -- the whole file was taken. After ingest, file_path points at the trimmed
  -- segment and every shot timecode is relative to it, so these two columns are
  -- provenance ("this came from 1:12 to 1:42 of what I uploaded"), not offsets
  -- anything downstream needs to add.
  add column if not exists segment_start numeric,
  add column if not exists segment_end numeric,
  -- Duration of the file the user actually uploaded, before trimming.
  add column if not exists source_duration_seconds numeric,
  -- The segment breakdown itself, validated by StoredSegmentBreakdownSchema.
  add column if not exists breakdown jsonb,
  add column if not exists breakdown_status text,
  add column if not exists breakdown_error text,
  add column if not exists breakdown_prompt_version text,
  add column if not exists breakdown_generated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_breakdown_status_check'
  ) then
    alter table public.videos
      add constraint videos_breakdown_status_check
      check (breakdown_status is null or breakdown_status in ('pending', 'ready', 'failed'));
  end if;
end
$$;

-- Finding segments still waiting on a breakdown is a hot path for the worker
-- and for the segments list; the settled majority does not need indexing.
create index if not exists videos_breakdown_pending_idx
  on public.videos (user_id, created_at desc)
  where breakdown_status = 'pending';

/*
 * The pipeline owns the segment range, the breakdown and its status.
 *
 * `focus` is deliberately NOT protected: it is the user's question and they may
 * rewrite it, which is what the refocus flow does. Everything the pipeline
 * derives from that question is protected, so a client cannot fabricate a
 * breakdown or mark a failed one ready.
 *
 * current_user rather than auth.role(): inside a SECURITY DEFINER function the
 * JWT claim stays 'authenticated' while current_user becomes the owner, which is
 * the distinction migration 0022 established.
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
       or new.breakdown_generated_at is distinct from old.breakdown_generated_at then
      raise exception 'cannot change pipeline-owned video fields';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-up chat about a whole segment, not just one shot inside it.
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists video_id uuid references public.videos on delete cascade;

create unique index if not exists conversations_video_user_idx
  on public.conversations (video_id, user_id)
  where video_id is not null;

-- ---------------------------------------------------------------------------
-- Which department the user actually works in.
--
-- The breakdown always covers all nine; this only decides which one leads and
-- which one the UI opens first.
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  add column if not exists role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_preferences_role_check'
  ) then
    alter table public.user_preferences
      add constraint user_preferences_role_check
      check (role is null or role in (
        'director', 'camera', 'lighting_grip', 'art_department', 'editorial',
        'color', 'vfx', 'sound', 'producer', 'other'
      ));
  end if;
end
$$;
