-- Queued · shows: progress counts every episode of the seasons that have started airing (3 of 8 → 37%);
-- seasons not out yet are "for later" — they don't keep a show in Watching (unless they start within two weeks).
-- Same rules as the app. Includes a quiet clean-up for shows stuck in Watching at 100%. Safe to run more than once.

-- the seasons of a library entry's plan (or all seasons for "Full series")
drop function if exists public.plan_scope(public.library);
create or replace function public.plan_scope(t uuid, ps int[], pf int, pt int) returns int[] language sql stable set search_path = public as $$
  select case when ps is not null then ps
              when pf is not null then (select array_agg(g) from generate_series(pf, coalesce(pt, pf)) g)
              else (select coalesce(array_agg(s.season order by s.season), '{}') from public.title_seasons s where s.title_id = t and s.season > 0) end;
$$;

-- friends' progress: same counting as the app
create or replace function public.lib_progress(lid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record; total int; seen int; last record; tot int; pos int; sc int[];
begin
  select * into l from public.library where id = lid;
  if l is null or l.status not in ('playing', 'dropped') then return '{}'::jsonb; end if;
  if l.section = 'tv' then
    sc := public.plan_scope(l.title_id, l.plan_seasons, l.plan_from, l.plan_to);
    -- only seasons that have started airing count — with all their episodes
    with started as (
      select s.season, s.episodes from public.title_seasons s
      where s.title_id = l.title_id and s.season = any (sc)
        and exists (select 1 from jsonb_array_elements(s.episodes) e where (e->>'air_date') is not null and (e->>'air_date')::date <= current_date))
    select (select count(*) from started st cross join lateral jsonb_array_elements(st.episodes) e),
           (select count(*) from public.episode_marks m where m.library_id = l.id and m.season in (select season from started)
              and (not l.rewatch or l.run_started_at is null or m.watched_at >= l.run_started_at))
      into total, seen;
    select season, episode into last from public.episode_marks m where m.library_id = l.id and m.season > 0
      and (not l.rewatch or l.run_started_at is null or m.watched_at >= l.run_started_at) order by m.watched_at desc, m.season desc, m.episode desc limit 1;
    if l.status = 'dropped' and last.season is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', case when total > 0 then least(100, round(seen * 100.0 / total)) end,
                              'label', case when last.season is not null then 'S' || last.season || ' · E' || last.episode else 'Just started' end);
  elsif l.section = 'books' then
    tot := nullif(coalesce(case when l.format = 'audio' then (l.overrides->>'audio_min')::int end, (l.overrides->>'pages')::int,
                           (select (data->>'pages')::int from public.titles where id = l.title_id)), 0);
    pos := l.position_at;
    if l.status = 'dropped' and pos is null and l.progress is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', l.progress,
      'label', case when pos is not null and tot is not null then (case when l.format = 'audio' then pos || ' of ' || tot || ' min' else 'p. ' || pos || ' of ' || tot end)
                    when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  else
    if l.status = 'dropped' and l.progress is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', l.progress, 'label', case when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  end if;
end $$;

-- once: seasons with nothing out yet can no longer be in a "watching" plan — take them out of current plans
-- (they come back as "New season out" when they air)
update public.library l set plan_seasons = k.out_seasons, plan_from = k.out_seasons[1], plan_to = k.out_seasons[array_length(k.out_seasons, 1)]
from (
  select l2.id, array(select n from unnest(public.plan_scope(l2.title_id, l2.plan_seasons, l2.plan_from, l2.plan_to)) n
                      where exists (select 1 from public.title_seasons s cross join lateral jsonb_array_elements(s.episodes) e
                                    where s.title_id = l2.title_id and s.season = n and (e->>'air_date') is not null and (e->>'air_date')::date <= current_date)
                      order by n) as out_seasons
  from public.library l2
  where l2.section = 'tv' and l2.status = 'playing' and (l2.plan_seasons is not null or l2.plan_from is not null)
) k
where l.id = k.id and coalesce(array_length(k.out_seasons, 1), 0) > 0
  and k.out_seasons is distinct from public.plan_scope(l.title_id, l.plan_seasons, l.plan_from, l.plan_to);

-- once: shows "watching" whose started seasons are all out and watched, with nothing in the plan airing within two weeks
-- → a "watched" entry for those seasons (dated by the last episode — only something finished today reaches the feed) and Up to date
do $$
declare r record; sc int[]; done int[]; started int[]; soon boolean; last_at timestamptz;
begin
  for r in select l.* from public.library l join public.titles t on t.id = l.title_id
           where l.section = 'tv' and l.status = 'playing'
             and (l.plan_seasons is not null or l.plan_from is not null or coalesce(l.overrides->>'status', t.data->>'status') in ('Ended', 'Canceled')) loop
    sc := public.plan_scope(r.title_id, r.plan_seasons, r.plan_from, r.plan_to);
    if coalesce(array_length(sc, 1), 0) = 0 or exists (select 1 from unnest(sc) n where not exists (select 1 from public.title_seasons s where s.title_id = r.title_id and s.season = n)) then continue; end if;
    select coalesce(array_agg(s.season order by s.season), '{}') into started from public.title_seasons s
      where s.title_id = r.title_id and s.season = any (sc)
        and exists (select 1 from jsonb_array_elements(s.episodes) e where (e->>'air_date') is not null and (e->>'air_date')::date <= current_date);
    if coalesce(array_length(started, 1), 0) = 0 then continue; end if;
    -- a started season is done when every episode is out and marked
    select coalesce(array_agg(s.season order by s.season), '{}') into done from public.title_seasons s
      where s.title_id = r.title_id and s.season = any (started)
        and not exists (select 1 from jsonb_array_elements(s.episodes) e
                        where (e->>'air_date') is null or (e->>'air_date')::date > current_date
                           or not exists (select 1 from public.episode_marks m where m.library_id = r.id and m.season = s.season and m.episode = (e->>'n')::int
                                          and (not r.rewatch or r.run_started_at is null or m.watched_at >= r.run_started_at)));
    if array_length(done, 1) is distinct from array_length(started, 1) then continue; end if;
    select exists (select 1 from public.title_seasons s cross join lateral jsonb_array_elements(s.episodes) e
                   where s.title_id = r.title_id and s.season = any (sc) and (e->>'air_date') is not null
                     and (e->>'air_date')::date > current_date and (e->>'air_date')::date <= current_date + 14) into soon;
    if soon then continue; end if;
    select max(m.watched_at) into last_at from public.episode_marks m where m.library_id = r.id and m.season = any (done);
    insert into public.logs (user_id, library_id, scope, season_from, season_to, seasons, watched_at, tier, score, rewatch, dropped)
    values (r.user_id, r.id,
            case when r.plan_seasons is null and r.plan_from is null then 'show' when array_length(done, 1) = 1 then 'season' else 'seasons' end,
            case when r.plan_seasons is null and r.plan_from is null then null else done[1] end,
            case when r.plan_seasons is null and r.plan_from is null then null else done[array_length(done, 1)] end,
            case when r.plan_seasons is null and r.plan_from is null then null else done end,
            coalesce(last_at, now()), r.tier, r.score, coalesce(r.rewatch, false), false);
    update public.library set status = 'done', up_next = false, rewatch = false where id = r.id;
    raise notice 'Up to date: %', (select title from public.titles where id = r.title_id);
  end loop;
end $$;
