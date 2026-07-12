# workers-kv-and-web-analytics

**Status:** implementing
**Updated:** 2026-07-12

## Opis

S-51: dwa darmowe elementy Cloudflare dodane razem. (a) Workers KV jako cache
odpowiedzi Google Books / OpenLibrary keszowany po pełnym URL zapytania (nie
`external_id` — ten nie jest znany przed fetchem) — redukuje liczbę zewnętrznych
zapytań o ten sam tytuł między userami, adresuje rate-limit z S-39 (dziś tylko
retry+backoff, bez cache). (b) Cloudflare Web Analytics — darmowy RUM bez
cookies, beacon `<script>` w `Layout.astro` sterowany opcjonalnym env var.

## Zakres

- `src/lib/books/apiCache.ts` — nowy moduł: `withApiCache(kind, url, fetcher)`
- `src/lib/books/googleBooks.ts` — `fetchBooks()` opakowane cache'em
- `src/lib/books/openLibrary.ts` — `fetchOL()` opakowane cache'em
- `wrangler.jsonc` — binding `BOOK_API_CACHE_KV` (`kv_namespaces`)
- `src/env.d.ts` — `Cloudflare.Env.BOOK_API_CACHE_KV: KVNamespace`
- Utworzenie realnego KV namespace w Cloudflare (przez Cloudflare MCP)
- `src/layouts/Layout.astro` — opcjonalny beacon Web Analytics
- `.github/workflows/deploy.yml` — `PUBLIC_CF_BEACON_TOKEN` w build env
- `.env.example` — dokumentacja nowej zmiennej
- Testy jednostkowe: `apiCache.test.ts` (nowy) + rozszerzenie `googleBooks.test.ts`/`openLibrary.test.ts`

## Poza zakresem

- Cache dla Biblioteki Narodowej (`nationalLibrary.ts`) — brak dziś problemu z rate-limitem, poza literalnym zakresem S-51
- Invalidacja cache przy edycji książki przez usera (dotyczy tylko `book_candidates` search, nie `books`)
- Dashboard/alerting na metryki KV (obserwowalność ograniczona do natywnego Cloudflare dashboardu)
- Automatyczne tworzenie Web Analytics site przez CI (jednorazowy krok infra)
