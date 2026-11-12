-- Queued · fix: rating a whole show no longer posts on its own ("rated · the whole show").
-- Like seasons: the rating only joins today's "finished" entry of that show, if there is one. Safe to run more than once.
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
  -- the show's overall rating: joins today's "finished" entry (if any), never a new entry
  if new.section = 'tv' and tg_op = 'UPDATE' and (new.tier is distinct from old.tier or new.score is distinct from old.score) then
    update public.activity set tier = coalesce(new.tier, tier), score = coalesce(new.score, score)
    where id = (select id from public.activity where library_id = new.id and kind = 'finished' and created_at > now() - interval '36 hours' order by created_at desc limit 1);
  end if;
  return new;
end $$;

-- and the old "rated · the whole show" entries go away
delete from public.activity where kind = 'show_rated';
