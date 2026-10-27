-- Queued · import from AppSheet
-- Safe to run more than once.

-- Rows that belong to people who have not signed in yet (matched by email on first sign-in)
create table if not exists public.pending_imports (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  section text not null default 'movies',
  payload jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pending_imports_email on public.pending_imports (lower(email));
alter table public.pending_imports enable row level security;
-- no policies: only the server function (service role) reads and writes this table

-- Movies the importer could not match with confidence; the user picks the right one later
create table if not exists public.import_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  section text not null default 'movies',
  payload jsonb not null,
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.import_reviews enable row level security;
drop policy if exists "import_reviews: own" on public.import_reviews;
create policy "import_reviews: own" on public.import_reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
