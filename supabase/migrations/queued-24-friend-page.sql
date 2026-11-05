-- Queued · friends: the friend page — pictures for recently finished, the latest 10/10s first. Safe to run more than once.

-- a friend's page: a summary built here — they never get your lists
create or replace function public.friend_summary(friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); res jsonb; rank_me jsonb := '{"filth":1,"sobad":2,"fine":3,"awesome":4,"ten":5}';
begin
  if friend <> me and not public.is_friend(me, friend) then raise exception 'Not your friend'; end if;
  select jsonb_build_object(
    'profile', (select jsonb_build_object('name', display_name, 'handle', handle, 'avatar_url', avatar_url) from public.profiles where id = friend),
    'now', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('title_id', t.id, 'title', t.title, 'poster_url', t.poster_url, 'section', l.section, 'platform', l.platform, 'format', l.format, 'at', l.updated_at) x
        from public.library l join public.titles t on t.id = l.title_id where l.user_id = friend and l.status = 'playing' and not l.private limit 12) s), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('title_id', t.id, 'title', t.title, 'poster_url', t.poster_url, 'backdrop_url', t.backdrop_url, 'section', l.section, 'tier', g.tier, 'score', g.score, 'dropped', g.dropped,
               'seasons_label', public.seasons_label(g.scope, g.season_from, g.season_to, g.seasons), 'at', g.watched_at) x
        from public.logs g join public.library l on l.id = g.library_id join public.titles t on t.id = l.title_id
        where l.user_id = friend and not l.private order by g.watched_at desc limit 8) s), '[]'::jsonb),
    'year', (select jsonb_object_agg(sec, n) from (select l.section sec, count(*) n from public.logs g join public.library l on l.id = g.library_id
        where l.user_id = friend and not l.private and not g.dropped and g.watched_at >= date_trunc('year', now()) group by l.section) c),
    'favorites', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('title_id', f.id, 'title', f.title, 'poster_url', f.poster_url, 'section', f.section, 'at', f.at) x
        from (select distinct on (t.id) t.id, t.title, t.poster_url, l.section, g.watched_at at
              from public.logs g join public.library l on l.id = g.library_id join public.titles t on t.id = l.title_id
              where l.user_id = friend and not l.private and g.tier = 'ten' order by t.id, g.watched_at desc) f
        order by f.at desc limit 12) s), '[]'::jsonb),
    'match', (select jsonb_build_object('common', count(*), 'pct', case when count(*) > 0 then round(100 - avg(abs((rank_me->>a.tier)::int - (rank_me->>b.tier)::int)) * 25) end,
        'both', coalesce((select jsonb_agg(y) from (select jsonb_build_object('title', t2.title, 'poster_url', t2.poster_url, 'mine', a2.tier, 'theirs', b2.tier) y
           from (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = me and g.tier is not null order by l.title_id, g.watched_at desc) a2
           join (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = friend and not l.private and g.tier is not null order by l.title_id, g.watched_at desc) b2 on b2.title_id = a2.title_id
           join public.titles t2 on t2.id = a2.title_id limit 8) z), '[]'::jsonb))
      from (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = me and g.tier is not null order by l.title_id, g.watched_at desc) a
      join (select distinct on (l.title_id) l.title_id, g.tier from public.logs g join public.library l on l.id = g.library_id where l.user_id = friend and not l.private and g.tier is not null order by l.title_id, g.watched_at desc) b on b.title_id = a.title_id)
  ) into res;
  return res;
end $$;
grant execute on function public.friend_summary(uuid) to authenticated;
