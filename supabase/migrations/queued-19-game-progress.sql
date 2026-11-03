-- Queued · games: how far you are in the current playthrough (0–100 %). Safe to run more than once.
alter table public.library add column if not exists progress smallint check (progress between 0 and 100);
