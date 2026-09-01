-- Hybrid shot search: structured filters ∩ (full-text ∪ semantic).
--
-- Keyword and vector results are fused with reciprocal rank fusion rather than
-- picking one strategy, so "slow dolly in" (literal) and "moody nighttime
-- portrait" (no literal overlap with the indexed text) both work, and filters
-- constrain both halves identically.

create or replace function public.search_shots(
  p_query text default null,
  p_embedding vector(1536) default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 48,
  p_offset int default 0,
  p_viewer uuid default null,
  p_scope text default 'public'
)
returns table (
  id uuid,
  slug text,
  video_id uuid,
  shot_index int,
  title text,
  summary text,
  description text,
  thumbnail_path text,
  poster_path text,
  start_seconds numeric,
  end_seconds numeric,
  duration_seconds numeric,
  tags text[],
  width int,
  height int,
  aspect_ratio text,
  shot_size text,
  camera_angle text,
  movement_type text,
  movement_speed text,
  lens_type text,
  depth_of_field text,
  lighting_key text,
  lighting_quality text,
  color_temperature text,
  time_of_day text,
  interior_exterior text,
  location_type text,
  subject_types text[],
  moods text[],
  dominant_colors text[],
  visibility public.content_visibility,
  user_id uuid,
  source_type public.submission_source,
  video_title text,
  created_at timestamptz,
  score double precision,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 48), 1), 96);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_candidates int := v_limit * 6 + v_offset;
begin
  return query
  with filtered as (
    select s.*, v.source_type as v_source_type, v.title as v_title
    from public.shots s
    join public.videos v on v.id = s.video_id
    where s.status = 'complete'
      and (
        case
          when p_scope = 'mine' then p_viewer is not null and s.user_id = p_viewer
          when p_scope = 'saved' then p_viewer is not null and exists (
            select 1 from public.saved_shots ss
            where ss.shot_id = s.id and ss.user_id = p_viewer
          )
          else s.visibility = 'public'
               or (p_viewer is not null and s.user_id = p_viewer)
        end
      )
      and (not p_filters ? 'shot_size' or s.shot_size = any (public.jsonb_to_text_array(p_filters -> 'shot_size')))
      and (not p_filters ? 'camera_angle' or s.camera_angle = any (public.jsonb_to_text_array(p_filters -> 'camera_angle')))
      and (not p_filters ? 'camera_height' or s.camera_height = any (public.jsonb_to_text_array(p_filters -> 'camera_height')))
      and (not p_filters ? 'movement_type' or s.movement_type = any (public.jsonb_to_text_array(p_filters -> 'movement_type')))
      and (not p_filters ? 'movement_speed' or s.movement_speed = any (public.jsonb_to_text_array(p_filters -> 'movement_speed')))
      and (not p_filters ? 'lens_type' or s.lens_type = any (public.jsonb_to_text_array(p_filters -> 'lens_type')))
      and (not p_filters ? 'depth_of_field' or s.depth_of_field = any (public.jsonb_to_text_array(p_filters -> 'depth_of_field')))
      and (not p_filters ? 'lighting_key' or s.lighting_key = any (public.jsonb_to_text_array(p_filters -> 'lighting_key')))
      and (not p_filters ? 'lighting_quality' or s.lighting_quality = any (public.jsonb_to_text_array(p_filters -> 'lighting_quality')))
      and (not p_filters ? 'key_direction' or s.key_direction = any (public.jsonb_to_text_array(p_filters -> 'key_direction')))
      and (not p_filters ? 'lighting_source' or s.lighting_source = any (public.jsonb_to_text_array(p_filters -> 'lighting_source')))
      and (not p_filters ? 'color_temperature' or s.color_temperature = any (public.jsonb_to_text_array(p_filters -> 'color_temperature')))
      and (not p_filters ? 'saturation' or s.saturation = any (public.jsonb_to_text_array(p_filters -> 'saturation')))
      and (not p_filters ? 'interior_exterior' or s.interior_exterior = any (public.jsonb_to_text_array(p_filters -> 'interior_exterior')))
      and (not p_filters ? 'time_of_day' or s.time_of_day = any (public.jsonb_to_text_array(p_filters -> 'time_of_day')))
      and (not p_filters ? 'aspect_ratio' or s.aspect_ratio = any (public.jsonb_to_text_array(p_filters -> 'aspect_ratio')))
      and (not p_filters ? 'subject_types' or s.subject_types && public.jsonb_to_text_array(p_filters -> 'subject_types'))
      and (not p_filters ? 'moods' or s.moods && public.jsonb_to_text_array(p_filters -> 'moods'))
      and (not p_filters ? 'colors' or s.dominant_colors && public.jsonb_to_text_array(p_filters -> 'colors'))
      and (not p_filters ? 'tags' or s.tags && public.jsonb_to_text_array(p_filters -> 'tags'))
      and (not p_filters ? 'source_type' or v.source_type::text = any (public.jsonb_to_text_array(p_filters -> 'source_type')))
      and (not p_filters ? 'video_id' or s.video_id = (p_filters ->> 'video_id')::uuid)
      and (not p_filters ? 'collection_id' or exists (
        select 1 from public.collection_items ci
        where ci.shot_id = s.id and ci.collection_id = (p_filters ->> 'collection_id')::uuid
      ))
      and (not p_filters ? 'min_duration' or s.duration_seconds >= (p_filters ->> 'min_duration')::numeric)
      and (not p_filters ? 'max_duration' or s.duration_seconds <= (p_filters ->> 'max_duration')::numeric)
  ),
  keyword as (
    select f.id,
           row_number() over (
             order by ts_rank_cd(f.search_tsv, websearch_to_tsquery('english', v_query)) desc, f.created_at desc
           ) as rank
    from filtered f
    where v_query is not null
      and f.search_tsv @@ websearch_to_tsquery('english', v_query)
    limit v_candidates
  ),
  semantic as (
    select f.id,
           row_number() over (order by f.embedding <=> p_embedding) as rank
    from filtered f
    where p_embedding is not null and f.embedding is not null
    order by f.embedding <=> p_embedding
    limit v_candidates
  ),
  fused as (
    select coalesce(k.id, s.id) as id,
           coalesce(1.0 / (60 + k.rank), 0) * 1.0 +
           coalesce(1.0 / (60 + s.rank), 0) * 1.2 as score
    from keyword k
    full outer join semantic s on s.id = k.id
  ),
  ranked as (
    select f.*,
           case
             when v_query is null and p_embedding is null then 0::double precision
             else coalesce(fu.score, 0)::double precision
           end as score
    from filtered f
    left join fused fu on fu.id = f.id
    where (v_query is null and p_embedding is null) or fu.id is not null
  ),
  counted as (
    select r.*, count(*) over () as total_count
    from ranked r
  )
  select
    c.id, c.slug, c.video_id, c.shot_index, c.title, c.summary, c.description,
    c.thumbnail_path, c.poster_path, c.start_seconds, c.end_seconds, c.duration_seconds,
    c.tags, c.width, c.height, c.aspect_ratio,
    c.shot_size, c.camera_angle, c.movement_type, c.movement_speed, c.lens_type,
    c.depth_of_field, c.lighting_key, c.lighting_quality, c.color_temperature,
    c.time_of_day, c.interior_exterior, c.location_type,
    c.subject_types, c.moods, c.dominant_colors,
    c.visibility, c.user_id, c.v_source_type, c.v_title, c.created_at,
    c.score, c.total_count
  from counted c
  order by c.score desc, c.created_at desc, c.id
  limit v_limit offset v_offset;
