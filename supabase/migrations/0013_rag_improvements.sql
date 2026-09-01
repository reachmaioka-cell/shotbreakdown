-- RAG improvements: source_type + similarity in knowledge match.
-- Function recreation handled in 0014 (Postgres cannot change return type via replace).

create table if not exists public.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
