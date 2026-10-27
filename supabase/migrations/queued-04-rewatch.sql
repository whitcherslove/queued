-- Queued · step 3f · remember "Rewatch" before the movie is rated
-- Safe to run more than once.
alter table public.library add column if not exists rewatch boolean not null default false;
