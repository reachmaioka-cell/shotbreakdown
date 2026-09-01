-- Backfill the existing submissions corpus into videos + shots.
--
-- The seeded editorial library has no owner (user_id is null on every row), so
-- ownership becomes nullable and editorial content is marked explicitly. RLS is
-- unaffected: `auth.uid() = user_id` is never true for a null owner, so nothing
-- ownerless is readable unless it is also public.

alter table public.videos alter column user_id drop not null;
alter table public.shots alter column user_id drop not null;
alter table public.shot_frames alter column user_id drop not null;

alter table public.videos add column if not exists is_editorial boolean not null default false;

-- One video per submission, carrying the source and the completion state.
insert into public.videos (
  id, user_id, source_type, source_url, file_path, title, status, visibility,
  poster_path, shot_count, analyzed_shot_count, is_editorial, error_message,
  created_at, updated_at, completed_at
)
select
  s.id,                                   -- reuse the id so /breakdown/[id] still resolves
  s.user_id,
  s.source_type,
  s.source_url,
  s.file_path,
  s.title,
  case
    when s.status = 'failed' then 'failed'::public.video_status
    when s.breakdown is null then 'failed'::public.video_status
    else 'complete'::public.video_status
  end,
  case when s.status = 'verified' then 'public'::public.content_visibility
       else 'private'::public.content_visibility end,
  s.thumbnail_url,
  case when s.breakdown is null then 0 else 1 end,
  case when s.breakdown is null then 0 else 1 end,
  s.user_id is null,
  s.error_message,
  s.created_at,
  s.updated_at,
  case when s.breakdown is not null then s.updated_at end
from public.submissions s
where not exists (select 1 from public.videos v where v.id = s.id);

-- One shot per submission. A link or a still is simply a single-shot video.
insert into public.shots (
  video_id, user_id, submission_id, shot_index, start_seconds, end_seconds,
  title, slug, thumbnail_path, poster_path, metadata, metadata_edits, embedding,
  prompt_version, status, visibility, is_editorial, tags, aspect_ratio,
  view_count, rating_avg, rating_count, created_at, updated_at
)
select
  s.id,
  s.user_id,
  s.id,
  0,
  0,
  0,
  s.title,
  s.slug,
  s.thumbnail_url,
  s.thumbnail_url,
  s.breakdown,
  s.breakdown_user_edits,
  s.embedding,
  s.prompt_version,
  case when s.breakdown is null then 'failed'::public.shot_status
       else 'complete'::public.shot_status end,
  case when s.status = 'verified' then 'public'::public.content_visibility
       else 'private'::public.content_visibility end,
  s.user_id is null,
  coalesce(s.tags, '{}'),
  '16:9',
  coalesce(s.view_count, 0),
  s.rating_avg,
  coalesce(s.rating_count, 0),
  s.created_at,
  s.updated_at
from public.submissions s
where s.breakdown is not null
  and not exists (select 1 from public.shots sh where sh.submission_id = s.id);

-- Frames that live in our storage bucket (not remote thumbnails) become
-- selectable candidate frames.
insert into public.shot_frames (shot_id, video_id, user_id, timestamp_seconds, storage_path, is_representative)
select
  sh.id,
  sh.video_id,
  sh.user_id,
  0,
  fp.path,
  fp.ord = 1
from public.shots sh
join public.submissions s on s.id = sh.submission_id
cross join lateral unnest(coalesce(s.frame_paths, '{}')) with ordinality as fp(path, ord)
where fp.path not like 'http%'
  and not exists (
    select 1 from public.shot_frames f where f.shot_id = sh.id and f.storage_path = fp.path
  );

update public.shots sh
set representative_frame_id = f.id,
    representative_timestamp = f.timestamp_seconds
from public.shot_frames f
where f.shot_id = sh.id
  and f.is_representative
  and sh.representative_frame_id is null;

-- Retrieval now reads shots. The old function name is kept so the existing
-- learning/RAG callers keep working while they are migrated.
create or replace function public.match_shots(
  query_embedding vector(1536),
  match_k int default 12,
  p_user_id uuid default null
)
returns table (
  id uuid,
  slug text,
  video_id uuid,
  title text,
  thumbnail_path text,
  tags text[],
  metadata jsonb,
  metadata_edits jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.slug, s.video_id, s.title, s.thumbnail_path, s.tags,
         s.metadata, s.metadata_edits,
         1 - (s.embedding <=> query_embedding) as similarity
  from public.shots s
  where s.embedding is not null
    and s.status = 'complete'
    and (s.visibility = 'public' or (p_user_id is not null and s.user_id = p_user_id))
  order by s.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_shots(vector, int, uuid) to anon, authenticated, service_role;
