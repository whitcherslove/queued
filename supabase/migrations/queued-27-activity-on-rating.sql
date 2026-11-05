-- Queued · feed: "finished" appears when you RATE (tier or score) — the same everywhere (a movie is finished by rating it).
-- Dropping still shows right away. Safe to run more than once.
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; rated boolean := new.tier is not null or new.score is not null; has boolean;
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  select exists (select 1 from public.activity where log_id = new.id) into has;
  if has then
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end,
      coop_with = coalesce(new.coop_with, coop_with) where log_id = new.id;
  elsif new.dropped or rated then
    insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, coop_with, created_at)
    values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
            coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
            new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), coalesce(new.coop_with, l.coop_with),
            case when tg_op = 'INSERT' then least(now(), greatest(new.watched_at, now() - interval '1 day')) else now() end)
    on conflict (log_id) where log_id is not null do nothing;
  end if;
  return new;
end $$;
