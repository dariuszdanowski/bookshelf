-- S-08 catalog search & filters:
-- 1. books.spine_color — denormalizacja koloru grzbietu z detekcji (filtr FR-033).
--    Capture przy confirm (S-05 helper); manual/Flow-B = NULL (brak detekcji).
-- 2. books.search_text — generated STORED do pełnotekstu ILIKE (title+autorzy+wydawnictwo).
--    Rozwiązuje substring-search po authors (text[]) bez tsvector; ~1000/user wystarczy.

alter table books add column spine_color text;

-- array_to_string() jest STABLE (nie IMMUTABLE), więc Postgres odrzuca jej
-- bezpośrednie użycie w GENERATED ALWAYS ... STORED (SQLSTATE 42P17). Owijamy
-- wyrażenie w IMMUTABLE helper — output zależy wyłącznie od argumentów, więc
-- oznaczenie IMMUTABLE jest poprawne. (Adaptacja literalna: pierwszy kontakt z
-- realnym Postgresem przy db push po merge; Vitest mockuje DB.)
create or replace function books_search_text(
  p_title text,
  p_authors text[],
  p_publisher text
)
returns text
language sql
immutable
as $$
  select lower(
    coalesce(p_title, '') || ' ' ||
    array_to_string(coalesce(p_authors, '{}'), ' ') || ' ' ||
    coalesce(p_publisher, '')
  );
$$;

alter table books
  add column search_text text
  generated always as (books_search_text(title, authors, publisher)) stored;

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
