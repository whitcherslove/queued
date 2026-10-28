-- Queued · TV: any set of seasons in a plan or a journal entry (e.g. "Seasons 1, 3")
-- Safe to run more than once.
alter table public.library add column if not exists plan_seasons int[];
alter table public.logs add column if not exists seasons int[];

update public.library
   set plan_seasons = array(select generate_series(plan_from, coalesce(plan_to, plan_from)))
 where plan_from is not null and plan_seasons is null;

update public.logs
   set seasons = array(select generate_series(season_from, coalesce(season_to, season_from)))
 where season_from is not null and seasons is null;
