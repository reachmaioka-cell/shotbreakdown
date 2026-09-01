-- Continuous learning queue: jobs run forever via worker or frequent cron pings.

create type public.learning_job_status as enum ('pending', 'running', 'done', 'failed');

create table if not exists public.learning_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.learning_job_status not null default 'pending',
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  result jsonb,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists learning_jobs_dedupe_active_idx
  on public.learning_jobs (dedupe_key)
  where dedupe_key is not null and status in ('pending', 'running');

create index if not exists learning_jobs_pending_idx
  on public.learning_jobs (priority desc, scheduled_at)
  where status = 'pending';

create table if not exists public.learning_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('search_query', 'topic')),
  value text not null,
  tags text[] not null default '{}',
  priority int not null default 0,
  interval_hours int not null default 24,
  last_run_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

insert into public.learning_sources (kind, value, tags, priority, interval_hours) values
  ('search_query', 'cinematography behind the scenes breakdown', array['bts', 'lighting'], 10, 12),
  ('search_query', 'director of photography interview camera lens', array['dp', 'lens'], 10, 12),
  ('search_query', 'film color grading breakdown DaVinci', array['color-grade', 'post'], 9, 12),
  ('search_query', 'VFX breakdown compositing filmmaking', array['vfx', 'post'], 9, 12),
  ('search_query', 'AI video generation cinematography Runway Pika', array['ai-generated', 'vfx'], 8, 24),
  ('search_query', 'music video cinematography lighting setup', array['music-video', 'lighting'], 8, 24),
  ('search_query', 'handheld gimbal dolly shot technique', array['movement', 'gimbal'], 7, 24),
  ('search_query', 'anamorphic lens filmmaking look', array['anamorphic', 'lens'], 7, 24),
  ('topic', 'three point lighting tutorial', array['lighting', 'studio'], 6, 48),
  ('topic', 'low key noir lighting cinematography', array['lighting', 'low-key'], 6, 48)
on conflict (kind, value) do nothing;

create or replace function public.claim_learning_jobs(batch_size int default 5)
returns setof public.learning_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.learning_jobs j
  set
    status = 'running',
    started_at = now(),
    attempts = j.attempts + 1
  where j.id in (
    select id
    from public.learning_jobs
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

grant execute on function public.claim_learning_jobs(int) to service_role;

alter table public.learning_jobs enable row level security;
alter table public.learning_sources enable row level security;

create policy "learning_jobs service only" on public.learning_jobs for all using (false);
create policy "learning_sources service only" on public.learning_sources for all using (false);
