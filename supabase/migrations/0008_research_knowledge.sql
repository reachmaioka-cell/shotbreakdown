-- Per-clip research cache and filmmaking knowledge base for RAG.

alter table public.submissions
  add column if not exists research_context jsonb;

create table if not exists public.research_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  source_url text,
  query text,
  snippets jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists research_cache_expires_idx on public.research_cache (expires_at);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content text not null,
  source_type text not null check (source_type in ('learn', 'verified_distill', 'manual', 'web')),
  source_url text,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_articles_embedding_idx
  on public.knowledge_articles
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_knowledge_articles(
  query_embedding vector(1536),
  match_k int default 5
)
returns table (
  slug text,
  title text,
  content text,
  tags text[],
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
    1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_articles k
  where k.embedding is not null
  order by k.embedding <=> query_embedding
  limit greatest(match_k, 1);
$$;

grant execute on function public.match_knowledge_articles(vector, int) to anon, authenticated, service_role;

alter table public.research_cache enable row level security;
alter table public.knowledge_articles enable row level security;

create policy "research_cache service only"
  on public.research_cache for all
  using (false);

create policy "knowledge articles public read"
  on public.knowledge_articles for select
  using (true);
