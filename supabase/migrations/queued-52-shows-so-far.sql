-- Queued · a show that is still running never gets a "Full series" plan by accident.
-- When it goes to "watching" without a plan (episodes marked straight in the season list, "Watching now" when adding,
-- an import), the plan becomes "the seasons out so far". So once those are watched it is "Up to date",
-- and a new season shows up as "New season out" — instead of sitting in Watching at 100%. Safe to run more than once.

-- the seasons of a show that have started airing (or the overrides' own status says it ended)
create or replace function public.show_ended(t uuid, ov jsonb) returns boolean language sql stable set search_path = public as $$
  select coalesce(ov->>'status', (select data->>'status' from public.titles where id = t)) in ('Ended', 'Canceled');
$$;
create or replace function public.aired_seasons(t uuid) returns int[] language sql stable set search_path = public as $$
  select coalesce(array_agg(n order by n), '{}') from (
    select (s->>'n')::int as n from public.titles x cross join lateral jsonb_array_elements(coalesce(x.data->'seasons', '[]'::jsonb)) s
    where x.id = t and (s->>'n')::int > 0 and (s->>'air_date') is not null and (s->>'air_date')::date <= current_date) q;
$$;

-- 1) from now on: a running show that becomes "watching" without a plan gets the seasons out so far
create or replace function public.plan_so_far() returns trigger language plpgsql security definer set search_path = public as $$
declare a int[];
begin
  if new.section = 'tv' and new.status = 'playing' and new.plan_seasons is null and new.plan_from is null
     and (tg_op = 'INSERT' or old.status is distinct from 'playing') and not public.show_ended(new.title_id, new.overrides) then
    a := public.aired_seasons(new.title_id);
    if array_length(a, 1) > 0 then new.plan_seasons := a; new.plan_from := a[1]; new.plan_to := a[array_length(a, 1)]; end if;
  end if;
  return new;
end $$;
drop trigger if exists library_plan_so_far on public.library;
create trigger library_plan_so_far before insert or update on public.library for each row execute function public.plan_so_far();

-- 2) once: running shows already "watching" with no plan → plan = seasons out so far;
--    and if every aired episode of those is watched → a "watched" entry dated by the last episode, and Up to date.
--    Quietly: no feed posts, pushes or Telegram for this clean-up.
begin;
set local session_replication_role = replica;
do $$
declare r record; a int[]; aired int; seen int; last_at timestamptz;
begin
  for r in select l.* from public.library l
           where l.section = 'tv' and l.status = 'playing' and l.plan_seasons is null and l.plan_from is null and not public.show_ended(l.title_id, l.overrides) loop
    a := public.aired_seasons(r.title_id);
    if coalesce(array_length(a, 1), 0) = 0 then continue; end if;
    update public.library set plan_seasons = a, plan_from = a[1], plan_to = a[array_length(a, 1)] where id = r.id;
    select count(*) into aired from public.title_seasons s cross join lateral jsonb_array_elements(s.episodes) e
      where s.title_id = r.title_id and s.season = any (a) and (e->>'air_date') is not null and (e->>'air_date')::date <= current_date;
    select count(*), max(m.watched_at) into seen, last_at from public.episode_marks m
      where m.library_id = r.id and m.season = any (a) and (not r.rewatch or r.run_started_at is null or m.watched_at >= r.run_started_at);
    if aired > 0 and seen >= aired then
      insert into public.logs (user_id, library_id, scope, season_from, season_to, seasons, watched_at, tier, score, rewatch, dropped)
      values (r.user_id, r.id, case when array_length(a, 1) = 1 then 'season' else 'seasons' end, a[1], a[array_length(a, 1)], a,
              coalesce(last_at, now()),
              r.tier, r.score, coalesce(r.rewatch, false), false);
      update public.library set status = 'done', up_next = false, rewatch = false where id = r.id;
    end if;
  end loop;
end $$;
commit;
