-- Queued · 8 reactions, and "hide my page" (friends then see only your name and avatar; Activity stays as it is). Safe to run more than once.

-- 1) the reaction set: ❤️ 🔥 🤯 😂 😢 💀 🤝 👀
alter table public.activity_reactions drop constraint if exists activity_reactions_emoji_check;
alter table public.activity_reactions add constraint activity_reactions_emoji_check check (emoji in ('❤️', '🔥', '🤯', '😂', '😢', '💀', '🤝', '👀'));

-- 2) hide my page
alter table public.profiles add column if not exists page_hidden boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'friend_summary_full') then
    alter function public.friend_summary(uuid) rename to friend_summary_full;
  end if;
end $$;
create or replace function public.friend_summary(friend uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select id, display_name, handle, avatar_url, page_hidden into p from public.profiles where id = friend;
  if p.page_hidden and friend <> auth.uid() then
    return jsonb_build_object('hidden', true, 'profile', jsonb_build_object('name', p.display_name, 'handle', p.handle, 'avatar_url', p.avatar_url));
  end if;
  return public.friend_summary_full(friend);
end $$;
grant execute on function public.friend_summary(uuid) to authenticated;
