-- =============================================================================
-- JEDNORAZOWY backfill (M27, 2026-06-07): przypisanie istniejących rekordów
-- kosztów do klucza „Anthropic" usera dariusz.danowski@gmail.com.
--
-- WYMAGA: migracja 0020_runs_api_key_attribution zaaplikowana (kolumna
-- api_key_id w vision_runs/refine_calls).
--
-- Idempotentny: aktualizuje wyłącznie wiersze z api_key_id IS NULL.
-- Zakres: tylko rekordy tego jednego usera (nie dotyka innych kont).
-- =============================================================================

-- Klucz docelowy (zweryfikowany na prod 2026-06-07):
--   id       = 640c7703-62b2-4f72-b52e-bc94c776bdcd
--   label    = 'Anthropic', provider = 'anthropic', is_active = true
--   user     = dariusz.danowski@gmail.com
-- Stan przed: 26 vision_runs (24 succeeded), 0 refine_calls, wszystkie bez atrybucji.

UPDATE vision_runs vr
SET api_key_id = '640c7703-62b2-4f72-b52e-bc94c776bdcd'
FROM auth.users u
WHERE vr.user_id = u.id
  AND u.email = 'dariusz.danowski@gmail.com'
  AND vr.api_key_id IS NULL;

UPDATE refine_calls rc
SET api_key_id = '640c7703-62b2-4f72-b52e-bc94c776bdcd'
FROM auth.users u
WHERE rc.user_id = u.id
  AND u.email = 'dariusz.danowski@gmail.com'
  AND rc.api_key_id IS NULL;

-- Weryfikacja:
-- SELECT api_key_id, count(*), round(sum(cost_usd)::numeric, 4) AS suma
-- FROM vision_runs vr JOIN auth.users u ON u.id = vr.user_id
-- WHERE u.email = 'dariusz.danowski@gmail.com'
-- GROUP BY api_key_id;
