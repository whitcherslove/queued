-- Queued · clean-up: shows "watching" whose planned seasons are all watched and nothing more is scheduled in them
-- become watched ("Up to date"). The entry is dated by the last episode, so only something finished today reaches the feed.
-- Safe to run more than once (a show that's already done is skipped).
do $$
declare r record; aired int; seen int; future int; last_at timestamptz; a int[];
begin
  for r in select l.* from public.library l where l.section = 'tv' and l.status = 'playing'
           and (l.plan_seasons is not null or l.plan_from is not null) loop
    a := coalesce(r.plan_seasons, (select array_agg(g) from generate_series(r.plan_from, coalesce(r.plan_to, r.plan_from)) g));
    select count(*) filter (where (e->>'air_date') is not null and (e->>'air_date')::date <= current_date),
           count(*) filter (where (e->>'air_date') is null or (e->>'air_date')::date > current_date)
      into aired, future
      from public.title_seasons s cross join lateral jsonb_array_elements(s.episodes) e
      where s.title_id = r.title_id and s.season = any (a);
    select count(*), max(m.watched_at) into seen, last_at from public.episode_marks m
      where m.library_id = r.id and m.season = any (a) and (not r.rewatch or r.run_started_at is null or m.watched_at >= r.run_started_at);
    if aired > 0 and future = 0 and seen >= aired then
      insert into public.logs (user_id, library_id, scope, season_from, season_to, seasons, watched_at, tier, score, rewatch, dropped)
      values (r.user_id, r.id, case when array_length(a, 1) = 1 then 'season' else 'seasons' end, a[1], a[array_length(a, 1)], a,
              coalesce(last_at, now()), r.tier, r.score, coalesce(r.rewatch, false), false);
      update public.library set status = 'done', up_next = false, rewatch = false where id = r.id;
      raise notice 'Up to date: %', (select title from public.titles where id = r.title_id);
    end if;
  end loop;
end $$;
