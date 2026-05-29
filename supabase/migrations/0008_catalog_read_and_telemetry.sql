-- S-05: Faza 1 — substrat danych katalogu
--
-- 1. books.is_read: status przeczytania (binarny, default = nie przeczytana)
-- 2. corrections.correction_type: rozszerzenie CHECK o decyzje S-05
--    (accept / reject / field_edit / manual_entry)

alter table books
  add column is_read boolean not null default false;

-- Istniejący inline CHECK (auto-nazwa corrections_correction_type_check) musi
-- zostać upuszczony i odtworzony z nazwą żeby rozszerzenie było idempotentne.
alter table corrections
  drop constraint if exists corrections_correction_type_check;

alter table corrections
  add constraint corrections_correction_type_check
  check (correction_type in (
    'title_typo', 'wrong_author', 'wrong_book', 'not_a_book', 'parse_failure',
    'accept', 'reject', 'field_edit', 'manual_entry'
  ));
