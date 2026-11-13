-- Queued · admin, step 1: overview, people, settings & tools. Everything here works only for the app's admin (is_admin()).
-- Safe to run more than once.

-- "last seen" (the app touches it when it opens) and AI usage (with a daily limit per person)
alter table public.profiles add column if not exists last_seen_at timestamptz;
create or replace function public.touch_seen() returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
$$;
grant execute on function public.touch_seen() to authenticated;

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_day on public.ai_usage (user_id, created_at);
alter table public.ai_usage enable row level security;

-- one AI call: false when today's limit is used up (the admin has no limit)
create or replace function public.ai_take(kind text) returns boolean language plpgsql security definer set search_path = public as $$
declare lim int := coalesce((select value::int from public.app_config where key = 'ai_daily_limit'), 30); used int;
begin
  if auth.uid() is null then return false; end if;
  if not public.is_admin() then
    select count(*) into used from public.ai_usage where user_id = auth.uid() and created_at > date_trunc('day', now());
    if used >= lim then return false; end if;
  end if;
  insert into public.ai_usage (user_id, kind) values (auth.uid(), kind);
  return true;
end $$;
grant execute on function public.ai_take(text) to authenticated;

-- ---------- overview ----------
create or replace function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path = public, net as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'active_30d', (select count(*) from public.profiles where last_seen_at > now() - interval '30 days'),
    'added_7d', (select count(*) from public.library where created_at > now() - interval '7 days'),
    'finished_7d', (select count(*) from public.logs where watched_at > now() - interval '7 days'),
    'events_7d', (select count(*) from public.activity where created_at > now() - interval '7 days'),
    'reactions_7d', (select count(*) from public.activity_reactions where created_at > now() - interval '7 days'),
    'ai_today', (select count(*) from public.ai_usage where created_at > date_trunc('day', now())),
    'ai_month', (select count(*) from public.ai_usage where created_at > date_trunc('month', now())),
    'ai_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.ai_usage where created_at > date_trunc('month', now()) group by kind) k),
    'failed_24h', (select count(*) from net._http_response where created > now() - interval '24 hours' and (status_code >= 400 or error_msg is not null)),
    'calls_24h', (select count(*) from net._http_response where created > now() - interval '24 hours'),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('at', created, 'status', status_code, 'text', left(coalesce(error_msg, content::text), 160)) order by created desc), '[]'::jsonb)
               from (select * from net._http_response where created > now() - interval '24 hours' and (status_code >= 400 or error_msg is not null) order by created desc limit 5) e)
  ) into r;
  return r;
end $$;

-- ---------- people ----------
create or replace function public.admin_users() returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'joined' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'name', p.display_name, 'handle', p.handle, 'avatar_url', p.avatar_url, 'email', u.email,
      'joined', u.created_at, 'last_seen', p.last_seen_at, 'telegram_off', p.telegram_off,
      'items', (select count(*) from public.library l where l.user_id = p.id),
      'friends', (select count(*) from public.friendships f where f.status = 'accepted' and p.id in (f.requester, f.addressee)),
      'companies', (select coalesce(jsonb_agg(g.title), '[]'::jsonb) from public.tg_members m join public.tg_groups g on g.id = m.group_id where m.user_id = p.id)) as x
    from public.profiles p join auth.users u on u.id = p.id) s);
end $$;

create or replace function public.admin_user_action(target uuid, action text) returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if action = 'reset_intro' then
    update public.profiles set settings = coalesce(settings, '{}'::jsonb) - 'seenVersion' - 'onboarded' - 'tips' where id = target;
  elsif action = 'telegram_off' then
    update public.profiles set telegram_off = true where id = target;
  elsif action = 'delete' then
    if target = auth.uid() then raise exception 'You can’t delete yourself'; end if;
    delete from auth.users where id = target;   -- everything of theirs goes with it
  else raise exception 'Unknown action'; end if;
end $$;

-- ---------- settings & tools ----------
-- server settings: secrets are only shown masked and can't be changed here
create or replace function public.admin_config() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', key,
            'value', case when key ilike '%secret%' or key ilike '%token%' or key ilike '%key%' then '•••• ' || right(value, 2) else value end,
            'editable', key in ('site_url', 'tg_bot_username', 'cloudinary_cloud', 'ai_daily_limit')) order by key), '[]'::jsonb) from public.app_config);
end $$;
create or replace function public.admin_set_config(k text, v text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if k not in ('site_url', 'tg_bot_username', 'cloudinary_cloud', 'ai_daily_limit') then raise exception 'This setting can’t be changed here'; end if;
  insert into public.app_config (key, value) values (k, v) on conflict (key) do update set value = excluded.value;
end $$;
create or replace function public.admin_tool(tool text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if tool = 'test_push' then perform public.push_call(jsonb_build_object('type', 'test', 'to', auth.uid()));
  elsif tool = 'releases' then perform public.push_call(jsonb_build_object('type', 'releases'));
  else raise exception 'Unknown tool'; end if;
end $$;
grant execute on function public.admin_overview(), public.admin_users(), public.admin_user_action(uuid, text), public.admin_config(), public.admin_set_config(text, text), public.admin_tool(text), public.is_admin() to authenticated;
