-- Fix: drop before recreate when return type changes.

drop function if exists public.match_knowledge_articles(vector, int);
drop function if exists public.match_knowledge_articles(vector, int, text);
drop function if exists public.match_verified_breakdowns(vector, int);

create or replace function public.match_knowledge_articles(
  query_embedding vector(1536),
  match_k int default 5,
  source_filter text default null
)
returns table (
  slug text,
  title text,
  content text,
  tags text[],
  source_type text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    k.slug,
    k.title,
    k.content,
    k.tags,
    k.source_type,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_articles k
  where k.embedding is not null
    and (source_filter is null or k.source_type = source_filter)
  order by k.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_knowledge_articles(vector, int, text) to anon, authenticated, service_role;

create or replace function public.match_verified_breakdowns(
  query_embedding vector(1536),
  match_k int default 3
)
returns table (
  id uuid,
  slug text,
  title text,
  thumbnail_url text,
  tags text[],
  breakdown jsonb,
  breakdown_user_edits jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.slug,
    s.title,
    s.thumbnail_url,
    s.tags,
    s.breakdown,
    s.breakdown_user_edits,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.submissions s
  where s.embedding is not null
    and (
      s.status = 'verified'
      or coalesce(s.rating_avg, 0) >= 4
    )
  order by s.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_verified_breakdowns(vector, int) to anon, authenticated, service_role;

create table if not exists public.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
