# S-51: Workers KV + Web Analytics — krótki plan

> Pełny plan: `context/changes/workers-kv-and-web-analytics/plan.md`

## Co i dlaczego

Dwa darmowe elementy Cloudflare dodane w jednym slice'u: (a) Workers KV jako
cache odpowiedzi Google Books/OpenLibrary — redukuje redundantne zewnętrzne
zapytania o te same tytuły między userami, adresując rate-limit z S-39;
(b) Cloudflare Web Analytics — darmowy RUM przez jeden `<script>` beacon,
zero wpływu na performance, użyteczny dowód „monitoring produkcji" do
self-review certyfikacyjnego.

## Punkt wyjścia

`googleBooks.ts`/`openLibrary.ts` fetchują zewnętrzne API bez żadnego cache —
każda detekcja na każdym zdjęciu (nawet duplikat tego samego tytułu w jednym
batchu) generuje osobne zapytania. S-39 (done) dodał tylko retry+backoff na
429, nie cache. `wrangler.jsonc` nie ma dziś żadnego KV bindingu; `Layout.astro`
nie ma żadnego analytics/beacon scriptu.

## Pożądany stan końcowy

Powtarzalne zapytania o ten sam tytuł trafiają w KV zamiast do zewnętrznego
API (widoczne w CF dashboardzie jako rosnąca liczba odczytów KV i niższy ruch
wychodzący do Google Books). Strona produkcyjna wysyła RUM do Cloudflare Web
Analytics, widoczne w dashboardzie bez własnego kodu trackującego.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Klucz cache | Pełny request URL, nie `external_id` | `external_id` to wynik wyszukiwania, nie jego parametr — nie jest znany przed fetchem | Plan |
| Punkt opakowania | `fetchBooks()`/`fetchOL()` (wewnętrzne, niskopoziomowe) | Pokrywa całą kaskadę zapytań (do ~9 GB requestów), nie tylko pierwszy krok | Plan |
| Zakres źródeł | Tylko GB + OL, bez Biblioteki Narodowej | Literalny zakres roadmapy S-51; BN nie ma dziś problemu z rate-limitem | Roadmap |
| TTL | `ok:true` → 30 dni, `empty` → 1 dzień, błędy → brak cache | Metadane książek się nie zmieniają; błędy przejściowe muszą zostać retry-owalne (S-39) | Plan |
| Brak bindingu w dev/CI/Vitest | Cache no-op, bezpośredni fetch | Ten sam wzorzec optional-chaining co istniejący `GOOGLE_BOOKS_API_KEY` — zero regresji testów | Plan |
| Web Analytics token | Env var `PUBLIC_CF_BEACON_TOKEN` (opcjonalny), nie hardcode | Token nie jest sekretem, ale env var izoluje dev/CI od zaśmiecania realnego dashboardu | Plan |

## Zakres

**W zakresie:**
- Nowy moduł `src/lib/books/apiCache.ts` + opakowanie `fetchBooks`/`fetchOL`
- KV namespace (Cloudflare, przez MCP) + binding w `wrangler.jsonc` + typ w `env.d.ts`
- Beacon script w `Layout.astro` sterowany opcjonalnym env var
- Testy jednostkowe nowego modułu + rozszerzenie istniejących testów GB/OL

**Poza zakresem:**
- Cache dla Biblioteki Narodowej
- Invalidacja cache przy edycji książki przez usera
- Automatyzacja tworzenia Web Analytics site w CI

## Architektura / Podejście

Faza 1: cienka warstwa cache KV opakowująca istniejące fetch-funkcje na
najniższym poziomie (transparentna dla kaskady matchingu, zero zmian w
`findCandidates.ts`). Faza 2: izolowany dodatek jednego warunkowego
`<script>` w jedynym layoucie, zero zależności od fazy 1.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Workers KV cache | Cache GB/OL keszowany po URL, TTL zróżnicowany wg wyniku | Lokalna emulacja bindingu KV w `npm run dev` (Vite) może nie działać — wymaga weryfikacji przez `npm run preview` |
| 2. Web Analytics beacon | Darmowy RUM widoczny w CF dashboardzie | Tworzenie RUM site może wymagać manualnego kroku w dashboardzie (brak potwierdzonego API) |

**Wymagania wstępne:** dostęp do Cloudflare MCP/dashboardu tego konta (już
skonfigurowany w projekcie); S-39 done (spełnione).
**Szacowany nakład pracy:** ~1 sesja, 2 fazy (KV cache ~60% czasu, beacon ~40%).

## Otwarte ryzyka i założenia

- Lokalna emulacja KV bindingu przez `@astrojs/cloudflare` w `npm run dev`
  (Vite) nie jest potwierdzona — `src/lib/db/AGENTS.md` już flaguje podobny
  gotcha dla innych Workers-only API (`caches.default`); jeśli nie działa,
  weryfikacja lokalna przechodzi przez `npm run preview`.
- Tworzenie Web Analytics site programatycznie przez Cloudflare API nie jest
  potwierdzone — jeśli MCP nie obsłuży, krok staje się manualny (dashboard),
  analogicznie do istniejących manualnych kroków infra (`wrangler secret put`).

## Kryteria sukcesu (podsumowanie)

- Ten sam tytuł zapytany dwukrotnie nie generuje drugiego requestu do Google
  Books/OpenLibrary (widoczne w CF dashboard + logach Workera)
- Strona produkcyjna wysyła dane RUM widoczne w Cloudflare Web Analytics
- Zero regresji: wszystkie istniejące testy jednostkowe/E2E zielone bez zmian zachowania przy braku bindingu KV
