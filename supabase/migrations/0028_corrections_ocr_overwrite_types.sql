-- weak-match-resolve-and-ocr-audit: zachowanie historii OCR przy rematch/refine.
--
-- 1. corrections.correction_type: dopuszcza 'rematch' i 'refine' — loguje
--    nadpisanie raw_title/raw_author przy tych akcjach (dziś ginie bezpowrotnie).
-- 2. corrections.original_raw_author: nowa kolumna, nullable — istniejące
--    corrected_authors trzyma NOWĄ wartość, brak miejsca na oryginalnego autora
--    sprzed nadpisania. Historyczne wiersze dostają NULL (brak migracji danych).

alter table corrections add column original_raw_author text;

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.corrections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%correction_type%';
  if cname is not null then
    execute format('alter table public.corrections drop constraint %I', cname);
  end if;
end $$;

alter table corrections
  add constraint corrections_correction_type_check
  check (correction_type in (
    'title_typo', 'wrong_author', 'wrong_book', 'not_a_book', 'parse_failure',
    'accept', 'reject', 'field_edit', 'manual_entry', 'ai_resolution_not_found',
    'rematch', 'refine'
  ));
