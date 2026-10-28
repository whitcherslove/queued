-- Queued · "Full series" only for shows that have ended.
-- Running shows: plans and journal entries marked as full series become explicit seasons.
-- Safe to run more than once.

-- plans: every season the show has right now
update public.library l
   set plan_seasons = s.list, plan_from = s.list[1], plan_to = s.list[array_length(s.list, 1)]
  from public.titles t,
       lateral (select array_agg((x->>'n')::int order by (x->>'n')::int) as list
                  from jsonb_array_elements(coalesce(t.data->'seasons', '[]'::jsonb)) x
                 where (x->>'n')::int > 0) s
 where t.id = l.title_id and t.kind = 'tv' and l.section = 'tv'
   and l.plan_seasons is null and l.plan_from is null
   and coalesce(t.data->>'status', '') not in ('Ended', 'Canceled')
   and s.list is not null;

-- journal entries: the seasons that had aired by the time you finished
with aired as (
  select g.id,
         (select array_agg((x->>'n')::int order by (x->>'n')::int)
            from jsonb_array_elements(coalesce(t.data->'seasons', '[]'::jsonb)) x
           where (x->>'n')::int > 0 and x->>'air_date' is not null
             and (x->>'air_date')::date <= g.watched_at::date) as list
    from public.logs g
    join public.library l on l.id = g.library_id
    join public.titles t on t.id = l.title_id
   where g.scope = 'show' and t.kind = 'tv'
     and coalesce(t.data->>'status', '') not in ('Ended', 'Canceled')
)
update public.logs g
   set scope = case when array_length(a.list, 1) = 1 then 'season' else 'seasons' end,
       seasons = a.list, season_from = a.list[1], season_to = a.list[array_length(a.list, 1)]
  from aired a
 where a.id = g.id and a.list is not null;
