-- Chunk long knowledge articles for higher-precision RAG.

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles (id) on delete cascade,
  chunk_index int not null,
  heading text,
  content text not null,
  token_est int not null default 0,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (article_id, chunk_index)
);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists knowledge_chunks_article_id_idx
  on public.knowledge_chunks (article_id);

alter table public.knowledge_chunks enable row level security;

drop policy if exists "knowledge chunks public read" on public.knowledge_chunks;
create policy "knowledge chunks public read"
  on public.knowledge_chunks for select
  using (true);

drop function if exists public.match_knowledge_chunks(vector, int, text);

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_k int default 8,
  source_filter text default null
)
returns table (
  slug text,
  title text,
  content text,
  heading text,
  chunk_index int,
  tags text[],
  source_type text,
  source_url text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.slug,
    a.title,
    c.content,
    c.heading,
    c.chunk_index,
    a.tags,
    a.source_type,
    a.source_url,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  join public.knowledge_articles a on a.id = c.article_id
  where c.embedding is not null
    and (source_filter is null or a.source_type = source_filter)
  order by c.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_knowledge_chunks(vector, int, text) to anon, authenticated, service_role;
