-- S-book-purchase-metadata (Phase 1): purchase metadata for books and photos.
-- books: purchase_price / purchase_city / purchase_event + search_text rebuild.
-- photos: purchase_date / purchase_city / purchase_event (propagated on confirm).

-- 1. Drop generated column first (it depends on books_search_text function).
ALTER TABLE books DROP COLUMN IF EXISTS search_text;
DROP FUNCTION IF EXISTS books_search_text(text, text[], text, text);

-- 2. Rebuild helper with purchase_city + purchase_event (6-arg, IMMUTABLE).
--    array_to_string() is STABLE, not IMMUTABLE — wrap in IMMUTABLE SQL helper
--    (same pattern as 0011 / 0019). Output depends solely on args → IMMUTABLE correct.
CREATE FUNCTION books_search_text(
  p_title       text,
  p_authors     text[],
  p_publisher   text,
  p_description text,
  p_purchase_city  text DEFAULT NULL,
  p_purchase_event text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    coalesce(p_title,  '') || ' ' ||
    array_to_string(coalesce(p_authors, '{}'), ' ') || ' ' ||
    coalesce(p_publisher,     '') || ' ' ||
    coalesce(p_description,   '') || ' ' ||
    coalesce(p_purchase_city, '') || ' ' ||
    coalesce(p_purchase_event,'')
  );
$$;

-- 3. New purchase columns on books (all nullable; no schema change for existing rows).
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS purchase_city  text,
  ADD COLUMN IF NOT EXISTS purchase_event text;

-- 4. Regenerate search_text GENERATED ALWAYS STORED (backfill: purchase_city/event = NULL
--    for all existing rows → no change in search_text content for existing data).
ALTER TABLE books
  ADD COLUMN search_text text
  GENERATED ALWAYS AS (
    books_search_text(title, authors, publisher, description, purchase_city, purchase_event)
  ) STORED;

-- 5. Photo purchase info — propagated to books on confirm/correct.
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS purchase_date  date,
  ADD COLUMN IF NOT EXISTS purchase_city  text,
  ADD COLUMN IF NOT EXISTS purchase_event text;
