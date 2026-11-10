-- Queued · "started watching" for a show says which seasons (from the plan: "Season 4", "Seasons 2–3", "Full series"). Safe to run more than once.
create or replace function public.activity_from_library() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.private then delete from public.activity where library_id = new.id; return new; end if;
  if new.status = 'playing' and (tg_op = 'INSERT' or old.status is distinct from 'playing') then
    insert into public.activity (user_id, library_id, title_id, kind, section, platform, format, coop_with, season, seasons_label)
    values (new.user_id, new.id, new.title_id, 'started', new.section, new.platform, new.format, new.coop_with,
            case when new.section = 'tv' then coalesce(new.plan_seasons[1], new.plan_from) end,
            case when new.section = 'tv' then
              case when new.plan_seasons is not null or new.plan_from is not null then public.seasons_label('seasons', new.plan_from, new.plan_to, new.plan_seasons)
                   else 'Full series' end end);
  end if;
  if new.section = 'tv' and (new.tier is not null or new.score is not null)
     and (tg_op = 'INSERT' or new.tier is distinct from old.tier or new.score is distinct from old.score) then
    insert into public.activity (user_id, library_id, title_id, kind, section, seasons_label, tier, score)
    values (new.user_id, new.id, new.title_id, 'show_rated', 'tv', 'the whole show', new.tier, new.score)
    on conflict (library_id) where kind = 'show_rated' do update set tier = excluded.tier, score = excluded.score, created_at = now();
  end if;
  return new;
end $$;
