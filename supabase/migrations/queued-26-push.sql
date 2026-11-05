-- Queued · push notifications: subscriptions, a call to the "push" function on friend requests / accepts / new feed events,
-- and a daily check of what comes out today. Safe to run more than once.
-- Before running: Database → Extensions → enable pg_net and pg_cron. After running: fill in app_config (see the end).

create extension if not exists pg_net;

-- the phones you get pushes on
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push: mine" on public.push_subscriptions;
create policy "push: mine" on public.push_subscriptions for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- where the push function lives and its secret (server-only; no policies = nobody reads it from the app)
create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;

-- call the push function (quietly does nothing until app_config is filled)
create or replace function public.push_call(body jsonb) returns void language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  select value into url from public.app_config where key = 'push_url';
  select value into secret from public.app_config where key = 'push_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, body := body, headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret));
end $$;

create or replace function public.push_on_friendship() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then perform public.push_call(jsonb_build_object('type', 'friend_request', 'from', new.requester, 'to', new.addressee));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then perform public.push_call(jsonb_build_object('type', 'friend_accepted', 'from', new.addressee, 'to', new.requester));
  end if;
  return new;
end $$;
drop trigger if exists friendship_push on public.friendships;
create trigger friendship_push after insert or update of status on public.friendships for each row execute function public.push_on_friendship();

create or replace function public.push_on_activity() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_call(jsonb_build_object('type', 'activity', 'id', new.id));
  return new;
end $$;
drop trigger if exists activity_push on public.activity;
create trigger activity_push after insert on public.activity for each row execute function public.push_on_activity();

-- what comes out today, per person: new episodes / season premieres of shows you follow, releases in your backlog
create or replace function public.releases_today(d date default current_date)
returns table (user_id uuid, library_id uuid, section text, title text, what text)
language sql stable security definer set search_path = public as $$
  select l.user_id, l.id, 'tv', t.title,
         case when (e->>'n')::int = 1 then 'Season ' || s.season || ' is out' else 'New episode · S' || s.season || ' · E' || (e->>'n') end
  from public.library l join public.titles t on t.id = l.title_id
  join public.title_seasons s on s.title_id = l.title_id
  cross join lateral jsonb_array_elements(s.episodes) e
  where l.section = 'tv' and l.status in ('playing', 'done') and (e->>'air_date')::date = d
  union all
  select l.user_id, l.id, l.section, t.title, 'Out today'
  from public.library l join public.titles t on t.id = l.title_id
  where l.section <> 'tv' and l.status = 'backlog' and t.release_date = d;
$$;

-- every morning (07:00 UTC ≈ 10:00 Moscow) the push function sends today's releases
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'queued-releases';
    perform cron.schedule('queued-releases', '0 7 * * *', $cron$ select public.push_call('{"type":"releases"}'::jsonb) $cron$);
  end if;
end $$;

-- ▼ fill in (once): your project's push function URL and the same secret you put into the function's PUSH_SECRET
-- insert into public.app_config (key, value) values
--   ('push_url', 'https://YOUR-PROJECT.supabase.co/functions/v1/push'),
--   ('push_secret', 'YOUR-LONG-RANDOM-SECRET')
-- on conflict (key) do update set value = excluded.value;
