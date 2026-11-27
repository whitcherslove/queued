-- Queued · Steam, fast: the app reads Steam numbers straight from the database (no function call when a card opens),
-- the Steam app id lives on the game, achievements highlights and Steam Deck status are stored, a nightly refresh,
-- and a new PC game gets linked to Steam in the background. Safe to run more than once.

alter table public.library add column if not exists steam_appid integer;            -- null = not looked up yet, 0 = not on Steam
alter table public.library add column if not exists steam_complete boolean not null default false;   -- every Steam achievement
alter table public.steam_stats add column if not exists ach_rarest jsonb;           -- {name, icon, pct, at}
alter table public.steam_stats add column if not exists ach_latest jsonb;
alter table public.steam_stats add column if not exists ach_easiest jsonb;
alter table public.steam_stats add column if not exists deck text;                  -- verified | playable | unsupported | unknown
alter table public.steam_stats add column if not exists ach_checked_at timestamptz;

-- what you linked by hand before: copy it onto the game
update public.library set steam_appid = (overrides->>'steam_appid')::int
where steam_appid is null and overrides ? 'steam_appid' and (overrides->>'steam_appid') ~ '^\d+$';

-- the app's one read at start: Steam numbers of the games in your lists
create or replace function public.my_steam() returns setof public.steam_stats language sql stable set search_path = public as $$
  select s.* from public.steam_stats s
  where s.user_id = auth.uid() and s.appid in (select steam_appid from public.library where user_id = auth.uid() and steam_appid > 0);
$$;
grant execute on function public.my_steam() to authenticated;

-- calling the steam function from the database (same secret as the push function)
create or replace function public.steam_call(body jsonb) returns void language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  select regexp_replace(value, '/push/?$', '/steam') into url from public.app_config where key = 'push_url';
  select value into secret from public.app_config where key = 'push_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, body := body, headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret), timeout_milliseconds := 20000);
end $$;

-- a game added to PC games (or set to PC / Steam Deck) by someone with Steam → find its Steam app id in the background
create or replace function public.steam_link_new() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.steam_appid is null and (new.section = 'pc' or new.platform in ('pc', 'steam-deck'))
     and exists (select 1 from public.profiles where id = new.user_id and steam_id is not null)
     and (tg_op = 'INSERT' or old.section is distinct from new.section or old.platform is distinct from new.platform) then
    perform public.steam_call(jsonb_build_object('action', 'resolve', 'library_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists library_steam_link on public.library;
create trigger library_steam_link after insert or update of section, platform on public.library for each row execute function public.steam_link_new();

-- every night: fresh hours and achievements for everyone with Steam
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'queued-steam-nightly';
    perform cron.schedule('queued-steam-nightly', '30 3 * * *', $c$select public.steam_call('{"action":"nightly"}'::jsonb)$c$);
  end if;
end $$;

-- friends in your card: also whether they have every Steam achievement
create or replace function public.friends_on_title(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
      'status', st, 'platinum', l.platinum, 'steam_complete', l.steam_complete,
      'platform', case when st in ('done', 'dropped') then coalesce(g.platform, l.platform) else l.platform end,
      'rank', case st when 'playing' then 1 when 'done' then 2 when 'dropped' then 3 when 'backlog' then 4 else 5 end,
      'tier', g.tier, 'score', g.score,
      'at', coalesce(g.watched_at, l.updated_at)) || public.lib_progress(l.id) as x
    from public.library l
    join public.profiles p on p.id = l.user_id
    left join lateral (select tier, score, watched_at, platform, dropped from public.logs where library_id = l.id order by watched_at desc limit 1) g on true
    cross join lateral (select case when l.status = 'dropped' or (l.status = 'done' and coalesce(g.dropped, false)) then 'dropped' else l.status end as st) s0
    where l.title_id = t and l.user_id <> auth.uid() and public.is_friend(auth.uid(), l.user_id)
      and not l.private and not coalesce(p.page_hidden, false) and l.status in ('playing', 'done', 'dropped', 'backlog')
  ) s;
$$;
