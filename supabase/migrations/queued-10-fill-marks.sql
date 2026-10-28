-- Queued · mark every episode of the seasons that are already in your journal.
-- Adds only missing marks (existing ones keep their dates). The date is the journal entry's date.
-- Safe to run more than once.
insert into public.episode_marks (user_id, library_id, season, episode, watched_at)
select distinct on (l.id, ts.season, (e->>'n')::int)
       l.user_id, l.id, ts.season, (e->>'n')::int, g.watched_at
  from public.logs g
  join public.library l on l.id = g.library_id and l.section = 'tv'
  join public.titles t on t.id = l.title_id
  join public.title_seasons ts on ts.title_id = t.id
  cross join lateral jsonb_array_elements(ts.episodes) e
 where (e->>'n')::int > 0
   and e->>'air_date' is not null and (e->>'air_date')::date <= current_date
   and (
        (g.seasons is not null and ts.season = any (g.seasons))
     or (g.seasons is null and g.season_from is not null and ts.season between g.season_from and coalesce(g.season_to, g.season_from))
     or (g.scope = 'show' and (coalesce(t.data->>'status', '') in ('Ended', 'Canceled') or ts.air_date <= g.watched_at::date))
   )
 order by l.id, ts.season, (e->>'n')::int, g.watched_at desc
on conflict (library_id, season, episode) do nothing;
