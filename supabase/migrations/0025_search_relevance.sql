-- Two defects in search_shots, both user-visible.
--
-- 1. The reported total was a function of page size. Both the keyword and the
--    semantic CTE were truncated to `v_limit * 6 + v_offset` candidates, and
--    total_count was count(*) over that truncated fused set. Measured before
--    this migration, the same query reported: limit=1 -> 6, limit=3 -> 18,
--    limit=5 -> 30, limit=20 -> 39. The number shown to users was arithmetic on
--    their page size, not a count of matching shots.
--
-- 2. The semantic half had no relevance floor, so every query matched every
--    indexed shot and "no results" was unreachable. "zxqwv florbnak
--    wugglethorpe" returned 30 results.
--
-- Distances measured against the live corpus (cosine, pgvector <=>):
--     real queries      best match 0.40 - 0.57
--     nonsense queries  best match 0.78 - 0.88
-- 0.72 sits in the gap with margin on both sides, and rejects the nonsense.
--
-- An absolute floor alone is not enough at this corpus size: every shot in a
-- cinematography library is somewhat close to every cinematography query, so a
-- plausible query still matched all 39. A second, relative floor keeps only
-- matches within 0.12 of the best match for that query, which adapts to how
-- well the corpus actually answers it.

-- The return type gains matched_keyword / matched_semantic, so the old
-- signature has to be dropped rather than replaced.
drop function if exists public.search_shots(text, vector, jsonb, int, int, uuid, text);

create function public.search_shots(
  p_query text default null,
  p_embedding vector(1536) default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 48,
  p_offset int default 0,
  p_viewer uuid default null,
  p_scope text default 'public'
)
returns table (
  id uuid, slug text, video_id uuid, shot_index int, title text, summary text,
  description text, thumbnail_path text, poster_path text, start_seconds numeric,
  end_seconds numeric, duration_seconds numeric, tags text[], width int, height int,
  aspect_ratio text, shot_size text, camera_angle text, movement_type text,
  movement_speed text, lens_type text, depth_of_field text, lighting_key text,
  lighting_quality text, color_temperature text, time_of_day text,
  interior_exterior text, location_type text, subject_types text[], moods text[],
  dominant_colors text[], visibility public.content_visibility, user_id uuid,
  source_type public.submission_source, video_title text, created_at timestamptz,
  score double precision, matched_keyword boolean, matched_semantic boolean,
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
  v_viewer uuid := public.effective_viewer(p_viewer);
  v_max_distance float := 0.72;
  -- Keep matches within this cosine window of the single best match.
  v_relative_window float := 0.12;
  v_tsquery tsquery := case
    when v_query is null then null
    else websearch_to_tsquery('english', v_query)
  end;
  v_browsing boolean := v_query is null and p_embedding is null;
begin
  return query
  with filtered as (
    select s.*, v.source_type as v_source_type, v.title as v_title
    from public.shots s
    join public.videos v on v.id = s.video_id
    where s.status = 'complete'
      and (
        case
          when p_scope = 'mine' then v_viewer is not null and s.user_id = v_viewer
          when p_scope = 'saved' then v_viewer is not null and exists (
            select 1 from public.saved_shots ss
            where ss.shot_id = s.id and ss.user_id = v_viewer
          )
          else s.visibility = 'public'
               or (v_viewer is not null and s.user_id = v_viewer)
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
  /*
   * Every row that matches, untruncated. This is what the user is told the size
   * of, and it must not depend on which page they are looking at.
   *
   * Two floors, because one is not enough:
   *  - an absolute floor rejects queries about something else entirely
   *    (nonsense, or a real question about an unrelated subject);
   *  - a relative floor, anchored on the best match for this query, keeps the
   *    result set tight when the corpus does contain a good answer. Without it
   *    a plausible query returns almost the whole library, because every shot
   *    in a cinematography corpus is somewhat close to every cinematography
   *    query.
   */
  distances as (
    select f.id, (f.embedding <=> p_embedding) as d
    from filtered f
    where p_embedding is not null and f.embedding is not null
  ),
  best as (
    select min(d) as d_min from distances
  ),
  eligible as (
    select f.id,
           (v_tsquery is not null and f.search_tsv @@ v_tsquery) as kw,
           coalesce(
             d.d < v_max_distance and d.d <= (b.d_min + v_relative_window),
             false
           ) as sem
    from filtered f
    left join distances d on d.id = f.id
    left join best b on true
  ),
  matched as (
    -- Qualified: RETURNS TABLE column names are in scope as variables inside a
    -- plpgsql body, so a bare `id` here is ambiguous against the output column.
    select e.id, e.kw, e.sem from eligible e where v_browsing or e.kw or e.sem
  ),
  keyword as (
    select m.id,
           row_number() over (
             order by ts_rank_cd(f.search_tsv, v_tsquery) desc, f.created_at desc
           ) as rank
    from matched m
    join filtered f on f.id = m.id
    where m.kw
    limit v_candidates
  ),
  semantic as (
    select m.id, row_number() over (order by d.d) as rank
    from matched m
    join distances d on d.id = m.id
    where m.sem
    order by d.d
    limit v_candidates
  ),
  fused as (
    select coalesce(k.id, s.id) as id,
           coalesce(1.0 / (60 + k.rank), 0) * 1.0 +
           coalesce(1.0 / (60 + s.rank), 0) * 1.2 as score
    from keyword k
    full outer join semantic s on s.id = k.id
  ),
  counted as (
    select
      f.*,
      m.kw as matched_keyword,
      m.sem as matched_semantic,
      case when v_browsing then 0::double precision else coalesce(fu.score, 0)::double precision end as score,
      count(*) over () as total_count
    from matched m
    join filtered f on f.id = m.id
    left join fused fu on fu.id = m.id
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
    c.score, c.matched_keyword, c.matched_semantic, c.total_count
  from counted c
  order by c.score desc, c.created_at desc, c.id
  limit v_limit offset v_offset;
end;
$$;

grant execute on function public.search_shots(text, vector, jsonb, int, int, uuid, text) to anon, authenticated, service_role;
