-- Profiles (auto-created on signup, tracks free tier usage)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  breakdown_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create profile when a user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- Submissions (one row per shot breakdown request)
create type submission_source as enum ('youtube', 'tiktok', 'instagram', 'video_upload', 'frame_upload');
create type submission_status as enum ('pending', 'processing', 'draft', 'verified');

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  source_type submission_source not null,
  source_url text,
  file_path text,
  status submission_status not null default 'pending',
  breakdown jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.submissions enable row level security;

create policy "Users can view their own submissions"
  on public.submissions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own submissions"
  on public.submissions for insert
  with check (auth.uid() = user_id);

-- Verified breakdowns are public (for the library)
create policy "Verified submissions are publicly viewable"
  on public.submissions for select
  using (status = 'verified');

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger submissions_updated_at
  before update on public.submissions
  for each row execute procedure public.set_updated_at();
