create extension if not exists vector;

alter table public.submissions
  add column if not exists prompt_version text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists embedding vector(1536);

create index if not exists submissions_embedding_idx
  on public.submissions
  using hnsw (embedding vector_cosine_ops);

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
    1 - (s.embedding <=> query_embedding) as similarity
  from public.submissions s
  where s.embedding is not null
    and s.status = 'verified'
  order by s.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_verified_breakdowns(vector, int) to anon, authenticated, service_role;
