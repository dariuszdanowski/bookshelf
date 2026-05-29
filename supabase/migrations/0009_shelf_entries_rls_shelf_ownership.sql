-- S-05 impl-review F5: dociśnij RLS shelf_entries o ownership shelf_id.
--
-- Polityki z 0002 walidowały tylko book_id → books.user_id. Junction-tabela
-- shelf_entries ma DWA FK do zasobów per-user (book_id, shelf_id); polityka
-- musi walidować OBA, inaczej user mógłby wstawić/przenieść własną książkę na
-- CUDZĄ półkę (shelf_id z innego usera). S-05 endpoints derywują shelf_id
-- server-side z photo, więc luka jest latentna — ale domykamy ją zanim S-07
-- (move-book) przyjmie shelf_id z klienta. Zob. lessons.md „RLS na join-tabeli".

drop policy if exists "shelf_entries_insert_own" on shelf_entries;
create policy "shelf_entries_insert_own" on shelf_entries for insert with check (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
  and exists (select 1 from shelves where shelves.id = shelf_entries.shelf_id and shelves.user_id = auth.uid())
);

drop policy if exists "shelf_entries_update_own" on shelf_entries;
create policy "shelf_entries_update_own" on shelf_entries for update using (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
) with check (
  exists (select 1 from books where books.id = shelf_entries.book_id and books.user_id = auth.uid())
  and exists (select 1 from shelves where shelves.id = shelf_entries.shelf_id and shelves.user_id = auth.uid())
);
