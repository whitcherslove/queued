-- Queued · friends, step 2: an activity feed (what you start, finish, drop, rate) and a summary page.
-- Friends read only these — never your lists. Titles locked "Only me" never get in. Safe to run more than once.

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  library_id uuid not null references public.library (id) on delete cascade,
  log_id uuid references public.logs (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete cascade,
  kind text not null check (kind in ('started', 'finished', 'dropped', 'season_rated')),
  section text not null,
  season int,                 -- season_rated: which season; finished show: first season of that run
  seasons_label text,         -- "Season 2" / "Seasons 1–3" / "Full series"
  tier text, score numeric(3,2),
  platform text, format text,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_time on public.activity (user_id, created_at desc);
create unique index if not exists activity_log on public.activity (log_id) where log_id is not null;
create unique index if not exists activity_season on public.activity (library_id, season) where kind = 'season_rated';
alter table public.activity enable row level security;
drop policy if exists "activity: mine and friends" on public.activity;
create policy "activity: mine and friends" on public.activity for select using (user_id = (select auth.uid()) or public.is_friend((select auth.uid()), user_id));
-- no insert / update policies: only the triggers below write here

-- "Season 2" / "Seasons 1–3" / "Full series" for a journal entry
create or replace function public.seasons_label(scope text, s_from int, s_to int, list int[]) returns text language sql immutable as $$
  select case
    when scope = 'show' then 'Full series'
    when list is not null and array_length(list, 1) = 1 then 'Season ' || list[1]
    when list is not null and array_length(list, 1) > 1 then 'Seasons ' || (select min(x) from unnest(list) x) || '–' || (select max(x) from unnest(list) x)
    when s_from is not null and (s_to is null or s_to = s_from) then 'Season ' || s_from
    when s_from is not null then 'Seasons ' || s_from || '–' || s_to
    else null end;
$$;

-- a journal entry = finished (or dropped); its rating follows later edits
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, created_at)
    values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
            coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
            new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), least(now(), greatest(new.watched_at, now() - interval '1 day')))
    on conflict (log_id) where log_id is not null do nothing;
  else
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end where log_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists logs_activity on public.logs;
create trigger logs_activity after insert or update of tier, score, dropped on public.logs for each row execute function public.activity_from_log();

-- started: a title goes to Playing / Watching / Reading
create or replace function public.activity_from_library() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.private then
    delete from public.activity where library_id = new.id;      -- locked: take it out of the feed
    return new;
  end if;
  if new.status = 'playing' and (tg_op = 'INSERT' or old.status is distinct from 'playing') then
    insert into public.activity (user_id, library_id, title_id, kind, section, platform, format)
    values (new.user_id, new.id, new.title_id, 'started', new.section, new.platform, new.format);
  end if;
  return new;
end $$;
drop trigger if exists library_activity on public.library;
create trigger library_activity after insert or update of status, private on public.library for each row execute function public.activity_from_library();

-- a season rating
create or replace function public.activity_from_season() returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if new.tier is null and new.score is null then return new; end if;
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  insert into public.activity (user_id, library_id, title_id, kind, section, season, seasons_label, tier, score)
  values (l.user_id, l.id, l.title_id, 'season_rated', 'tv', new.season, 'Season ' || new.season, new.tier, new.score)
  on conflict (library_id, season) where kind = 'season_rated' do update set tier = excluded.tier, score = excluded.score, created_at = now();
  return new;
end $$;
drop trigger if exists season_activity on public.season_ratings;
create trigger season_activity after insert or update of tier, score on public.season_ratings for each row execute function public.activity_from_season();

-- a start for the feed: what you finished in the last 30 days
insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, created_at)
select l.user_id, l.id, g.id, l.title_id, case when g.dropped then 'dropped' else 'finished' end, l.section, coalesce(g.season_from, g.seasons[1]),
       public.seasons_label(g.scope, g.season_from, g.season_to, g.seasons), g.tier, g.score, coalesce(g.platform, l.platform), coalesce(g.format, l.format), g.watched_at
from public.logs g join public.library l on l.id = g.library_id
where g.watched_at > now() - interval '30 days' and not l.private
on conflict (log_id) where log_id is not null do nothing;

