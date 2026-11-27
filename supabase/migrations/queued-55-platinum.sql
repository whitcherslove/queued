-- Queued · PlayStation platinum trophy: one switch per game ("Platinum"), shown in My take, the lists, Stats and to friends.
-- Safe to run more than once.
alter table public.library add column if not exists platinum boolean not null default false;

-- friends in your card: also whether they got the platinum
create or replace function public.friends_on_title(t uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'rank')::int, x->>'at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
      'status', st, 'platinum', l.platinum,
      'platform', case when st in ('done', 'dropped') then coalesce(g.platform, l.platform) else l.platform end,
      'rank', case st when 'playing' then 1 when 'done' then 2 when 'dropped' then 3 when 'backlog' then 4 else 5 end,
      'tier', g.tier, 'score', g.score,
      'at', coalesce(g.watched_at, l.updated_at)) || public.lib_progress(l.id) as x
    from public.library l
    join public.profiles p on p.id = l.user_id
    left join lateral (select tier, score, watched_at, platform, dropped from public.logs where library_id = l.id order by watched_at desc limit 1) g on true
    cross join lateral (select case when l.status = 'dropped' or (l.status = 'done' and coalesce(g.dropped, false)) then 'dropped' else l.status end as st) s0
    where l.title_id = t and l.user_id <> auth.uid() and public.is_friend(auth.uid(), l.user_id)
      and not l.private and not coalesce(p.page_hidden, false) and l.status in ('playing', 'done', 'dropped', 'backlog')
  ) s;
$$;
