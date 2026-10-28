-- Queued · faster list queries.
-- 1) Row level security: auth.uid() is evaluated once per query instead of once per row (Supabase recommendation).
-- 2) Indexes for how the app actually reads.
-- Safe to run more than once.

drop policy if exists "library: own" on public.library;
create policy "library: own" on public.library for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "logs: own" on public.logs;
create policy "logs: own" on public.logs for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "chats: own" on public.chats;
create policy "chats: own" on public.chats for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "episode_marks: own" on public.episode_marks;
create policy "episode_marks: own" on public.episode_marks for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "season_ratings: own" on public.season_ratings;
create policy "season_ratings: own" on public.season_ratings for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "import_reviews: own" on public.import_reviews;
create policy "import_reviews: own" on public.import_reviews for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select using ((select auth.uid()) = id);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert with check ((select auth.uid()) = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create index if not exists library_user_section_pos on public.library (user_id, section, position, id);
create index if not exists logs_library on public.logs (library_id);
create index if not exists logs_user_watched on public.logs (user_id, watched_at desc, id);
create index if not exists title_seasons_title on public.title_seasons (title_id, season);
analyze public.library; analyze public.logs; analyze public.episode_marks; analyze public.titles;
