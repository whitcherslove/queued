-- Queued · friends, step 3: co-op with friends, the whole-show rating in the feed, your own events in the feed,
-- deleting feed entries (yours; the admin can delete any). Safe to run more than once.

-- who you played with (friends' ids) — on the game you're playing and on each playthrough
alter table public.library  add column if not exists coop_with uuid[];
alter table public.logs     add column if not exists coop_with uuid[];
alter table public.activity add column if not exists coop_with uuid[];

-- a rating of a whole show (My take) is an event too
alter table public.activity drop constraint if exists activity_kind_check;
alter table public.activity add constraint activity_kind_check check (kind in ('started', 'finished', 'dropped', 'season_rated', 'show_rated'));
create unique index if not exists activity_show on public.activity (library_id) where kind = 'show_rated';

-- the app's admin
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = 'sumbelka14@gmail.com');
$$;
drop policy if exists "activity: delete" on public.activity;
create policy "activity: delete" on public.activity for delete using (user_id = (select auth.uid()) or public.is_admin());

-- journal entries carry co-op friends into the feed
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, coop_with, created_at)
    values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
            coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
            new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), coalesce(new.coop_with, l.coop_with),
            least(now(), greatest(new.watched_at, now() - interval '1 day')))
    on conflict (log_id) where log_id is not null do nothing;
  else
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end,
      coop_with = coalesce(new.coop_with, coop_with) where log_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists logs_activity on public.logs;
create trigger logs_activity after insert or update of tier, score, dropped, coop_with on public.logs for each row execute function public.activity_from_log();

-- started (with co-op friends) + a show's overall rating
create or replace function public.activity_from_library() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.private then delete from public.activity where library_id = new.id; return new; end if;
  if new.status = 'playing' and (tg_op = 'INSERT' or old.status is distinct from 'playing') then
    insert into public.activity (user_id, library_id, title_id, kind, section, platform, format, coop_with)
    values (new.user_id, new.id, new.title_id, 'started', new.section, new.platform, new.format, new.coop_with);
  end if;
  if new.section = 'tv' and (new.tier is not null or new.score is not null)
     and (tg_op = 'INSERT' or new.tier is distinct from old.tier or new.score is distinct from old.score) then
    insert into public.activity (user_id, library_id, title_id, kind, section, seasons_label, tier, score)
    values (new.user_id, new.id, new.title_id, 'show_rated', 'tv', 'the whole show', new.tier, new.score)
    on conflict (library_id) where kind = 'show_rated' do update set tier = excluded.tier, score = excluded.score, created_at = now();
  end if;
  return new;
end $$;
drop trigger if exists library_activity on public.library;
create trigger library_activity after insert or update of status, private, tier, score on public.library for each row execute function public.activity_from_library();

-- the feed: friends' events and your own, with co-op names and whether you can delete it
drop function if exists public.activity_feed(int, timestamptz);
create or replace function public.activity_feed(lim int default 40, before timestamptz default null)
returns table (id uuid, user_id uuid, name text, handle text, avatar_url text, kind text, section text, seasons_label text, season int, tier text, score numeric,
               platform text, format text, created_at timestamptz, title_id uuid, title text, poster_url text, year int, mine boolean, coop_names text[], can_delete boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, p.display_name, p.handle, p.avatar_url, a.kind, a.section, a.seasons_label, a.season, a.tier, a.score, a.platform, a.format, a.created_at,
         t.id, t.title, t.poster_url, t.year, a.user_id = auth.uid(),
         (select array_agg(coalesce(cp.display_name, '@' || cp.handle)) from public.profiles cp where cp.id = any (a.coop_with)),
         a.user_id = auth.uid() or public.is_admin()
  from public.activity a join public.titles t on t.id = a.title_id left join public.profiles p on p.id = a.user_id
  where (a.user_id = auth.uid() or public.is_friend(auth.uid(), a.user_id)) and (before is null or a.created_at < before)
  order by a.created_at desc limit least(lim, 100);
$$;
grant execute on function public.activity_feed(int, timestamptz), public.is_admin() to authenticated;
