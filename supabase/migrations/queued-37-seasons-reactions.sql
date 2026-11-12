-- Queued · seasons by "finished" (not by rating) + reactions on feed events. Safe to run more than once.

-- 1) finishing a season (its last aired episode marked today) → "finished · Season N"
create or replace function public.activity_from_marks() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; eps jsonb; aired int; seen int; label text;
begin
  if new.season = 0 or new.watched_at < now() - interval '36 hours' then return new; end if;   -- specials and back-filled marks don't post
  select * into l from public.library where id = new.library_id;
  if l is null or l.private or l.section <> 'tv' then return new; end if;
  select episodes into eps from public.title_seasons where title_id = l.title_id and season = new.season;
  if eps is null then return new; end if;
  select count(*) into aired from jsonb_array_elements(eps) e where (e ->> 'air_date') is not null and (e ->> 'air_date')::date <= current_date;
  select count(*) into seen from jsonb_array_elements(eps) e
    where (e ->> 'air_date') is not null and (e ->> 'air_date')::date <= current_date
      and exists (select 1 from public.episode_marks m where m.library_id = l.id and m.season = new.season and m.episode = (e ->> 'n')::int
                  and m.watched_at >= coalesce(case when l.rewatch then l.run_started_at end, '-infinity'::timestamptz));
  if aired = 0 or seen < aired then return new; end if;
  -- once per season and run (not again if you unmark and mark the last episode)
  if exists (select 1 from public.activity a where a.library_id = l.id and a.kind = 'finished' and a.season = new.season and a.created_at > now() - interval '36 hours') then return new; end if;
  label := 'Season ' || new.season;
  insert into public.activity (user_id, library_id, title_id, kind, section, season, seasons_label, tier, score, created_at)
  select l.user_id, l.id, l.title_id, 'finished', 'tv', new.season, label, r.tier, r.score, now()
  from (select 1) x left join public.season_ratings r on r.library_id = l.id and r.season = new.season;
  return new;
end $$;
drop trigger if exists marks_activity on public.episode_marks;
create trigger marks_activity after insert or update of watched_at on public.episode_marks for each row execute function public.activity_from_marks();

-- 2) a season rating joins that season's "finished" entry; on its own it no longer posts
create or replace function public.activity_from_season() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.activity set tier = new.tier, score = new.score
  where library_id = new.library_id and kind = 'finished' and season = new.season and log_id is null;
  return new;
end $$;

-- 3) when the whole plan is finished on the same day, the log's "finished" takes over the season's entry (no doubles)
create or replace function public.activity_from_log() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; rated boolean := new.tier is not null or new.score is not null; has boolean; fresh boolean := new.watched_at > now() - interval '36 hours'; sid uuid;
begin
  select * into l from public.library where id = new.library_id;
  if l is null or l.private then return new; end if;
  select exists (select 1 from public.activity where log_id = new.id) into has;
  if has then
    update public.activity set tier = new.tier, score = new.score, kind = case when new.dropped then 'dropped' else 'finished' end,
      coop_with = coalesce(new.coop_with, coop_with) where log_id = new.id;
  elsif fresh and (new.dropped or rated or l.section <> 'movies') then
    if l.section = 'tv' and not new.dropped then
      select id into sid from public.activity where library_id = l.id and kind = 'finished' and log_id is null and created_at > now() - interval '36 hours' order by created_at desc limit 1;
    end if;
    if sid is not null then
      update public.activity set log_id = new.id, seasons_label = public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
        tier = coalesce(new.tier, tier), score = coalesce(new.score, score), coop_with = coalesce(new.coop_with, l.coop_with) where id = sid;
    else
      insert into public.activity (user_id, library_id, log_id, title_id, kind, section, season, seasons_label, tier, score, platform, format, coop_with, created_at)
      values (l.user_id, l.id, new.id, l.title_id, case when new.dropped then 'dropped' else 'finished' end, l.section,
              coalesce(new.season_from, new.seasons[1]), public.seasons_label(new.scope, new.season_from, new.season_to, new.seasons),
              new.tier, new.score, coalesce(new.platform, l.platform), coalesce(new.format, l.format), coalesce(new.coop_with, l.coop_with), now())
      on conflict (log_id) where log_id is not null do nothing;
    end if;
  end if;
  return new;
end $$;

-- 4) reactions: 🔥 😂 👀 😢 on feed events (one of each per person), the author gets a push
create table if not exists public.activity_reactions (
  activity_id uuid not null references public.activity (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (emoji in ('🔥', '😂', '👀', '😢')),
  created_at timestamptz not null default now(),
  primary key (activity_id, user_id, emoji)
);
alter table public.activity_reactions enable row level security;
drop policy if exists "reactions: see" on public.activity_reactions;
create policy "reactions: see" on public.activity_reactions for select using (
  exists (select 1 from public.activity a where a.id = activity_id and (a.user_id = (select auth.uid()) or public.is_friend((select auth.uid()), a.user_id))));
drop policy if exists "reactions: mine" on public.activity_reactions;
create policy "reactions: mine" on public.activity_reactions for insert with check (user_id = (select auth.uid()) and
  exists (select 1 from public.activity a where a.id = activity_id and (a.user_id = (select auth.uid()) or public.is_friend((select auth.uid()), a.user_id))));
drop policy if exists "reactions: unmine" on public.activity_reactions;
create policy "reactions: unmine" on public.activity_reactions for delete using (user_id = (select auth.uid()));
grant select, insert, delete on public.activity_reactions to authenticated;

create or replace function public.reaction_push() returns trigger language plpgsql security definer set search_path = public as $$
declare author uuid;
begin
  select user_id into author from public.activity where id = new.activity_id;
  if author is not null and author <> new.user_id then
    perform public.push_call(jsonb_build_object('type', 'reaction', 'id', new.activity_id, 'from', new.user_id, 'emoji', new.emoji));
  end if;
  return new;
end $$;
drop trigger if exists reaction_push on public.activity_reactions;
create trigger reaction_push after insert on public.activity_reactions for each row execute function public.reaction_push();

-- the feed now brings each event's reactions: [{emoji, count, mine}]
drop function if exists public.activity_feed(int, timestamptz);
create or replace function public.activity_feed(lim int default 40, before timestamptz default null)
returns table (id uuid, user_id uuid, name text, handle text, avatar_url text, kind text, section text, seasons_label text, season int, tier text, score numeric,
               platform text, format text, created_at timestamptz, title_id uuid, title text, poster_url text, year int, mine boolean, coop_names text[], can_delete boolean, backdrop_url text, reactions jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, p.display_name, p.handle, p.avatar_url, a.kind, a.section, a.seasons_label, a.season, a.tier, a.score, a.platform, a.format, a.created_at,
         t.id, t.title, t.poster_url, t.year, a.user_id = auth.uid(),
         (select array_agg(coalesce(cp.display_name, '@' || cp.handle)) from public.profiles cp where cp.id = any (a.coop_with) and public.shares_company(auth.uid(), cp.id)),
         a.user_id = auth.uid() or public.is_admin(), t.backdrop_url,
         (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine) order by r.emoji), '[]'::jsonb)
            from (select emoji, count(*) as n, bool_or(user_id = auth.uid()) as mine from public.activity_reactions where activity_id = a.id group by emoji) r)
  from public.activity a join public.titles t on t.id = a.title_id left join public.profiles p on p.id = a.user_id
  where (a.user_id = auth.uid() or public.is_friend(auth.uid(), a.user_id)) and (before is null or a.created_at < before)
  order by a.created_at desc limit least(lim, 100);
$$;
grant execute on function public.activity_feed(int, timestamptz) to authenticated;
