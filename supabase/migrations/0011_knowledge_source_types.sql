-- Allow curriculum and user-correction articles in the knowledge base.

alter table public.knowledge_articles
  drop constraint if exists knowledge_articles_source_type_check;

alter table public.knowledge_articles
  add constraint knowledge_articles_source_type_check
  check (source_type in ('learn', 'verified_distill', 'manual', 'web', 'curriculum', 'correction'));
