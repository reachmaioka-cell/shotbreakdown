-- Curation is a separate state from publication.
--
-- Editorial rows are seeded from footage nobody here shot, so each one has to
-- be looked at before it can stand in the library. Until now the only way to
-- record that decision was `visibility`, which meant approving a shot and
-- exposing it were the same write — and a row with `visibility = 'public'` is
-- readable by anyone straight from PostgREST with the publishable anon key that
-- ships in the browser bundle. Approving for weeks before launch was therefore
-- impossible without publishing as you went.
--
-- `review_status` splits the two. The corpus stays `private` while it is
-- curated; scripts/publish-editorial.ts flips the approved rows to `public` at
-- launch, and scripts/unpublish-editorial.ts flips them back.
--
-- Additive only, and deliberately not retroactive: rows already seeded public
-- by earlier runs keep the visibility they have. Taking an existing corpus
-- private is a data decision with its own one-line command in
-- docs/editorial-runbook.md, not something a schema migration should do behind
-- whoever runs it.

alter table public.shots
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  -- Who made the call. Set null if the account is later deleted; the decision
  -- itself is still on the row.
  add column if not exists reviewed_by uuid references auth.users on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shots_review_status_check'
  ) then
    alter table public.shots
      add constraint shots_review_status_check
      check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

comment on column public.shots.review_status is
  'Curation state, independent of visibility: pending until an admin looks at it, then approved or rejected. Only approved editorial rows are published by scripts/publish-editorial.ts.';

-- The queue reads exactly this predicate, and only editorial rows are ever in
-- it, so the index carries the corpus and not the customers'' uploads.
create index if not exists shots_editorial_review_idx
  on public.shots (is_editorial, review_status)
  where is_editorial;

/*
 * The review decision is the admin surface's to write, the same way the
 * pipeline owns its own columns. A client that could PATCH review_status
 * through PostgREST could approve its own row and ride the launch script into
 * the public library.
 *
 * This replaces the function wholesale, so the WHOLE column list from migration
 * 0029 is carried forward. Dropping any line here would silently reopen the
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
       or new.motion_profile is distinct from old.motion_profile
       -- Written by /api/admin/review as the service role, and read by the
       -- launch script to decide what becomes public.
       or new.review_status is distinct from old.review_status
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by then
      raise exception 'cannot change pipeline-owned shot fields';
    end if;
  end if;
  return new;
end;
$$;
