-- Queued · books, step 1: allow books, their format and page / minute progress. Safe to run more than once.

-- titles can be books; library rows can live in the "books" section
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.titles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table public.titles drop constraint %I', c); end if;
  select conname into c from pg_constraint where conrelid = 'public.library'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%section%';
  if c is not null then execute format('alter table public.library drop constraint %I', c); end if;
end $$;
alter table public.titles  add constraint titles_kind_check    check (kind in ('movie', 'tv', 'game', 'book'));
alter table public.library add constraint library_section_check check (section in ('movies', 'tv', 'console', 'pc', 'retro', 'books'));

-- the format you read in (paper / ebook / audio) and how far you are: page or minute (progress % stays in "progress")
alter table public.library add column if not exists format text check (format in ('paper', 'ebook', 'audio'));
alter table public.library add column if not exists position_at integer;      -- current page, or listened minutes for audio
alter table public.logs    add column if not exists format text check (format in ('paper', 'ebook', 'audio'));
