-- Queued · one clear state per title.
-- "Dropped" stops being a rating: a journal entry can be marked as dropped (didn't finish it),
-- and for shows "Dropped" is a state that hides the show from every list.
-- Safe to run more than once.

alter table public.logs add column if not exists dropped boolean not null default false;

-- old "Dropped" ratings become the dropped mark on the entry
update public.logs set dropped = true, tier = null where tier = 'dropped';

-- movies: a dropped movie is simply a watched (journal) entry marked dropped
update public.library set status = 'done' where section = 'movies' and status = 'dropped';

-- shows: if your latest entry was dropped and the show isn't in Watching/Backlog, the show is Dropped
update public.library l set status = 'dropped'
 where l.section = 'tv' and l.status = 'done'
   and (select g.dropped from public.logs g where g.library_id = l.id order by g.watched_at desc limit 1) = true;

-- seasons rated "Dropped" lose that rating (the state lives on the show now)
update public.season_ratings set tier = null where tier = 'dropped';
