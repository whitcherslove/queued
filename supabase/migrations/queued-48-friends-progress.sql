-- Queued · friends' progress: on a friend's page ("Now" with a bar) and in your card ("Anya is playing · 45%").
-- "Only me" titles and people with a hidden page show nothing. Safe to run more than once.

-- one title's progress: games and books by percent (books also by page/minute), shows by episodes watched in the plan
create or replace function public.lib_progress(lid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l record; aired int; seen int; last record; total int; pos int;
begin
  select * into l from public.library where id = lid;
  if l is null or l.status <> 'playing' then return '{}'::jsonb; end if;
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
    return jsonb_build_object('pct', case when aired > 0 then least(100, round(seen * 100.0 / aired)) end,
                              'label', case when last.season is not null then 'S' || last.season || ' · E' || last.episode else 'Just started' end);
  elsif l.section = 'books' then
    total := nullif(coalesce(case when l.format = 'audio' then (l.overrides->>'audio_min')::int end, (l.overrides->>'pages')::int,
                             (select (data->>'pages')::int from public.titles where id = l.title_id)), 0);
    pos := l.position_at;
    return jsonb_build_object('pct', l.progress,
      'label', case when pos is not null and total is not null then (case when l.format = 'audio' then pos || ' of ' || total || ' min' else 'p. ' || pos || ' of ' || total end)
                    when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  else
    return jsonb_build_object('pct', l.progress, 'label', case when l.progress is not null then round(l.progress) || '%' else 'Just started' end);
  end if;
end $$;

-- the friend page: "Now" items get their progress
create or replace function public.friend_summary(friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; res jsonb;
begin
  select id, display_name, handle, avatar_url, page_hidden into p from public.profiles where id = friend;
  if p.page_hidden and friend <> auth.uid() then
    return jsonb_build_object('hidden', true, 'profile', jsonb_build_object('name', p.display_name, 'handle', p.handle, 'avatar_url', p.avatar_url));
  end if;
  res := public.friend_summary_full(friend);
  return jsonb_set(res, '{now}', coalesce((
    select jsonb_agg(n || coalesce(public.lib_progress(l.id), '{}'::jsonb))
    from jsonb_array_elements(res->'now') n
    left join public.library l on l.user_id = friend and l.title_id = (n->>'title_id')::uuid), '[]'::jsonb));
end $$;

-- your card: which friends have this title — playing (with progress), finished (with rating), in their backlog
create or replace function public.friends_on_title(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
      'status', l.status, 'platform', l.platform,
      'rank', case l.status when 'playing' then 1 when 'done' then 2 when 'backlog' then 3 else 4 end,
      'tier', g.tier, 'score', g.score, 'at', coalesce(g.watched_at, l.updated_at)) || public.lib_progress(l.id) as x
    from public.library l
    join public.profiles p on p.id = l.user_id
    left join lateral (select tier, score, watched_at from public.logs where library_id = l.id and not dropped order by watched_at desc limit 1) g on true
    where l.title_id = t and l.user_id <> auth.uid() and public.is_friend(auth.uid(), l.user_id)
      and not l.private and not coalesce(p.page_hidden, false) and l.status in ('playing', 'done', 'backlog')
  ) s;
$$;
grant execute on function public.lib_progress(uuid), public.friend_summary(uuid), public.friends_on_title(uuid) to authenticated;