-- the feed: your friends' events (and yours), newest first
create or replace function public.activity_feed(lim int default 40, before timestamptz default null)
returns table (id uuid, user_id uuid, name text, handle text, avatar_url text, kind text, section text, seasons_label text, season int, tier text, score numeric,
               platform text, format text, created_at timestamptz, title_id uuid, title text, poster_url text, year int, mine boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, p.display_name, p.handle, p.avatar_url, a.kind, a.section, a.seasons_label, a.season, a.tier, a.score, a.platform, a.format, a.created_at,
         t.id, t.title, t.poster_url, t.year, a.user_id = auth.uid()
  from public.activity a join public.titles t on t.id = a.title_id left join public.profiles p on p.id = a.user_id
  where public.is_friend(auth.uid(), a.user_id) and (before is null or a.created_at < before)
  order by a.created_at desc limit least(lim, 100);
$$;

-- a friend's page: a summary built here — they never get your lists
create or replace function public.friend_summary(friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); res jsonb; rank_me jsonb := '{"filth":1,"sobad":2,"fine":3,"awesome":4,"ten":5}';
begin
  if friend <> me and not public.is_friend(me, friend) then raise exception 'Not your friend'; end if;
  select jsonb_build_object(
    'profile', (select jsonb_build_object('name', display_name, 'handle', handle, 'avatar_url', avatar_url) from public.profiles where id = friend),
    'now', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('title_id', t.id, 'title', t.title, 'poster_url', t.poster_url, 'section', l.section, 'platform', l.platform, 'format', l.format, 'at', l.updated_at) x
        from public.library l join public.titles t on t.id = l.title_id where l.user_id = friend and l.status = 'playing' and not l.private limit 12) s), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('title_id', t.id, 'title', t.title, 'poster_url', t.poster_url, 'section', l.section, 'tier', g.tier, 'score', g.score, 'dropped', g.dropped,
               'seasons_label', public.seasons_label(g.scope, g.season_from, g.season_to, g.seasons), 'at', g.watched_at) x
        from public.logs g join public.library l on l.id = g.library_id join public.titles t on t.id = l.title_id
        where l.user_id = friend and not l.private order by g.watched_at desc limit 8) s), '[]'::jsonb),
    'year', (select jsonb_object_agg(sec, n) from (select l.section sec, count(*) n from public.logs g join public.library l on l.id = g.library_id
        where l.user_id = friend and not l.private and not g.dropped and g.watched_at >= date_trunc('year', now()) group by l.section) c),
    'favorites', coalesce((select jsonb_agg(x) from (
        select distinct on (t.id) jsonb_build_object('title_id', t.id, 'title', t.title, 'poster_url', t.poster_url, 'section', l.section) x
        from public.logs g join public.library l on l.id = g.library_id join public.titles t on t.id = l.title_id
        where l.user_id = friend and not l.private and g.tier = 'ten' order by t.id, g.watched_at desc limit 12) s), '[]'::jsonb),
    'match', (select jsonb_build_object('common', count(*), 'pct', case when count(*) > 0 then round(100 - avg(abs((rank_me->>a.tier)::int - (rank_me->>b.tier)::int)) * 25) end,
        'both', coalesce((select jsonb_agg(y) from (select jsonb_build_object('title', t2.title, 'poster_url', t2.poster_url, 'mine', a2.tier, 'theirs', b2.tier) y
           from (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = me and g.tier is not null order by l.title_id, g.watched_at desc) a2
           join (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = friend and not l.private and g.tier is not null order by l.title_id, g.watched_at desc) b2 on b2.title_id = a2.title_id
           join public.titles t2 on t2.id = a2.title_id limit 8) z), '[]'::jsonb))
      from (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = me and g.tier is not null order by l.title_id, g.watched_at desc) a
      join (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = friend and not l.private and g.tier is not null order by l.title_id, g.watched_at desc) b on b.title_id = a.title_id)
  ) into res;
  return res;
end $$;
grant execute on function public.activity_feed(int, timestamptz), public.friend_summary(uuid) to authenticated;
