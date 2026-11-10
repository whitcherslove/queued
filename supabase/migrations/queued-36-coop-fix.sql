-- Queued · fix: saving co-op friends on a game in progress failed ("Something went wrong").
-- The invite trigger read a log-only field on the library row. Safe to run more than once.
create or replace function public.coop_invite_new() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; partner uuid; prev uuid[]; j jsonb := to_jsonb(new); fin timestamptz; plat text;
begin
  if tg_table_name = 'library' then select new.* into l; else select * into l from public.library where id = new.library_id; end if;
  prev := case when tg_op = 'UPDATE' then old.coop_with end;
  if l is null or new.coop_with is null then return new; end if;
  fin := case when tg_table_name = 'logs' then (j ->> 'watched_at')::timestamptz end;   -- only logs have a finish date
  plat := coalesce(j ->> 'platform', l.platform);
  foreach partner in array new.coop_with loop
    if partner <> l.user_id and not (partner = any (coalesce(prev, '{}'))) and public.is_friend(l.user_id, partner)
       and not exists (select 1 from public.coop_invites r where r.from_user = partner and r.to_user = l.user_id and r.title_id = l.title_id) then
      insert into public.coop_invites (from_user, to_user, title_id, section, platform, playing, finished_at)
      values (l.user_id, partner, l.title_id, l.section, plat, tg_table_name = 'library' and l.status = 'playing', fin)
      on conflict (from_user, to_user, title_id) do update set platform = excluded.platform, playing = excluded.playing,
        finished_at = coalesce(excluded.finished_at, coop_invites.finished_at),
        status = case when coop_invites.status = 'declined' then 'declined' else coop_invites.status end;
      perform public.push_call(jsonb_build_object('type', 'coop', 'from', l.user_id, 'to', partner, 'title_id', l.title_id));
    end if;
  end loop;
  return new;
end $$;
