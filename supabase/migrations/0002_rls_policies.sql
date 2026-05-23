-- BookShelf Catalog — RLS policies (M1)
-- Per docs/prd.md § 6 + § 13: każda tabela ma RLS na user_id = auth.uid()
-- Tabele bez własnej user_id kolumny używają EXISTS przez parent FK.

-- 1. profiles — id IS user_id (PK references auth.users)
alter table profiles enable row level security;
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_insert_own" on profiles for insert with check (id = auth.uid());
create policy "profiles_update_own" on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_own" on profiles for delete using (id = auth.uid());

-- 2. shelves
alter table shelves enable row level security;
create policy "shelves_select_own" on shelves for select using (user_id = auth.uid());
create policy "shelves_insert_own" on shelves for insert with check (user_id = auth.uid());
create policy "shelves_update_own" on shelves for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "shelves_delete_own" on shelves for delete using (user_id = auth.uid());

-- 3. photos
alter table photos enable row level security;
create policy "photos_select_own" on photos for select using (user_id = auth.uid());
create policy "photos_insert_own" on photos for insert with check (user_id = auth.uid());
create policy "photos_update_own" on photos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "photos_delete_own" on photos for delete using (user_id = auth.uid());

-- 4. detections — through photos.user_id
alter table detections enable row level security;
create policy "detections_select_own" on detections for select using (
  exists (select 1 from photos where photos.id = detections.photo_id and photos.user_id = auth.uid())
);
create policy "detections_insert_own" on detections for insert with check (
  exists (select 1 from photos where photos.id = detections.photo_id and photos.user_id = auth.uid())
);
create policy "detections_update_own" on detections for update using (
  exists (select 1 from photos where photos.id = detections.photo_id and photos.user_id = auth.uid())
) with check (
  exists (select 1 from photos where photos.id = detections.photo_id and photos.user_id = auth.uid())
);
create policy "detections_delete_own" on detections for delete using (
  exists (select 1 from photos where photos.id = detections.photo_id and photos.user_id = auth.uid())
);

-- 5. book_candidates — through detections → photos.user_id
alter table book_candidates enable row level security;
create policy "book_candidates_select_own" on book_candidates for select using (
  exists (
    select 1 from detections d
    join photos p on p.id = d.photo_id
    where d.id = book_candidates.detection_id and p.user_id = auth.uid()
  )
);
create policy "book_candidates_insert_own" on book_candidates for insert with check (
  exists (
    select 1 from detections d
    join photos p on p.id = d.photo_id
    where d.id = book_candidates.detection_id and p.user_id = auth.uid()
  )
);
create policy "book_candidates_update_own" on book_candidates for update using (
  exists (
    select 1 from detections d
    join photos p on p.id = d.photo_id
    where d.id = book_candidates.detection_id and p.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from detections d
    join photos p on p.id = d.photo_id
    where d.id = book_candidates.detection_id and p.user_id = auth.uid()
  )
);
create policy "book_candidates_delete_own" on book_candidates for delete using (
  exists (
    select 1 from detections d
    join photos p on p.id = d.photo_id
    where d.id = book_candidates.detection_id and p.user_id = auth.uid()
  )
);

-- 6. books
alter table books enable row level security;
create policy "books_select_own" on books for select using (user_id = auth.uid());
create policy "books_insert_own" on books for insert with check (user_id = auth.uid());
create policy "books_update_own" on books for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "books_delete_own" on books for delete using (user_id = auth.uid());

-- 7. shelf_entries — through books.user_id
alter table shelf_entries enable row level security;
create policy "shelf_entries_select_own" on shelf_entries for select using (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
);
create policy "shelf_entries_insert_own" on shelf_entries for insert with check (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
);
create policy "shelf_entries_update_own" on shelf_entries for update using (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
) with check (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
);
create policy "shelf_entries_delete_own" on shelf_entries for delete using (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
);

-- 8. corrections
alter table corrections enable row level security;
create policy "corrections_select_own" on corrections for select using (user_id = auth.uid());
create policy "corrections_insert_own" on corrections for insert with check (user_id = auth.uid());
create policy "corrections_update_own" on corrections for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "corrections_delete_own" on corrections for delete using (user_id = auth.uid());
