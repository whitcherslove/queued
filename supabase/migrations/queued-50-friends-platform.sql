-- Queued · friends in your card: a friend who finished it shows the platform of that playthrough (not the game's current one). Safe to run more than once.
create or replace function public.friends_on_title(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
      'status', l.status,
      'platform', case when l.status in ('done', 'dropped') then coalesce(g.platform, l.platform) else l.platform end,
      'rank', case l.status when 'playing' then 1 when 'done' then 2 when 'dropped' then 3 when 'backlog' then 4 else 5 end,
      'tier', g.tier, 'score', g.score, 'at', coalesce(g.watched_at, l.updated_at)) || public.lib_progress(l.id) as x
    from public.library l
    join public.profiles p on p.id = l.user_id
    left join lateral (select tier, score, watched_at, platform from public.logs where library_id = l.id order by watched_at desc limit 1) g on true
    where l.title_id = t and l.user_id <> auth.uid() and public.is_friend(auth.uid(), l.user_id)
      and not l.private and not coalesce(p.page_hidden, false) and l.status in ('playing', 'done', 'dropped', 'backlog')
  ) s;
$$;
