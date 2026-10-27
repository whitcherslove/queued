-- Queued · step 3 · AI chat history per item
-- Safe to run more than once.

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.library (id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chats_item on public.chats (library_id, created_at);
alter table public.chats enable row level security;
drop policy if exists "chats: own" on public.chats;
create policy "chats: own" on public.chats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
