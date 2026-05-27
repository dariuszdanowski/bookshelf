-- Migration: 0005_storage_shelf_photos
-- Prywatny bucket dla zdjęć półek + RLS izolujące obiekty per-user.
--
-- WAŻNE: `supabase db push` DOPIERO PO MERGE do main (branch rule —
-- nieodwracalna zmiana w prod DB; odrzucony PR zostawiłby zombi schema).
--
-- Storage path convention: {auth.uid()}/{uuid}.jpg
-- Pierwszy segment = uid — Storage RLS filtruje po (storage.foldername(name))[1].

-- Bucket prywatny (public=false → brak publicznych URLi)
insert into storage.buckets (id, name, public)
values ('shelf-photos', 'shelf-photos', false)
on conflict (id) do nothing;

-- SELECT: zalogowany user widzi tylko własne obiekty
create policy "shelf_photos_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'shelf-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT: zalogowany user może uploadować tylko pod własny prefiks
create policy "shelf_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'shelf-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: zalogowany user może usuwać tylko własne obiekty
create policy "shelf_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'shelf-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
