-- The shot-first data model.
--
-- Until now one upload produced one `submissions` row and one breakdown. The
-- product is a searchable library of *shots*, so `shots` becomes the canonical
-- unit: every ingest (video upload, still upload, platform link) creates one
-- `videos` row and one-or-many `shots`. Everything downstream — library,
-- search, save, collections, sequences, sharing, export, SEO — reads `shots`.
--
-- 0018 backfills the existing `submissions` rows into this model.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/* jsonb array -> text[]. IMMUTABLE so generated facet columns can use it. */
create or replace function public.jsonb_to_text_array(p jsonb)
returns text[]
language sql
immutable
parallel safe
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then '{}'::text[]
    else array(select jsonb_array_elements_text(p))
  end;
$$;

/* array_to_string() is only STABLE, so it cannot appear in a generated column. */
create or replace function public.text_array_to_string(p text[], p_sep text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(array_to_string(p, p_sep), '');
$$;

create or replace function public.slugify(p_text text, p_id uuid)
returns text
language sql
immutable
as $$
  select left(
           nullif(regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
           48
         ) || '-' || substr(replace(p_id::text, '-', ''), 1, 8);
$$;

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------

create type public.video_status as enum (
  'queued',
  'processing',
  'detecting_shots',
  'extracting_frames',
  'analyzing',
  'indexing',
  'complete',
  'failed',
  'canceled'
);

create type public.content_visibility as enum ('private', 'unlisted', 'public');

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  source_type public.submission_source not null,
  source_url text,
  file_path text,
  title text,
  description text,
  duration_seconds numeric,
  width int,
  height int,
  fps numeric,
  aspect_ratio text,
  size_bytes bigint,
  poster_path text,
  status public.video_status not null default 'queued',
  stage_detail text,
  progress int not null default 0 check (progress between 0 and 100),
  shot_count int not null default 0,
  analyzed_shot_count int not null default 0,
  error_message text,
  error_code text,
  visibility public.content_visibility not null default 'private',
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists videos_user_created_idx on public.videos (user_id, created_at desc);
create index if not exists videos_status_idx on public.videos (status) where status not in ('complete', 'failed', 'canceled');
create unique index if not exists videos_user_content_hash_idx
  on public.videos (user_id, content_hash)
  where content_hash is not null;

drop trigger if exists videos_updated_at on public.videos;
create trigger videos_updated_at
  before update on public.videos
  for each row execute procedure public.set_updated_at();

alter table public.videos enable row level security;

create policy "videos owner select" on public.videos for select to authenticated
  using (auth.uid() = user_id);
create policy "videos public select" on public.videos for select to anon, authenticated
  using (visibility = 'public');
create policy "videos owner insert" on public.videos for insert to authenticated
  with check (auth.uid() = user_id);
create policy "videos owner update" on public.videos for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "videos owner delete" on public.videos for delete to authenticated
  using (auth.uid() = user_id);

-- Pipeline-owned columns cannot be moved by the client.
create or replace function public.protect_video_columns()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
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

drop trigger if exists protect_video_columns on public.videos;
create trigger protect_video_columns
  before update on public.videos
  for each row execute function public.protect_video_columns();

-- ---------------------------------------------------------------------------
-- shots
-- ---------------------------------------------------------------------------

create type public.shot_status as enum ('pending', 'analyzing', 'complete', 'failed');

create table if not exists public.shots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  submission_id uuid references public.submissions on delete set null,
  shot_index int not null default 0,
  start_seconds numeric not null default 0,
  end_seconds numeric not null default 0,
  duration_seconds numeric generated always as (greatest(end_seconds - start_seconds, 0)) stored,

  title text,
  slug text unique,
  thumbnail_path text,
  poster_path text,
  representative_frame_id uuid,
  representative_timestamp numeric,

  metadata jsonb,
  metadata_edits jsonb,
  embedding vector(1536),
  prompt_version text,

  status public.shot_status not null default 'pending',
  error_message text,
  visibility public.content_visibility not null default 'private',
  is_editorial boolean not null default false,

  tags text[] not null default '{}',
  width int,
  height int,
  aspect_ratio text,

  view_count int not null default 0,
  save_count int not null default 0,
  rating_avg numeric,
  rating_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Facets derived from metadata. Generated so there is exactly one source of
  -- truth and no drift between the JSON and what search filters on.
  shot_size text generated always as (metadata #>> '{composition,shot_size}') stored,
  camera_angle text generated always as (metadata #>> '{composition,camera_angle}') stored,
  camera_height text generated always as (metadata #>> '{composition,camera_height}') stored,
  movement_type text generated always as (metadata #>> '{movement_facets,type}') stored,
  movement_speed text generated always as (metadata #>> '{movement_facets,speed}') stored,
  movement_direction text generated always as (metadata #>> '{movement_facets,direction}') stored,
  lens_type text generated always as (metadata #>> '{optics,lens_type}') stored,
  depth_of_field text generated always as (metadata #>> '{optics,depth_of_field}') stored,
  lighting_quality text generated always as (metadata #>> '{lighting_facets,quality}') stored,
  lighting_key text generated always as (metadata #>> '{lighting_facets,key_level}') stored,
  key_direction text generated always as (metadata #>> '{lighting_facets,key_direction}') stored,
  lighting_source text generated always as (metadata #>> '{lighting_facets,source}') stored,
  lighting_contrast text generated always as (metadata #>> '{lighting_facets,contrast}') stored,
  color_temperature text generated always as (metadata #>> '{color_facets,temperature}') stored,
  saturation text generated always as (metadata #>> '{color_facets,saturation}') stored,
  interior_exterior text generated always as (metadata #>> '{environment,interior_exterior}') stored,
  time_of_day text generated always as (metadata #>> '{environment,time_of_day}') stored,
  location_type text generated always as (metadata #>> '{environment,location_type}') stored,
  subject_types text[] generated always as (public.jsonb_to_text_array(metadata #> '{subject,types}')) stored,
  moods text[] generated always as (public.jsonb_to_text_array(metadata #> '{mood}')) stored,
  dominant_colors text[] generated always as (public.jsonb_to_text_array(metadata #> '{color_facets,dominant_colors}')) stored,
  description text generated always as (metadata ->> 'description') stored,
  summary text generated always as (metadata ->> 'one_line_summary') stored,

  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(metadata ->> 'description', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(metadata ->> 'one_line_summary', '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('english', public.text_array_to_string(tags, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(metadata ->> 'why_it_works', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(metadata #>> '{environment,location_type}', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(metadata #>> '{subject,description}', '')), 'C')
  ) stored
);

create index if not exists shots_video_idx on public.shots (video_id, shot_index);
create index if not exists shots_user_created_idx on public.shots (user_id, created_at desc);
create index if not exists shots_public_created_idx on public.shots (created_at desc) where visibility = 'public';
create index if not exists shots_embedding_idx on public.shots using hnsw (embedding vector_cosine_ops);
create index if not exists shots_search_idx on public.shots using gin (search_tsv);
create index if not exists shots_tags_idx on public.shots using gin (tags);
create index if not exists shots_subject_idx on public.shots using gin (subject_types);
create index if not exists shots_moods_idx on public.shots using gin (moods);
create index if not exists shots_colors_idx on public.shots using gin (dominant_colors);
create index if not exists shots_facets_idx on public.shots (shot_size, movement_type, lighting_key, time_of_day);
create index if not exists shots_status_idx on public.shots (status) where status in ('pending', 'analyzing');

drop trigger if exists shots_updated_at on public.shots;
create trigger shots_updated_at
  before update on public.shots
  for each row execute procedure public.set_updated_at();

create or replace function public.ensure_shot_slug()
returns trigger language plpgsql as $$
begin
  if new.visibility = 'public' and (new.slug is null or new.slug = '') then
    new.slug := public.slugify(
      coalesce(nullif(new.title, ''), new.metadata ->> 'one_line_summary', 'shot'),
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_shot_slug on public.shots;
create trigger ensure_shot_slug
  before insert or update on public.shots
  for each row execute function public.ensure_shot_slug();

alter table public.shots enable row level security;

create policy "shots owner select" on public.shots for select to authenticated
  using (auth.uid() = user_id);
create policy "shots public select" on public.shots for select to anon, authenticated
  using (visibility = 'public');
create policy "shots owner insert" on public.shots for insert to authenticated
  with check (auth.uid() = user_id);
create policy "shots owner update" on public.shots for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "shots owner delete" on public.shots for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.protect_shot_columns()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
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

drop trigger if exists protect_shot_columns on public.shots;
create trigger protect_shot_columns
  before update on public.shots
  for each row execute function public.protect_shot_columns();

-- ---------------------------------------------------------------------------
-- shot_frames — every candidate frame, so the user can pick a different one
-- ---------------------------------------------------------------------------

create table if not exists public.shot_frames (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots on delete cascade,
  video_id uuid not null references public.videos on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  timestamp_seconds numeric not null,
  storage_path text not null,
  thumb_path text,
  width int,
  height int,
  score numeric,
  is_representative boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists shot_frames_shot_idx on public.shot_frames (shot_id, timestamp_seconds);
create unique index if not exists shot_frames_representative_idx
  on public.shot_frames (shot_id) where is_representative;

alter table public.shot_frames enable row level security;

create policy "shot_frames owner select" on public.shot_frames for select to authenticated
  using (auth.uid() = user_id);
create policy "shot_frames public select" on public.shot_frames for select to anon, authenticated
  using (exists (select 1 from public.shots s where s.id = shot_id and s.visibility = 'public'));
create policy "shot_frames owner delete" on public.shot_frames for delete to authenticated
  using (auth.uid() = user_id);

alter table public.shots
  add constraint shots_representative_frame_fkey
  foreign key (representative_frame_id) references public.shot_frames (id) on delete set null;

-- ---------------------------------------------------------------------------
-- collections and sequences
--
-- One table, not two. A sequence is a collection whose order is meaningful;
-- kind drives the UI (shot numbers, notes, reordering) rather than the schema.
-- parent_id gives optional hierarchy that a user can ignore entirely.
-- ---------------------------------------------------------------------------

create type public.collection_kind as enum ('collection', 'sequence');

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  parent_id uuid references public.collections on delete set null,
  kind public.collection_kind not null default 'collection',
  name text not null,
  slug text not null,
  description text,
  cover_shot_id uuid references public.shots on delete set null,
  visibility public.content_visibility not null default 'private',
  position int not null default 0,
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists collections_user_idx on public.collections (user_id, updated_at desc);
create index if not exists collections_parent_idx on public.collections (parent_id);
create index if not exists collections_public_idx on public.collections (visibility) where visibility <> 'private';

drop trigger if exists collections_updated_at on public.collections;
create trigger collections_updated_at
  before update on public.collections
  for each row execute procedure public.set_updated_at();

/* A collection cannot become its own ancestor. */
create or replace function public.check_collection_cycle()
returns trigger language plpgsql as $$
declare
  ancestor uuid := new.parent_id;
  hops int := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'a collection cannot be its own parent'; end if;
  while ancestor is not null and hops < 32 loop
    if ancestor = new.id then raise exception 'collection hierarchy would form a cycle'; end if;
    select parent_id into ancestor from public.collections where id = ancestor;
    hops := hops + 1;
  end loop;
  if hops >= 32 then raise exception 'collection hierarchy is too deep'; end if;
  return new;
end;
$$;

drop trigger if exists check_collection_cycle on public.collections;
create trigger check_collection_cycle
  before insert or update of parent_id on public.collections
  for each row execute function public.check_collection_cycle();

alter table public.collections enable row level security;

create policy "collections owner all" on public.collections for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "collections public select" on public.collections for select to anon, authenticated
  using (visibility = 'public');

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections on delete cascade,
  shot_id uuid not null references public.shots on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  position int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (collection_id, shot_id)
);

create index if not exists collection_items_collection_idx
  on public.collection_items (collection_id, position);

alter table public.collection_items enable row level security;

create policy "collection_items owner all" on public.collection_items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "collection_items public select" on public.collection_items for select to anon, authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id and c.visibility = 'public'));

create or replace function public.refresh_collection_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.collection_id, old.collection_id);
begin
  update public.collections
  set item_count = (select count(*) from public.collection_items where collection_id = target),
      updated_at = now()
  where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_collection_count on public.collection_items;
create trigger refresh_collection_count
  after insert or delete on public.collection_items
  for each row execute function public.refresh_collection_count();

-- ---------------------------------------------------------------------------
-- saved shots
-- ---------------------------------------------------------------------------

create table if not exists public.saved_shots (
  user_id uuid not null references auth.users on delete cascade,
  shot_id uuid not null references public.shots on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shot_id)
);

create index if not exists saved_shots_user_idx on public.saved_shots (user_id, created_at desc);

alter table public.saved_shots enable row level security;

create policy "saved_shots owner all" on public.saved_shots for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.refresh_shot_save_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.shot_id, old.shot_id);
begin
  update public.shots
  set save_count = (select count(*) from public.saved_shots where shot_id = target)
  where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists refresh_shot_save_count on public.saved_shots;
create trigger refresh_shot_save_count
  after insert or delete on public.saved_shots
  for each row execute function public.refresh_shot_save_count();

-- ---------------------------------------------------------------------------
-- shares — one table for shots, collections and videos
-- ---------------------------------------------------------------------------

create type public.share_resource as enum ('shot', 'collection', 'video');

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  resource_type public.share_resource not null,
  resource_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (resource_type, resource_id, user_id)
);

create index if not exists shares_resource_idx on public.shares (resource_type, resource_id);

alter table public.shares enable row level security;

create policy "shares owner all" on public.shares for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- processing_jobs — durable, staged, resumable
--
-- Mirrors the existing learning_jobs pattern (FOR UPDATE SKIP LOCKED, attempts,
-- dedupe key, backoff) rather than introducing a second queue mechanism.
-- ---------------------------------------------------------------------------

create type public.processing_job_status as enum ('pending', 'running', 'done', 'failed', 'canceled');

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos on delete cascade,
  user_id uuid references auth.users on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.processing_job_status not null default 'pending',
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  error_message text,
  result jsonb,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists processing_jobs_dedupe_active_idx
  on public.processing_jobs (dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

create index if not exists processing_jobs_pending_idx
  on public.processing_jobs (priority desc, scheduled_at)
  where status = 'pending';

create index if not exists processing_jobs_video_idx on public.processing_jobs (video_id, created_at desc);

alter table public.processing_jobs enable row level security;
create policy "processing_jobs owner select" on public.processing_jobs for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.claim_processing_jobs(batch_size int default 3)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.processing_jobs j
  set status = 'running',
      started_at = now(),
      heartbeat_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select id from public.processing_jobs
    where status = 'pending'
      and scheduled_at <= now()
      and attempts < max_attempts
    order by priority desc, scheduled_at asc
    limit greatest(batch_size, 1)
    for update skip locked
  )
  returning j.*;
end;
$$;

grant execute on function public.claim_processing_jobs(int) to service_role;

/* Return jobs that died mid-run (no heartbeat) to the queue. */
create or replace function public.reclaim_stalled_jobs(p_stale_seconds int default 600)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with reset as (
    update public.processing_jobs
    set status = case when attempts >= max_attempts then 'failed'::public.processing_job_status
                      else 'pending'::public.processing_job_status end,
        error_message = coalesce(error_message, 'worker stalled'),
        scheduled_at = now(),
        started_at = null
    where status = 'running'
      and coalesce(heartbeat_at, started_at, created_at) < now() - make_interval(secs => p_stale_seconds)
    returning 1
  )
  select count(*)::int into v_count from reset;
  return v_count;
end;
$$;

grant execute on function public.reclaim_stalled_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- shot_edits — corrections, used to measure where the AI is weak
-- ---------------------------------------------------------------------------

create table if not exists public.shot_edits (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('metadata_changed', 'tag_added', 'tag_removed', 'frame_changed')),
  field_key text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shot_edits_shot_idx on public.shot_edits (shot_id, created_at desc);
create index if not exists shot_edits_field_idx on public.shot_edits (kind, field_key);

alter table public.shot_edits enable row level security;
create policy "shot_edits owner select" on public.shot_edits for select to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- analytics_events — product behaviour, no unnecessary personal data
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_events (
  id bigserial primary key,
  user_id uuid references auth.users on delete set null,
  anon_id text,
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_idx on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_user_idx on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;
create policy "analytics service only" on public.analytics_events for all using (false);

-- ---------------------------------------------------------------------------
-- exports
-- ---------------------------------------------------------------------------

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  resource_type public.share_resource not null,
  resource_id uuid not null,
  format text not null check (format in ('pdf', 'csv', 'json', 'contact_sheet')),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists exports_user_idx on public.exports (user_id, created_at desc);

alter table public.exports enable row level security;
create policy "exports owner select" on public.exports for select to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- public read surface: column-scoped, never exposes storage paths or user_id
-- ---------------------------------------------------------------------------

create or replace view public.public_shots
with (security_invoker = off) as
  select
    s.id,
    s.slug,
    s.video_id,
    s.title,
    s.shot_index,
    s.start_seconds,
    s.end_seconds,
    s.duration_seconds,
    s.thumbnail_path,
    s.poster_path,
    s.metadata,
    s.metadata_edits,
    s.tags,
    s.width,
    s.height,
    s.aspect_ratio,
    s.view_count,
    s.save_count,
    s.created_at,
    s.updated_at,
    s.shot_size,
    s.camera_angle,
    s.camera_height,
    s.movement_type,
    s.movement_speed,
    s.movement_direction,
    s.lens_type,
    s.depth_of_field,
    s.lighting_quality,
    s.lighting_key,
    s.key_direction,
    s.lighting_source,
    s.lighting_contrast,
    s.color_temperature,
    s.saturation,
    s.interior_exterior,
    s.time_of_day,
    s.location_type,
    s.subject_types,
    s.moods,
    s.dominant_colors,
    s.description,
    s.summary,
    v.source_type,
    v.source_url,
    v.title as video_title,
    public.credited_name(s.user_id) as credited_to
  from public.shots s
  join public.videos v on v.id = s.video_id
  where s.visibility = 'public'
    and s.status = 'complete';

grant select on public.public_shots to anon, authenticated;

-- Counters move through SECURITY DEFINER functions, never a client UPDATE.
create or replace function public.increment_shot_view(p_shot_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.shots set view_count = view_count + 1
  where id = p_shot_id and visibility = 'public';
$$;

grant execute on function public.increment_shot_view(uuid) to anon, authenticated;
