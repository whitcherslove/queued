-- Queued · Telegram companies: removing people. You can remove someone you added; the person who connected the chat
-- (and the app's admin) can remove anyone. Everyone can still leave on their own. Safe to run more than once.
create or replace function public.tg_can_remove(g uuid, member uuid) returns boolean language sql stable security definer set search_path = public as $$
  select member <> auth.uid() and public.tg_is_member(g, auth.uid()) and (
    public.is_admin()
    or exists (select 1 from public.tg_groups x where x.id = g and x.created_by = auth.uid())
    or exists (select 1 from public.tg_members m where m.group_id = g and m.user_id = member and m.added_by = auth.uid()));
$$;

create or replace function public.remove_tg_member(g uuid, member uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tg_can_remove(g, member) then raise exception 'You can remove only people you added'; end if;
  delete from public.tg_members where group_id = g and user_id = member;
end $$;

-- my companies: each member says whether I can remove them
create or replace function public.my_tg_groups() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'title', g.title, 'active', g.active,
    'posting', (select m.posting from public.tg_members m where m.group_id = g.id and m.user_id = auth.uid()),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.display_name, '@' || p.handle), 'avatar_url', p.avatar_url,
                 'can_remove', public.tg_can_remove(g.id, p.id)) order by m.created_at), '[]'::jsonb)
                from public.tg_members m join public.profiles p on p.id = m.user_id where m.group_id = g.id)
  ) order by g.created_at), '[]'::jsonb)
  from public.tg_groups g where public.tg_is_member(g.id, auth.uid());
$$;
grant execute on function public.remove_tg_member(uuid, uuid), public.tg_can_remove(uuid, uuid) to authenticated;
