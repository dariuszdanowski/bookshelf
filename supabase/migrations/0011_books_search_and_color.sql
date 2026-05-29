-- S-08 catalog search & filters:
-- 1. books.spine_color — denormalizacja koloru grzbietu z detekcji (filtr FR-033).
--    Capture przy confirm (S-05 helper); manual/Flow-B = NULL (brak detekcji).
-- 2. books.search_text — generated STORED do pełnotekstu ILIKE (title+autorzy+wydawnictwo).
--    Rozwiązuje substring-search po authors (text[]) bez tsvector; ~1000/user wystarczy.

alter table books add column spine_color text;

alter table books
  add column search_text text
  generated always as (
    lower(
      coalesce(title, '') || ' ' ||
      array_to_string(authors, ' ') || ' ' ||
      coalesce(publisher, '')
    )
  ) stored;

-- Backfill koloru dla istniejących książek z fotografii (przez aktualny wpis półkowy → detekcja).
update books
set spine_color = (
  select d.spine_color
  from shelf_entries se
  join detections d on d.id = se.detection_id
  where se.book_id = books.id
    and se.is_current
    and d.spine_color is not null
  limit 1
)
where spine_color is null;
