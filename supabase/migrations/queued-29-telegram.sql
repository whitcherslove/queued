-- Queued · Telegram: a post to your group's chat when someone finishes something AND rates it
-- (movies: when rated; shows/games/books: when both "finished" and a rating label are there, in any order).
-- A later change of the rating edits the same post. Everyone is in by default; "Post my ratings to Telegram" in Settings turns it off.
-- Safe to run more than once. Needs queued-26 (push_call / app_config). Fill in app_config at the end.

alter table public.profiles add column if not exists telegram_off boolean not null default false;
alter table public.activity add column if not exists tg_message_id bigint;
alter table public.activity add column if not exists tg_tier text;     -- the rating the post shows now (to know when to edit)

create or replace function public.tg_on_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare off boolean; priv boolean;
begin
  if new.kind <> 'finished' or new.tier is null then return new; end if;
  if tg_op = 'UPDATE' and new.tier is not distinct from old.tier and new.score is not distinct from old.score then return new; end if;
  select telegram_off into off from public.profiles where id = new.user_id;
  select private into priv from public.library where id = new.library_id;
  if coalesce(off, false) or coalesce(priv, false) then return new; end if;
  perform public.push_call(jsonb_build_object('type', 'telegram', 'id', new.id));
  return new;
end $$;
drop trigger if exists activity_tg on public.activity;
create trigger activity_tg after insert or update of tier, score, kind on public.activity for each row execute function public.tg_on_activity();

-- ▼ fill in (once):
-- insert into public.app_config (key, value) values
--   ('tg_chat_id', '-100XXXXXXXXXX'),            -- your group's chat id (the bot must be a member)
--   ('cloudinary_cloud', 'YOUR-CLOUD-NAME'),      -- for the picture (cover + avatar + rating badge)
--   ('site_url', 'https://YOUR-APP.vercel.app')   -- where the rating badges live (/tg/ten.png …)
-- on conflict (key) do update set value = excluded.value;
