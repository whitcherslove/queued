-- Queued · admin, step 2: platforms (with logos), What's new entries, Telegram companies. Safe to run more than once.

-- 1) platforms added or changed by the admin (a new console, a better logo); the app merges them into its catalog
create table if not exists public.custom_platforms (
  key text primary key check (key ~ '^[a-z0-9-]{2,30}$'),
  label text not null,
  grp text not null default 'Other',
  section text not null default 'console' check (section in ('console', 'pc', 'retro')),
  match text[] not null default '{}',          -- IGDB platform names (lowercase) that mean this platform
  logo_url text,
  updated_at timestamptz not null default now()
);
alter table public.custom_platforms enable row level security;
drop policy if exists "platforms: read" on public.custom_platforms;
create policy "platforms: read" on public.custom_platforms for select using (true);
drop policy if exists "platforms: admin" on public.custom_platforms;
create policy "platforms: admin" on public.custom_platforms for all using (public.is_admin()) with check (public.is_admin());
grant select on public.custom_platforms to anon, authenticated;
grant insert, update, delete on public.custom_platforms to authenticated;

-- logos live in a public storage bucket; only the admin uploads
insert into storage.buckets (id, name, public) values ('plogos', 'plogos', true) on conflict (id) do update set public = true;
drop policy if exists "plogos: admin writes" on storage.objects;
create policy "plogos: admin writes" on storage.objects for insert with check (bucket_id = 'plogos' and public.is_admin());
drop policy if exists "plogos: admin updates" on storage.objects;
create policy "plogos: admin updates" on storage.objects for update using (bucket_id = 'plogos' and public.is_admin());
drop policy if exists "plogos: admin deletes" on storage.objects;
create policy "plogos: admin deletes" on storage.objects for delete using (bucket_id = 'plogos' and public.is_admin());

-- 2) What's new entries written in the admin (added on top of the ones built into the app)
create table if not exists public.changelog_entries (
  version text primary key check (version ~ '^[0-9]+(\.[0-9]+)*$'),
  title text not null,
  items jsonb not null default '[]',            -- [{icon, title, text}]
  created_at timestamptz not null default now()
);
alter table public.changelog_entries enable row level security;
drop policy if exists "changelog: read" on public.changelog_entries;
create policy "changelog: read" on public.changelog_entries for select using (true);
drop policy if exists "changelog: admin" on public.changelog_entries;
create policy "changelog: admin" on public.changelog_entries for all using (public.is_admin()) with check (public.is_admin());
grant select on public.changelog_entries to anon, authenticated;
grant insert, update, delete on public.changelog_entries to authenticated;

-- how many people have seen a version's What's new
create or replace function public.admin_seen_count(v text) returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select count(*) from public.profiles where settings ->> 'seenVersion' = v);
end $$;

-- 3) Telegram companies, all of them
create or replace function public.admin_tg_groups() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'active', g.active, 'chat_id', g.chat_id,
    'posts_7d', (select count(*) from public.tg_posts p join public.activity a on a.id = p.activity_id where p.chat_id = g.chat_id and a.created_at > now() - interval '7 days'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(pr.display_name, '@' || pr.handle), 'avatar_url', pr.avatar_url, 'posting', m.posting) order by m.created_at), '[]'::jsonb)
                from public.tg_members m join public.profiles pr on pr.id = m.user_id where m.group_id = g.id)) order by g.created_at), '[]'::jsonb)
    from public.tg_groups g);
end $$;
create or replace function public.admin_tg_remove(g uuid, member uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.tg_members where group_id = g and user_id = member;
end $$;
create or replace function public.admin_tg_test(g uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  perform public.push_call(jsonb_build_object('type', 'tg_test', 'group', g));
end $$;
grant execute on function public.admin_seen_count(text), public.admin_tg_groups(), public.admin_tg_remove(uuid, uuid), public.admin_tg_test(uuid) to authenticated;
