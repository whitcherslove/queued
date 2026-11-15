-- Queued · co-op fixes: no repeated pushes, a friend who said "Not me" can be asked again,
-- and "Add" also moves the game out of the Backlog when it's already there. Safe to run more than once.

create or replace function public.coop_invite_new() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; partner uuid; prev uuid[]; j jsonb := to_jsonb(new); fin timestamptz; plat text; st text; playing boolean;
begin
  if tg_table_name = 'library' then select new.* into l; else select * into l from public.library where id = new.library_id; end if;
  prev := case when tg_op = 'UPDATE' then old.coop_with end;
  if l is null or new.coop_with is null then return new; end if;
  fin := case when tg_table_name = 'logs' then (j ->> 'watched_at')::timestamptz end;
  plat := coalesce(j ->> 'platform', l.platform);
  playing := tg_table_name = 'library' and l.status = 'playing';
  foreach partner in array new.coop_with loop
    if partner <> l.user_id and not (partner = any (coalesce(prev, '{}'))) and public.is_friend(l.user_id, partner)
       and not exists (select 1 from public.coop_invites r where r.from_user = partner and r.to_user = l.user_id and r.title_id = l.title_id) then
      select status into st from public.coop_invites where from_user = l.user_id and to_user = partner and title_id = l.title_id;
      if st is null then
        insert into public.coop_invites (from_user, to_user, title_id, section, platform, playing, finished_at)
        values (l.user_id, partner, l.title_id, l.section, plat, playing, fin);
        perform public.push_call(jsonb_build_object('type', 'coop', 'from', l.user_id, 'to', partner, 'title_id', l.title_id));
      elsif st = 'declined' then
        -- they said "Not me" before and you added them again: ask once more
        update public.coop_invites set status = 'pending', platform = plat, playing = playing, finished_at = coalesce(fin, finished_at), created_at = now()
        where from_user = l.user_id and to_user = partner and title_id = l.title_id;
        perform public.push_call(jsonb_build_object('type', 'coop', 'from', l.user_id, 'to', partner, 'title_id', l.title_id));
      else
        -- already asked (or added): just keep the details fresh, no second notification
        update public.coop_invites set platform = plat, finished_at = coalesce(fin, finished_at), playing = case when fin is not null then false else coop_invites.playing end
        where from_user = l.user_id and to_user = partner and title_id = l.title_id;
      end if;
    end if;
  end loop;
  return new;
end $$;

-- Add: if the game sits in their Backlog, it moves to Playing (started together) or gets the finished playthrough
create or replace function public.answer_coop(inv uuid, accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare i record; lib record; lg uuid; newlib uuid;
begin
  select * into i from public.coop_invites where id = inv and to_user = auth.uid() and status = 'pending';
  if i is null then raise exception 'This invite is gone'; end if;
  if not accept then update public.coop_invites set status = 'declined' where id = inv; return; end if;
  select * into lib from public.library where user_id = auth.uid() and title_id = i.title_id;
  if lib is null then
    insert into public.library (user_id, title_id, section, status, platform, coop, coop_with)
    values (auth.uid(), i.title_id, i.section, case when i.playing then 'playing' else 'done' end, i.platform, true, array[i.from_user])
    returning id into newlib;
    if not i.playing then
      insert into public.logs (user_id, library_id, watched_at, platform, coop, coop_with, rewatch, dropped)
      values (auth.uid(), newlib, coalesce(i.finished_at, now()), i.platform, true, array[i.from_user], false, false);
    end if;
  else
    update public.library set coop = true, coop_with = (select array_agg(distinct x) from unnest(coalesce(coop_with, '{}') || i.from_user) x),
      platform = coalesce(platform, i.platform),
      status = case when lib.status = 'backlog' then (case when i.playing then 'playing' else 'done' end) else status end
    where id = lib.id;
    select id into lg from public.logs where library_id = lib.id order by watched_at desc limit 1;
    if not i.playing then
      if lg is not null then
        update public.logs set coop = true, coop_with = (select array_agg(distinct x) from unnest(coalesce(coop_with, '{}') || i.from_user) x) where id = lg;
      elsif lib.status in ('backlog', 'playing') then
        insert into public.logs (user_id, library_id, watched_at, platform, coop, coop_with, rewatch, dropped)
        values (auth.uid(), lib.id, coalesce(i.finished_at, now()), coalesce(lib.platform, i.platform), true, array[i.from_user], false, false);
        update public.library set status = 'done' where id = lib.id;
      end if;
    end if;
  end if;
  update public.coop_invites set status = 'accepted' where id = inv;
end $$;
