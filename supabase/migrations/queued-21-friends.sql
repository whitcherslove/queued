-- Queued · friends, step 1: names and @handles, invites, friendships, suggestions,
-- Safe to run more than once.

-- name, @handle and a personal invite code
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists invite_code text;
update public.profiles set invite_code = substr(md5(random()::text || id::text), 1, 10) where invite_code is null;
alter table public.profiles alter column invite_code set default substr(md5(random()::text), 1, 10);
create unique index if not exists profiles_handle on public.profiles (lower(handle)) where handle is not null;
create unique index if not exists profiles_invite on public.profiles (invite_code);

-- a lock: this title is just for me
alter table public.library add column if not exists private boolean not null default false;

-- friendships: a request (pending) that the other side accepts; an invite link makes it accepted at once
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists "friendships: mine" on public.friendships;
create policy "friendships: mine" on public.friendships for select using ((select auth.uid()) in (requester, addressee));
drop policy if exists "friendships: ask" on public.friendships;
create policy "friendships: ask" on public.friendships for insert with check (requester = (select auth.uid()) and status = 'pending');
drop policy if exists "friendships: accept" on public.friendships;
create policy "friendships: accept" on public.friendships for update using (addressee = (select auth.uid())) with check (addressee = (select auth.uid()));
drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: remove" on public.friendships for delete using ((select auth.uid()) in (requester, addressee));

create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;

-- people who uploaded your AppSheet rows: suggested as friends (never added automatically)
create table if not exists public.friend_suggestions (
  user_id uuid not null references auth.users (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, from_user)
);
alter table public.friend_suggestions enable row level security;
drop policy if exists "suggestions: mine" on public.friend_suggestions;
create policy "suggestions: mine" on public.friend_suggestions for select using (user_id = (select auth.uid()));
drop policy if exists "suggestions: dismiss" on public.friend_suggestions;
create policy "suggestions: dismiss" on public.friend_suggestions for delete using (user_id = (select auth.uid()));

-- friends can read each other's name / avatar, lists and journal — except locked titles
drop policy if exists "profiles: friends read" on public.profiles;
create policy "profiles: friends read" on public.profiles for select using (public.is_friend((select auth.uid()), id));
-- (friends don't read your lists — see queued-22; what they see comes from a summary and an activity feed)

-- my friends, requests (both ways) and suggestions, with names — one call
create or replace function public.friend_list() returns table (id uuid, other uuid, status text, incoming boolean, kind text, name text, handle text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select f.id, case when f.requester = auth.uid() then f.addressee else f.requester end, f.status, f.addressee = auth.uid(), 'friend',
         p.display_name, p.handle, p.avatar_url
  from public.friendships f join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  union all
  select null, s.from_user, 'suggested', false, 'suggestion', p.display_name, p.handle, p.avatar_url
  from public.friend_suggestions s join public.profiles p on p.id = s.from_user
  where s.user_id = auth.uid() and not exists (select 1 from public.friendships f where least(f.requester, f.addressee) = least(s.user_id, s.from_user) and greatest(f.requester, f.addressee) = greatest(s.user_id, s.from_user));
$$;

-- open someone's invite link → you're friends right away (the link is their "yes", opening it is yours)
create or replace function public.accept_invite(code text) returns table (name text, handle text)
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select p.id into owner from public.profiles p where p.invite_code = code;
  if owner is null then raise exception 'This invite link is not valid'; end if;
  if owner = auth.uid() then raise exception 'That is your own invite link'; end if;
  insert into public.friendships (requester, addressee, status) values (owner, auth.uid(), 'accepted')
    on conflict (least(requester, addressee), greatest(requester, addressee)) do update set status = 'accepted';
  return query select p.display_name, p.handle from public.profiles p where p.id = owner;
end $$;

-- find someone by @handle (to send a request)
create or replace function public.find_by_handle(h text) returns table (id uuid, name text, handle text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.handle, p.avatar_url from public.profiles p where lower(p.handle) = lower(trim(leading '@' from h)) and p.id <> auth.uid() limit 1;
$$;
grant execute on function public.friend_list(), public.accept_invite(text), public.find_by_handle(text), public.is_friend(uuid, uuid) to authenticated;
