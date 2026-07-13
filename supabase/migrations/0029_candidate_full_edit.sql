-- candidate-propose-edit-all-fields (Phase 1): pełna edycja kandydata przed zatwierdzeniem.
--
-- edited_at: znacznik "kandydat był ręcznie edytowany" — czytany przez confirm.ts/
--   confirm-batch.ts do wyboru correction_type ('field_edit' vs 'accept').
-- purchase_*: override danych zakupu per-kandydat (zamiast dzielonych photos.purchase_*).
--
-- Bez zmian RLS — istniejąca blankietowa book_candidates_update_own (0002) już
-- pokrywa nowe kolumny (UPDATE przez detection_id → photos.user_id).

alter table book_candidates
  add column if not exists edited_at timestamptz,
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric(10,2),
  add column if not exists purchase_city text,
  add column if not exists purchase_event text;
