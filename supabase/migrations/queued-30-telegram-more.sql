-- Queued · Telegram: also "started" and "dropped" posts (finished still goes only once it's rated). Safe to run more than once.
create or replace function public.tg_on_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare off boolean; priv boolean;
begin
  if new.kind = 'finished' then
    if new.tier is null then return new; end if;   -- finished: wait for the rating
    if tg_op = 'UPDATE' and new.tier is not distinct from old.tier and new.score is not distinct from old.score and old.kind = 'finished' then return new; end if;
  elsif new.kind in ('started', 'dropped') then
    if tg_op = 'UPDATE' and old.kind = new.kind then return new; end if;   -- post once
  else
    return new;                                     -- season / show ratings: not posted
  end if;
  select telegram_off into off from public.profiles where id = new.user_id;
  select private into priv from public.library where id = new.library_id;
  if coalesce(off, false) or coalesce(priv, false) then return new; end if;
  perform public.push_call(jsonb_build_object('type', 'telegram', 'id', new.id));
  return new;
end $$;
