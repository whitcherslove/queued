-- Queued · which of your games IGDB marks as DLC / expansion / standalone, and games still without a type
-- (those get it the next time their card refreshes from IGDB). Read-only.
select t.title, coalesce(t.data->>'type', '— no type yet') as type, t.data->'parent'->>'name' as for_game, l.section
from public.library l join public.titles t on t.id = l.title_id
where l.user_id = (select id from auth.users where lower(email) = 'sumbelka14@gmail.com') and l.section in ('console', 'pc', 'retro')
  and (t.data->>'type' in ('dlc', 'expansion', 'standalone') or t.data->>'type' is null)
order by (t.data->>'type' is null), t.title;
