-- Queued · games, step 1: platforms, co-op, and a private cache for the Twitch/IGDB token.
-- Safe to run more than once.

-- the platform you play (or played) on, and whether it was co-op
alter table public.library add column if not exists platform text;      -- current run: e.g. 'ps5', 'pc', 'steam-deck', 'psvr2-pc'
alter table public.library add column if not exists coop boolean not null default false;
alter table public.logs    add column if not exists platform text;      -- each playthrough keeps its own platform
alter table public.logs    add column if not exists coop boolean not null default false;

create index if not exists library_user_section_platform on public.library (user_id, section, platform);

-- server-only key/value cache (IGDB access token, platform lists). No policies = clients can't read it; functions use the service role.
create table if not exists public.app_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz
);
alter table public.app_cache enable row level security;
