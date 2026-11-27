-- Queued · Steam: your Steam profile, and per game what Steam says (hours, hours on Steam Deck, last played, achievements).
-- The "steam" Edge Function fills it; the app only reads. Safe to run more than once.
alter table public.profiles add column if not exists steam_id text;          -- SteamID64
alter table public.profiles add column if not exists steam_name text;
alter table public.profiles add column if not exists steam_synced_at timestamptz;

create table if not exists public.steam_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  appid integer not null,
  name text,
  playtime_min integer not null default 0,
  playtime_deck_min integer not null default 0,
  playtime_2w_min integer not null default 0,
  last_played timestamptz,
  ach_done integer,
  ach_total integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, appid)
);
alter table public.steam_stats enable row level security;
drop policy if exists "steam: mine" on public.steam_stats;
create policy "steam: mine" on public.steam_stats for select using (user_id = (select auth.uid()));
grant select on public.steam_stats to authenticated;
