-- Queued · step 1 of the batch. Safe to run more than once.
-- 1) Feed: shows, books and games → "finished" when you finish (no rating needed; a later rating joins the same entry).
--    Movies → when you rate them (a movie has no progress).
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; rated boolean := new.tier is not null or new.score is not null; has boolean;
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  select exists (select 1 from public.activity where log_id = new.id) into has;
  if has then
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end,
      coop_with = coalesce(new.coop_with, coop_with) where log_id = new.id;
  elsif new.dropped or rated or l.section <> 'movies' then
    insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, coop_with, created_at)
    values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
            coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
            new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), coalesce(new.coop_with, l.coop_with),
            case when tg_op = 'INSERT' then least(now(), greatest(new.watched_at, now() - interval '1 day')) else now() end)
    on conflict (log_id) where log_id is not null do nothing;
  end if;
  return new;
end $$;

-- 2) Out today: also premieres of shows in your Backlog; shows you stopped following are skipped
create or replace function public.releases_today(d date default current_date)
returns table (user_id uuid, library_id uuid, section text, title text, what text)
language sql stable security definer set search_path = public as $$
  select l.user_id, l.id, 'tv', t.title,
         case when (e->>'n')::int = 1 then 'Season ' || s.season || ' premiere' else 'New episode · S' || s.season || ' E' || (e->>'n') end
  from public.library l join public.titles t on t.id = l.title_id
  join public.title_seasons s on s.title_id = l.title_id
  cross join lateral jsonb_array_elements(s.episodes) e
  where l.section = 'tv' and (e->>'air_date')::date = d
    and (l.status = 'playing'
         or (l.status = 'done' and coalesce((l.overrides->>'unfollow')::boolean, false) = false)
         or (l.status = 'backlog' and (e->>'n')::int = 1))
  union all
  select l.user_id, l.id, l.section, t.title, 'Out today'
  from public.library l join public.titles t on t.id = l.title_id
  where l.section <> 'tv' and l.status = 'backlog' and t.release_date = d;
$$;
