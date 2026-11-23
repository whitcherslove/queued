-- Queued · friends in your card: also who dropped it (and where they stopped). Safe to run more than once.

-- progress also for dropped titles: where they stopped
create or replace function public.lib_progress(lid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record; aired int; seen int; last record; total int; pos int;
begin
  select * into l from public.library where id = lid;
  if l is null or l.status not in ('playing', 'dropped') then return '{}'::jsonb; end if;
  if l.section = 'tv' then
    select count(*) into aired
    from public.title_seasons s cross join lateral jsonb_array_elements(s.episodes) e
    where s.title_id = l.title_id and s.season > 0 and (e->>'air_date') is not null and (e->>'air_date')::date <= current_date
      and (l.plan_seasons is null and l.plan_from is null or s.season = any (coalesce(l.plan_seasons, '{}')) or s.season between coalesce(l.plan_from, 0) and coalesce(l.plan_to, l.plan_from, 0));
    select count(*) into seen
    from public.episode_marks m
    where m.library_id = l.id and m.season > 0
      and (l.plan_seasons is null and l.plan_from is null or m.season = any (coalesce(l.plan_seasons, '{}')) or m.season between coalesce(l.plan_from, 0) and coalesce(l.plan_to, l.plan_from, 0))
      and (not l.rewatch or l.run_started_at is null or m.watched_at >= l.run_started_at);
    select season, episode into last from public.episode_marks m where m.library_id = l.id and m.season > 0
      and (not l.rewatch or l.run_started_at is null or m.watched_at >= l.run_started_at) order by m.watched_at desc, m.season desc, m.episode desc limit 1;
    if l.status = 'dropped' and last.season is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', case when aired > 0 then least(100, round(seen * 100.0 / aired)) end,
                              'label', case when last.season is not null then 'S' || last.season || ' · E' || last.episode else 'Just started' end);
  elsif l.section = 'books' then
    total := nullif(coalesce(case when l.format = 'audio' then (l.overrides->>'audio_min')::int end, (l.overrides->>'pages')::int,
                             (select (data->>'pages')::int from public.titles where id = l.title_id)), 0);
    pos := l.position_at;
    if l.status = 'dropped' and pos is null and l.progress is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', l.progress,
      'label', case when pos is not null and total is not null then (case when l.format = 'audio' then pos || ' of ' || total || ' min' else 'p. ' || pos || ' of ' || total end)
                    when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  else
    if l.status = 'dropped' and l.progress is null then return '{}'::jsonb; end if;
    return jsonb_build_object('pct', l.progress, 'label', case when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  end if;
end $$;

create or replace function public.friends_on_title(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
      'status', l.status, 'platform', l.platform,
      'rank', case l.status when 'playing' then 1 when 'done' then 2 when 'dropped' then 3 when 'backlog' then 4 else 5 end,
      'tier', g.tier, 'score', g.score, 'at', coalesce(g.watched_at, l.updated_at)) || public.lib_progress(l.id) as x
    from public.library l
    join public.profiles p on p.id = l.user_id
    left join lateral (select tier, score, watched_at from public.logs where library_id = l.id order by watched_at desc limit 1) g on true
    where l.title_id = t and l.user_id <> auth.uid() and public.is_friend(auth.uid(), l.user_id)
      and not l.private and not coalesce(p.page_hidden, false) and l.status in ('playing', 'done', 'dropped', 'backlog')
  ) s;
$$;
