-- Queued · feed: only fresh "finished" (today), co-op partners visible only to people who share a company with them,
-- co-op invites ("Slava says you played Hades together — Add / Not me"). Safe to run more than once.

-- 1) "finished" goes to the feed only when it happened today (up to the next morning, for a late rating);
--    past viewings, "watched before", imports never do. A rating on an entry already in the feed updates it.
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; rated boolean := new.tier is not null or new.score is not null; has boolean; fresh boolean := new.watched_at > now() - interval '36 hours';
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  select exists (select 1 from public.activity where log_id = new.id) into has;
  if has then
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end,
      coop_with = coalesce(new.coop_with, coop_with) where log_id = new.id;
  elsif fresh and (new.dropped or rated or l.section <> 'movies') then
    insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, coop_with, created_at)
    values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
            coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
            new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), coalesce(new.coop_with, l.coop_with), now())
    on conflict (log_id) where log_id is not null do nothing;
  end if;
  return new;
end $$;

-- 2) who may see a co-op partner's name: the viewer shares a company (Telegram group) with that partner, or is the partner
create or replace function public.shares_company(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a = b or exists (select 1 from public.tg_members m1 join public.tg_members m2 on m1.group_id = m2.group_id where m1.user_id = a and m2.user_id = b);
$$;
drop function if exists public.activity_feed(int, timestamptz);
create or replace function public.activity_feed(lim int default 40, before timestamptz default null)
returns table (id uuid, user_id uuid, name text, handle text, avatar_url text, kind text, section text, seasons_label text, season int, tier text, score numeric,
               platform text, format text, created_at timestamptz, title_id uuid, title text, poster_url text, year int, mine boolean, coop_names text[], can_delete boolean, backdrop_url text)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, p.display_name, p.handle, p.avatar_url, a.kind, a.section, a.seasons_label, a.season, a.tier, a.score, a.platform, a.format, a.created_at,
         t.id, t.title, t.poster_url, t.year, a.user_id = auth.uid(),
         (select array_agg(coalesce(cp.display_name, '@' || cp.handle)) from public.profiles cp where cp.id = any (a.coop_with) and public.shares_company(auth.uid(), cp.id)),
         a.user_id = auth.uid() or public.is_admin(), t.backdrop_url
  from public.activity a join public.titles t on t.id = a.title_id left join public.profiles p on p.id = a.user_id
  where (a.user_id = auth.uid() or public.is_friend(auth.uid(), a.user_id)) and (before is null or a.created_at < before)
  order by a.created_at desc limit least(lim, 100);
$$;
grant execute on function public.activity_feed(int, timestamptz), public.shares_company(uuid, uuid) to authenticated;

-- 3) co-op invites: when you mark that you played with a friend, they're asked to add it to their lists
create table if not exists public.coop_invites (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete cascade,
  section text not null, platform text,
  playing boolean not null default false,     -- started together (still playing) vs finished
  finished_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (from_user, to_user, title_id)
);
alter table public.coop_invites enable row level security;
drop policy if exists "coop: mine" on public.coop_invites;
create policy "coop: mine" on public.coop_invites for select using ((select auth.uid()) in (from_user, to_user));

create or replace function public.coop_invite_new() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; partner uuid; prev uuid[];
begin
  if tg_table_name = 'library' then select new.* into l; prev := case when tg_op = 'UPDATE' then old.coop_with end;
  else select * into l from public.library where id = new.library_id; prev := case when tg_op = 'UPDATE' then old.coop_with end; end if;
  if l is null or new.coop_with is null then return new; end if;
  foreach partner in array new.coop_with loop
    if partner <> l.user_id and not (partner = any (coalesce(prev, '{}'))) and public.is_friend(l.user_id, partner)
       and not exists (select 1 from public.coop_invites r where r.from_user = partner and r.to_user = l.user_id and r.title_id = l.title_id) then   -- not back to whoever invited you
      insert into public.coop_invites (from_user, to_user, title_id, section, platform, playing, finished_at)
      values (l.user_id, partner, l.title_id, l.section, coalesce(new.platform, l.platform), tg_table_name = 'library' and l.status = 'playing',
              case when tg_table_name = 'logs' then new.watched_at end)
      on conflict (from_user, to_user, title_id) do update set platform = excluded.platform, playing = excluded.playing, finished_at = coalesce(excluded.finished_at, coop_invites.finished_at),
        status = case when coop_invites.status = 'declined' then 'declined' else coop_invites.status end;
      perform public.push_call(jsonb_build_object('type', 'coop', 'from', l.user_id, 'to', partner, 'title_id', l.title_id));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists library_coop_invite on public.library;
create trigger library_coop_invite after insert or update of coop_with on public.library for each row execute function public.coop_invite_new();
drop trigger if exists logs_coop_invite on public.logs;
create trigger logs_coop_invite after insert or update of coop_with on public.logs for each row execute function public.coop_invite_new();

-- my pending invites, with names and covers
create or replace function public.my_coop_invites() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'from_name', coalesce(p.display_name, '@' || p.handle), 'from_avatar', p.avatar_url,
    'title', t.title, 'poster_url', t.poster_url, 'platform', i.platform, 'playing', i.playing, 'finished_at', i.finished_at) order by i.created_at desc), '[]'::jsonb)
  from public.coop_invites i join public.titles t on t.id = i.title_id left join public.profiles p on p.id = i.from_user
  where i.to_user = auth.uid() and i.status = 'pending';
$$;

-- Add: put it into my lists (or just mark co-op on my existing entry); Not me: decline
create or replace function public.answer_coop(inv uuid, accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare i record; lib uuid; lg uuid;
begin
  select * into i from public.coop_invites where id = inv and to_user = auth.uid() and status = 'pending';
  if i is null then raise exception 'This invite is gone'; end if;
  if not accept then update public.coop_invites set status = 'declined' where id = inv; return; end if;
  select id into lib from public.library where user_id = auth.uid() and title_id = i.title_id;
  if lib is null then
    insert into public.library (user_id, title_id, section, status, platform, coop, coop_with)
    values (auth.uid(), i.title_id, i.section, case when i.playing then 'playing' else 'done' end, i.platform, true, array[i.from_user])
    returning id into lib;
    if not i.playing then
      insert into public.logs (user_id, library_id, watched_at, platform, coop, coop_with, rewatch, dropped)
      values (auth.uid(), lib, coalesce(i.finished_at, now()), i.platform, true, array[i.from_user], false, false);
    end if;
  else
    update public.library set coop = true, coop_with = (select array_agg(distinct x) from unnest(coalesce(coop_with, '{}') || i.from_user) x) where id = lib;
    select id into lg from public.logs where library_id = lib order by watched_at desc limit 1;
    if lg is not null and not i.playing then
      update public.logs set coop = true, coop_with = (select array_agg(distinct x) from unnest(coalesce(coop_with, '{}') || i.from_user) x) where id = lg;
    end if;
  end if;
  update public.coop_invites set status = 'accepted' where id = inv;
end $$;
grant execute on function public.my_coop_invites(), public.answer_coop(uuid, boolean) to authenticated;
