-- Queued · your own posters and backgrounds (uploaded from the device)
-- Safe to run more than once.
insert into storage.buckets (id, name, public) values ('covers', 'covers', true)
  on conflict (id) do nothing;

drop policy if exists "covers: upload own" on storage.objects;
create policy "covers: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "covers: update own" on storage.objects;
create policy "covers: update own" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "covers: delete own" on storage.objects;
create policy "covers: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
