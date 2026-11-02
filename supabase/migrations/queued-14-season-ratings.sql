-- Queued · an entry for ONE season and that season's rating are the same thing.
-- Season ratings win; where a season has no rating yet, it takes the entry's. Scores are filled both ways.
-- Safe to run more than once.
with single as (
  select g.id, g.library_id, g.tier, g.score, g.watched_at,
         coalesce(g.seasons[1], g.season_from) as season
    from public.logs g
    join public.library l on l.id = g.library_id and l.section = 'tv'
   where (g.seasons is not null and array_length(g.seasons, 1) = 1)
      or (g.seasons is null and g.season_from is not null and g.season_from = coalesce(g.season_to, g.season_from))
)
-- a season can have several entries (rewatches): take the latest one per season
insert into public.season_ratings (user_id, library_id, season, tier, score, rated_at)
select distinct on (s.library_id, s.season)
       l.user_id, s.library_id, s.season, s.tier, s.score, s.watched_at::date
  from single s join public.library l on l.id = s.library_id
 where s.season is not null
 order by s.library_id, s.season, s.watched_at desc
on conflict (library_id, season) do update
   set score = coalesce(public.season_ratings.score, excluded.score),
       tier = coalesce(public.season_ratings.tier, excluded.tier);

update public.logs g
   set tier = r.tier, score = coalesce(r.score, g.score)
  from public.season_ratings r
 where r.library_id = g.library_id
   and r.season = coalesce(g.seasons[1], g.season_from)
   and ((g.seasons is not null and array_length(g.seasons, 1) = 1)
     or (g.seasons is null and g.season_from is not null and g.season_from = coalesce(g.season_to, g.season_from)))
   and r.tier is not null;
