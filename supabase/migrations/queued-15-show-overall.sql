-- Queued · a show's overall rating (My take) lives on the show itself.
-- Shows without one take it from their latest multi-season / full-series journal entry.
-- Safe to run more than once (only fills empty ones).
with latest as (
  select distinct on (g.library_id) g.library_id, g.tier, g.score
    from public.logs g
    join public.library l on l.id = g.library_id and l.section = 'tv'
   where g.scope = 'show' or coalesce(array_length(g.seasons, 1), 0) > 1
      or (g.seasons is null and g.season_from is not null and g.season_to is not null and g.season_to > g.season_from)
   order by g.library_id, g.watched_at desc
)
update public.library l
   set tier = coalesce(l.tier, x.tier), score = coalesce(l.score, x.score)
  from latest x
 where x.library_id = l.id and (l.tier is null or l.score is null);
