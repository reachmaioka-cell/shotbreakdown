-- Move the follow-up chat and the AI-quality signals onto the shot model.

alter table public.conversations
  add column if not exists shot_id uuid references public.shots on delete cascade;

alter table public.conversations
  alter column submission_id drop not null;

-- Carry existing conversations across to the shot each submission became.
update public.conversations c
set shot_id = s.id
from public.shots s
where s.submission_id = c.submission_id
  and c.shot_id is null;

create unique index if not exists conversations_shot_user_idx
  on public.conversations (shot_id, user_id)
  where shot_id is not null;

-- Feedback ratings now attach to shots too, so the public library can be rated
-- without reaching back into the legacy submissions table.
alter table public.breakdown_feedback
  add column if not exists shot_id uuid references public.shots on delete cascade;

update public.breakdown_feedback f
set shot_id = s.id
from public.shots s
where s.submission_id = f.submission_id
  and f.shot_id is null;

create index if not exists breakdown_feedback_shot_idx on public.breakdown_feedback (shot_id);

/*
 * Where the analysis is weakest, by field.
 *
 * Feeds the nightly distillation that writes prompt_insights, which is
 * prepended to the next analysis prompt. This is the same closed loop the
 * product already had, now sourced from shot corrections.
 */
create or replace function public.shot_correction_stats(p_since timestamptz default now() - interval '30 days')
returns table (kind text, field_key text, corrections bigint, sample jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.kind,
    coalesce(e.field_key, '(none)') as field_key,
    count(*)::bigint as corrections,
    to_jsonb((array_agg(jsonb_build_object('from', e.previous_value, 'to', e.new_value)
                        order by e.created_at desc))[1:5]) as sample
  from public.shot_edits e
  where e.created_at >= p_since
  group by e.kind, coalesce(e.field_key, '(none)')
  order by count(*) desc
  limit 40;
$$;

grant execute on function public.shot_correction_stats(timestamptz) to service_role;
