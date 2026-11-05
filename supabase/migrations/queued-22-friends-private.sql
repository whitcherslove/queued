-- Queued · friends: friends do NOT read your lists. Removes the read rules added in queued-21
-- (friendships, names, invites and suggestions stay). Safe to run more than once.
drop policy if exists "library: friends read" on public.library;
drop policy if exists "logs: friends read" on public.logs;
do $$ begin
  if to_regclass('public.episode_marks') is not null then execute 'drop policy if exists "marks: friends read" on public.episode_marks'; end if;
end $$;
