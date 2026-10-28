-- Queued · TV shows: planned seasons, episode marks, season ratings, cached episode lists
-- Safe to run more than once.

alter table public.library add column if not exists plan_from int;
alter table public.library add column if not exists plan_to int;
alter table public.library add column if not exists run_started_at timestamptz;

-- Episodes you have watched (one row per episode; watched_at is the latest time you marked it)
create table if not exists public.episode_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.library (id) on delete cascade,
  season int not null,
  episode int not null,
  watched_at timestamptz not null default now(),
  unique (library_id, season, episode)
);
alter table public.episode_marks enable row level security;
drop policy if exists "episode_marks: own" on public.episode_marks;
create policy "episode_marks: own" on public.episode_marks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Your rating of a single season
create table if not exists public.season_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.library (id) on delete cascade,
  season int not null,
  tier text,
  score numeric(3,2) check (score between 0 and 5),
  rated_at date not null default current_date,
  unique (library_id, season)
);
alter table public.season_ratings enable row level security;
drop policy if exists "season_ratings: own" on public.season_ratings;
create policy "season_ratings: own" on public.season_ratings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Shared cache of episode lists (filled only by the server function)
create table if not exists public.title_seasons (
  title_id uuid not null references public.titles (id) on delete cascade,
  season int not null,
  name text,
  air_date date,
  episodes jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (title_id, season)
);
alter table public.title_seasons enable row level security;
drop policy if exists "title_seasons: read" on public.title_seasons;
create policy "title_seasons: read" on public.title_seasons for select to authenticated using (true);
