-- Queued · co-op without hard syncing: "Add" puts the game into the friend's Playing (or just marks co-op if they already have it
-- in progress or done). Finishing, ratings and dates — everyone sets their own. Safe to run more than once.
create or replace function public.answer_coop(inv uuid, accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare i record; lib record;
begin
  select * into i from public.coop_invites where id = inv and to_user = auth.uid() and status = 'pending';
  if i is null then raise exception 'This invite is gone'; end if;
  if not accept then update public.coop_invites set status = 'declined' where id = inv; return; end if;
  select * into lib from public.library where user_id = auth.uid() and title_id = i.title_id;
  if lib is null then
    insert into public.library (user_id, title_id, section, status, platform, coop, coop_with, run_started_at)
    values (auth.uid(), i.title_id, i.section, 'playing', i.platform, true, array[i.from_user], now());
  else
    update public.library set coop = true, coop_with = (select array_agg(distinct x) from unnest(coalesce(coop_with, '{}') || i.from_user) x),
      platform = coalesce(platform, i.platform),
      status = case when lib.status = 'backlog' then 'playing' else status end,                 -- from the Backlog → Playing
      run_started_at = case when lib.status = 'backlog' then now() else run_started_at end
    where id = lib.id;
  end if;
  update public.coop_invites set status = 'accepted' where id = inv;
end $$;
