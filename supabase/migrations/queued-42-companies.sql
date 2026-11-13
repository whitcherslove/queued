-- Queued · companies: an owner (👑), rename, delete (the bot leaves the chat), companies without a Telegram chat
-- (connect one later), admin connects a chat by ID; in a company you can send a friend request to the others. Safe to run more than once.

alter table public.tg_groups add column if not exists owner uuid references auth.users (id) on delete set null;
alter table public.tg_groups alter column chat_id drop not null;          -- a company can live without a chat
update public.tg_groups set owner = created_by where owner is null and created_by is not null;
-- Karaoke Club № 1 (made by SQL, no creator) belongs to the admin
update public.tg_groups set owner = (select id from auth.users where lower(email) = 'sumbelka14@gmail.com') where owner is null;
alter table public.tg_links add column if not exists group_id uuid references public.tg_groups (id) on delete cascade;

create or replace function public.tg_can_manage(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.tg_groups where id = g and owner = auth.uid());
$$;

-- a company without a chat: a name and you in it
create or replace function public.create_tg_group(t text) returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if coalesce(trim(t), '') = '' then raise exception 'Name it first'; end if;
  insert into public.tg_groups (title, owner, created_by) values (trim(t), auth.uid(), auth.uid()) returning id into g;
  insert into public.tg_members (group_id, user_id, added_by) values (g, auth.uid(), auth.uid());
  return g;
end $$;

create or replace function public.rename_tg_group(g uuid, t text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tg_can_manage(g) then raise exception 'Only the owner can rename it'; end if;
  if coalesce(trim(t), '') = '' then raise exception 'Name it first'; end if;
  update public.tg_groups set title = trim(t) where id = g;
end $$;

create or replace function public.transfer_tg_owner(g uuid, member uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tg_can_manage(g) then raise exception 'Only the owner can hand it over'; end if;
  if not public.tg_is_member(g, member) then raise exception 'They’re not in this company'; end if;
  update public.tg_groups set owner = member where id = g;
end $$;

-- delete: the bot leaves the chat, the company is gone for everyone (posts already sent stay in Telegram)
create or replace function public.delete_tg_group(g uuid) returns void language plpgsql security definer set search_path = public as $$
declare c bigint;
begin
  if not public.tg_can_manage(g) then raise exception 'Only the owner can delete it'; end if;
  select chat_id into c from public.tg_groups where id = g;
  if c is not null then perform public.push_call(jsonb_build_object('type', 'tg_leave', 'chat_id', c)); end if;
  delete from public.tg_groups where id = g;
end $$;

-- the "connect a chat" link, optionally for an existing company (then that company gets the chat)
drop function if exists public.create_tg_link();
create or replace function public.create_tg_link(g uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
begin
  if g is not null and not public.tg_can_manage(g) then raise exception 'Only the owner can connect a chat'; end if;
  delete from public.tg_links where created_at < now() - interval '1 day';
  insert into public.tg_links (code, user_id, group_id) values (c, auth.uid(), g);
  return jsonb_build_object('code', c, 'bot', (select value from public.app_config where key = 'tg_bot_username'));
end $$;

-- admin: connect a chat by its ID
create or replace function public.admin_tg_connect(g uuid, chat bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if exists (select 1 from public.tg_groups where chat_id = chat and id <> g) then raise exception 'That chat already belongs to another company'; end if;
  update public.tg_groups set chat_id = chat, active = true where id = g;
end $$;

-- my companies: owner, chat or not, and for each member: friends with me / request sent
create or replace function public.my_tg_groups() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'title', g.title, 'active', g.active, 'has_chat', g.chat_id is not null, 'owner', g.owner, 'can_manage', public.tg_can_manage(g.id),
    'posting', (select m.posting from public.tg_members m where m.group_id = g.id and m.user_id = auth.uid()),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
                 'can_remove', public.tg_can_remove(g.id, p.id), 'owner', p.id = g.owner,
                 'friend', p.id = auth.uid() or public.is_friend(auth.uid(), p.id),
                 'requested', exists (select 1 from public.friendships f where f.status = 'pending' and ((f.requester = auth.uid() and f.addressee = p.id) or (f.requester = p.id and f.addressee = auth.uid()))))
                 order by m.created_at), '[]'::jsonb)
                from public.tg_members m join public.profiles p on p.id = m.user_id where m.group_id = g.id)
  ) order by g.created_at), '[]'::jsonb)
  from public.tg_groups g where public.tg_is_member(g.id, auth.uid());
$$;

-- admin list: owner too
create or replace function public.admin_tg_groups() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'active', g.active, 'chat_id', g.chat_id, 'owner', g.owner,
    'posts_7d', (select count(*) from public.tg_posts p join public.activity a on a.id = p.activity_id where p.chat_id = g.chat_id and a.created_at > now() - interval '7 days'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(pr.display_name, '@' || pr.handle), 'avatar_url', pr.avatar_url, 'posting', m.posting) order by m.created_at), '[]'::jsonb)
                from public.tg_members m join public.profiles pr on pr.id = m.user_id where m.group_id = g.id)) order by g.created_at), '[]'::jsonb)
    from public.tg_groups g);
end $$;

grant execute on function public.create_tg_group(text), public.rename_tg_group(uuid, text), public.transfer_tg_owner(uuid, uuid), public.delete_tg_group(uuid),
  public.create_tg_link(uuid), public.admin_tg_connect(uuid, bigint), public.tg_can_manage(uuid) to authenticated;
