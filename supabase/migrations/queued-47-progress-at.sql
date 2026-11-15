-- Queued · "last moved forward": the moment a game's or book's progress changed (or it was started).
-- Home puts what you moved forward last on top — other edits (co-op, platform, details) don't reorder it. Safe to run more than once.
alter table public.library add column if not exists progress_at timestamptz;
update public.library set progress_at = coalesce(run_started_at, started_on::timestamptz, updated_at) where progress_at is null and status = 'playing';

create or replace function public.touch_progress_at() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'playing' then new.progress_at := coalesce(new.progress_at, now()); end if;
  elsif new.progress is distinct from old.progress or new.position_at is distinct from old.position_at
        or (new.status = 'playing' and old.status is distinct from 'playing') then
    new.progress_at := now();
  end if;
  return new;
end $$;
drop trigger if exists library_progress_at on public.library;
create trigger library_progress_at before insert or update on public.library for each row execute function public.touch_progress_at();
