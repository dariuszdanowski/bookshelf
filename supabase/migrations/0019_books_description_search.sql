-- S-17 catalog description search (FR-032):
-- 1. book_candidates.description / books.description — „krótki opis z publicznej bazy"
--    capture'owany z Google Books przy matchingu (przycinany do 2000 znaków w kliencie,
--    nie w DB — CHECK byłby kosztem bez zysku dla nullable pola wypełnianego przez nas).
-- 2. books.search_text — rozszerzenie GENERATED kolumny o opis (FR-032: full-text
--    obejmuje tytuł, autora, wydawnictwo ORAZ krótki opis z publicznej bazy).
--    GENERATED ALWAYS ... STORED nie da się ALTER-ować — wymagana sekwencja
--    DROP COLUMN → DROP FUNCTION (stara 3-arg sygnatura) → CREATE FUNCTION (4-arg)
--    → ADD COLUMN. ADD COLUMN ... STORED przelicza wszystkie istniejące wiersze,
--    co stanowi darmowy backfill search_text (description = NULL → bez zmiany treści).

alter table book_candidates add column description text;
alter table books add column description text;

-- search_text zależy od books_search_text() — kolumna musi spaść PRZED funkcją.
alter table books drop column search_text;
drop function books_search_text(text, text[], text);

-- array_to_string() jest STABLE (nie IMMUTABLE), więc Postgres odrzuca jej
-- bezpośrednie użycie w GENERATED ALWAYS ... STORED (SQLSTATE 42P17) — wzorzec
-- IMMUTABLE helpera z 0011. Output zależy wyłącznie od argumentów, więc
-- oznaczenie IMMUTABLE jest poprawne.
create function books_search_text(
  p_title text,
  p_authors text[],
  p_publisher text,
  p_description text
)
returns text
language sql
immutable
as $$
  select lower(
    coalesce(p_title, '') || ' ' ||
    array_to_string(coalesce(p_authors, '{}'), ' ') || ' ' ||
    coalesce(p_publisher, '') || ' ' ||
    coalesce(p_description, '')
  );
$$;

alter table books
  add column search_text text
  generated always as (books_search_text(title, authors, publisher, description)) stored;
