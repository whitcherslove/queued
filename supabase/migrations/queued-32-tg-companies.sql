-- Queued · Telegram companies: each Telegram chat is a "company". Your posts go to the chats of the companies you're in.
-- Any member of a company can add any of THEIR friends to it (so nobody can wander into someone else's company).
-- A new chat is connected with a link to the bot (t.me/<bot>?startgroup=<code>) — handled by the "telegram-bot" function.
-- The chat that's set up now becomes "Karaoke Club № 1" with everyone in it. Safe to run more than once.

create table if not exists public.tg_groups (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null unique,
  title text not null,
  active boolean not null default true,       -- false when the bot was removed from the chat
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.tg_members (
  group_id uuid not null references public.tg_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  posting boolean not null default true,      -- "post my activity here"
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table if not exists public.tg_posts (     -- what the bot posted where (to edit it when a rating changes)
  activity_id uuid not null references public.activity (id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  tier text,
  primary key (activity_id, chat_id)
);
create table if not exists public.tg_links (     -- one-time codes for connecting a new chat
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.tg_groups enable row level security;
alter table public.tg_members enable row level security;
alter table public.tg_posts enable row level security;
alter table public.tg_links enable row level security;
-- everything the app needs goes through the functions below (they check membership / friendship)

create or replace function public.tg_is_member(g uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tg_members where group_id = g and user_id = u);
$$;

-- my companies, with members
create or replace function public.my_tg_groups() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'title', g.title, 'active', g.active,
    'posting', (select m.posting from public.tg_members m where m.group_id = g.id and m.user_id = auth.uid()),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url) order by m.created_at), '[]'::jsonb)
                from public.tg_members m join public.profiles p on p.id = m.user_id where m.group_id = g.id)
  ) order by g.created_at), '[]'::jsonb)
  from public.tg_groups g where public.tg_is_member(g.id, auth.uid());
$$;

-- add a friend of yours to a company you're in
create or replace function public.add_tg_member(g uuid, friend uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tg_is_member(g, auth.uid()) then raise exception 'You are not in this company'; end if;
  if not public.is_friend(auth.uid(), friend) then raise exception 'You can only add your friends'; end if;
  insert into public.tg_members (group_id, user_id, added_by) values (g, friend, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.leave_tg_group(g uuid) returns void language sql security definer set search_path = public as $$
  delete from public.tg_members where group_id = g and user_id = auth.uid();
$$;
create or replace function public.set_tg_posting(g uuid, on_ boolean) returns void language sql security definer set search_path = public as $$
  update public.tg_members set posting = on_ where group_id = g and user_id = auth.uid();
$$;

-- a link for connecting a new chat: the code and the bot's username
create or replace function public.create_tg_link() returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
begin
  delete from public.tg_links where created_at < now() - interval '1 day';
  insert into public.tg_links (code, user_id) values (c, auth.uid());
  return jsonb_build_object('code', c, 'bot', (select value from public.app_config where key = 'tg_bot_username'));
end $$;

grant execute on function public.my_tg_groups(), public.add_tg_member(uuid, uuid), public.leave_tg_group(uuid), public.set_tg_posting(uuid, boolean), public.create_tg_link() to authenticated;

-- the chat that's set up now → "Karaoke Club № 1", with everyone who already has an account
insert into public.tg_groups (chat_id, title)
select value::bigint, 'Karaoke Club № 1' from public.app_config where key = 'tg_chat_id'
on conflict (chat_id) do nothing;
insert into public.tg_members (group_id, user_id)
select g.id, p.id from public.tg_groups g cross join public.profiles p
where g.chat_id = (select value::bigint from public.app_config where key = 'tg_chat_id')
on conflict do nothing;

-- ▼ fill in (once): the bot's username without @ (for the "connect a chat" link)
-- insert into public.app_config (key, value) values ('tg_bot_username', 'YourBotName') on conflict (key) do update set value = excluded.value;