end;
$$;

grant execute on function public.search_shots(text, vector, jsonb, int, int, uuid, text) to anon, authenticated, service_role;

/*
 * Facet counts for the filter rail, computed over the same visibility rules as
 * search so the counts never promise results the user cannot see.
 */
create or replace function public.shot_facet_counts(
  p_viewer uuid default null,
  p_scope text default 'public'
)
returns table (facet text, value text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select s.*
    from public.shots s
    where s.status = 'complete'
      and (
        case
          when p_scope = 'mine' then p_viewer is not null and s.user_id = p_viewer
          when p_scope = 'saved' then p_viewer is not null and exists (
            select 1 from public.saved_shots ss where ss.shot_id = s.id and ss.user_id = p_viewer
          )
          else s.visibility = 'public' or (p_viewer is not null and s.user_id = p_viewer)
        end
      )
  ),
  scalars as (
    select 'shot_size' as facet, shot_size as value from visible
    union all select 'camera_angle', camera_angle from visible
    union all select 'movement_type', movement_type from visible
    union all select 'movement_speed', movement_speed from visible
    union all select 'lens_type', lens_type from visible
    union all select 'depth_of_field', depth_of_field from visible
    union all select 'lighting_key', lighting_key from visible
    union all select 'lighting_quality', lighting_quality from visible
    union all select 'key_direction', key_direction from visible
    union all select 'lighting_source', lighting_source from visible
    union all select 'color_temperature', color_temperature from visible
    union all select 'saturation', saturation from visible
    union all select 'interior_exterior', interior_exterior from visible
    union all select 'time_of_day', time_of_day from visible
    union all select 'aspect_ratio', aspect_ratio from visible
  ),
  arrays as (
    select 'moods' as facet, unnest(moods) as value from visible
    union all select 'subject_types', unnest(subject_types) from visible
    union all select 'colors', unnest(dominant_colors) from visible
    union all select 'tags', unnest(tags) from visible
  )
  select facet, value, count(*)::bigint
  from (select * from scalars union all select * from arrays) all_facets
  where value is not null and value <> ''
  group by facet, value
  order by facet, count(*) desc, value;
$$;

grant execute on function public.shot_facet_counts(uuid, text) to anon, authenticated, service_role;

/*
 * Find Similar. Similarity is over the shot's full embedding, which is built
 * from composition, subject, colour, lighting, mood and camera facets — so
 * results are visually alike rather than sharing a couple of keywords.
 */
create or replace function public.similar_shots(
  p_shot_id uuid,
  p_limit int default 24,
  p_viewer uuid default null
)
returns table (
  id uuid,
  slug text,
  video_id uuid,
  title text,
  summary text,
  thumbnail_path text,
  aspect_ratio text,
  width int,
  height int,
  visibility public.content_visibility,
  user_id uuid,
  similarity double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_embedding vector(1536);
  v_visible boolean;
begin
  select s.embedding,
         (s.visibility = 'public' or (p_viewer is not null and s.user_id = p_viewer))
    into v_embedding, v_visible
  from public.shots s
  where s.id = p_shot_id;

  if v_embedding is null or not coalesce(v_visible, false) then
    return;
  end if;

  return query
  select s.id, s.slug, s.video_id, s.title, s.summary, s.thumbnail_path,
         s.aspect_ratio, s.width, s.height, s.visibility, s.user_id,
         (1 - (s.embedding <=> v_embedding))::double precision as similarity
  from public.shots s
  where s.id <> p_shot_id
    and s.embedding is not null
    and s.status = 'complete'
    and (s.visibility = 'public' or (p_viewer is not null and s.user_id = p_viewer))
  order by s.embedding <=> v_embedding
  limit least(greatest(p_limit, 1), 48);
end;
$$;

grant execute on function public.similar_shots(uuid, int, uuid) to anon, authenticated, service_role;
