-- Queued · step 2 · titles cache, library, logs
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Shared catalog cache (filled only by the server functions)
create table if not exists public.titles (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('movie', 'tv', 'game')),
  source text not null default 'tmdb',
  source_id text not null,
  imdb_id text,
  title text not null,
  release_date date,
  year int,
  runtime int,
  directors text[] not null default '{}',
  genres text[] not null default '{}',
  overview text,
  poster_url text,
  backdrop_url text,
  metascore int,
  imdb_rating numeric(3,1),
  data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (kind, source, source_id)
);
alter table public.titles enable row level security;
drop policy if exists "titles: read" on public.titles;
create policy "titles: read" on public.titles for select to authenticated using (true);

-- Personal shelf
create table if not exists public.library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete restrict,
  section text not null check (section in ('movies', 'tv', 'console', 'pc', 'retro')),
  status text not null default 'backlog' check (status in ('backlog', 'playing', 'done', 'dropped')),
  up_next boolean not null default false,
  position double precision not null default 0,
  platform text,
  item_type text not null default 'main' check (item_type in ('main', 'dlc')),
  coop boolean not null default false,
  progress int check (progress between 0 and 100),
  started_on date,
  tier text,
  score numeric(3,2) check (score between 0 and 5),
  overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title_id)
);
create index if not exists library_user_section on public.library (user_id, section, status, position);
alter table public.library enable row level security;
drop policy if exists "library: own" on public.library;
create policy "library: own" on public.library for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Watch / play log (one row per viewing, season, run of seasons or full series)
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.library (id) on delete cascade,
  scope text not null default 'item' check (scope in ('item', 'season', 'seasons', 'show')),
  season_from int,
  season_to int,
  watched_at timestamptz not null default now(),
  tier text,
  score numeric(3,2) check (score between 0 and 5),
  rewatch boolean not null default false,
  platform text,
  folded boolean not null default false,
  position double precision,
  created_at timestamptz not null default now()
);
create index if not exists logs_user_date on public.logs (user_id, watched_at desc);
alter table public.logs enable row level security;
drop policy if exists "logs: own" on public.logs;
create policy "logs: own" on public.logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists library_touch on public.library;
create trigger library_touch before update on public.library for each row execute function public.touch_updated_at();
