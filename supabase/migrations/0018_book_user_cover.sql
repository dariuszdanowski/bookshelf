-- Migration: 0018_book_user_cover
-- Override okładki książki przez użytkownika: 3 sloty + flaga wyboru.
--   cover_url        — automatyczna (z GB/OL/BN po ISBN, istnieje od 0001)
--   user_cover_url   — wklejony URL usera (hotlink, nie kopiujemy pliku)
--   cover_photo_url  — publiczny URL wgranego zdjęcia (bucket book-covers)
--   cover_source     — flaga: który slot pokazać ('auto' | 'url' | 'photo')
-- Książki tylko w Bibliotece Narodowej (małe polskie oficyny) nie mają okładki
-- w darmowych API — to pozwala userowi dodać własną.
--
-- WAŻNE: `supabase db push` po merge (branch rule); manualny hotfix tylko świadomie.

alter table books add column if not exists user_cover_url text;
alter table books add column if not exists cover_photo_url text;
alter table books
  add column if not exists cover_source text not null default 'auto'
  check (cover_source in ('auto', 'url', 'photo'));

-- Publiczny bucket na wgrane okładki (public=true → stabilne URL, bez signed-URL).
-- Okładki nie są wrażliwe; ścieżki nieodgadywalne ({uid}/{bookId}-{uuid}.ext).
insert into storage.buckets (id, name, public)
values ('book-covers', 'book-covers', true)
on conflict (id) do nothing;

-- Idempotencja: drop-if-exists przed create (precedens 0004/0005).
drop policy if exists "book_covers_select_public" on storage.objects;
drop policy if exists "book_covers_insert_own" on storage.objects;
drop policy if exists "book_covers_delete_own" on storage.objects;

-- SELECT: publiczny read (bucket public) — okładki wyświetlane bez auth/signing.
create policy "book_covers_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'book-covers');

-- INSERT: zalogowany user może uploadować tylko pod własny prefiks {uid}/...
create policy "book_covers_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: zalogowany user może usuwać tylko własne obiekty
create policy "book_covers_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'book-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
