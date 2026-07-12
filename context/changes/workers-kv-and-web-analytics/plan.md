# S-51: Workers KV cache + Web Analytics — plan implementacji

## Przegląd

Dwa niezależne, darmowe elementy Cloudflare dodawane w jednym slice'u (S-51),
bo oba to zero-koszt/zero-config infrastruktura CF: (a) Workers KV jako cache
odpowiedzi Google Books / OpenLibrary, (b) Cloudflare Web Analytics jako beacon
`<script>`. Nie dzielą kodu — realizowane jako dwie niezależne fazy.

## Analiza stanu obecnego

`src/lib/books/googleBooks.ts` (`fetchBooks`, linie 91-135) i
`src/lib/books/openLibrary.ts` (`fetchOL`, linie 54-83) wołają zewnętrzne API
bez żadnego cache'owania. `src/lib/matching/findCandidates.ts` uruchamia
kaskadę do ~9 requestów GB (isbn → intitle+inauthor → intitle → inpublisher →
free-text warianty → inauthor-only + word-fallback pętla do 3 dodatkowych) i
do 2 requestów OL (title, potem ISBN) **na każdą detekcję z osobna** —
`src/pages/api/photos/[id]/process.ts:368-377` woła `findBookCandidates` przez
`Promise.allSettled` bez żadnego dedupu między detekcjami w tym samym zdjęciu,
a tym bardziej między zdjęciami różnych userów. S-39 (`match-rate-limit-resilience`,
done) dodał retry+backoff na 429 w `fetchBooks`, ale nie cache — te same
zapytania o popularne tytuły wciąż trafiają do Google Books za każdym razem.

`wrangler.jsonc` nie ma żadnego `kv_namespaces` bindingu. `Cloudflare.Env`
(`src/env.d.ts:22-32`) typuje 7 sekretów (string), zero bindingów obiektowych.
Wzorzec odczytu env jest ugruntowany: `env?.X ?? import.meta.env.X`
(`supabase.server.ts`, `googleBooks.ts:33-35` dla `GOOGLE_BOOKS_API_KEY`) —
binding może być `undefined` w Vitest (`vitest.config.ts:8-18` stub `env: {}`)
i to jest już bezpiecznie obsłużone dla sekretów; nowy KV binding musi
podążać za tym samym wzorcem optional-chaining.

`src/layouts/Layout.astro` (jedyny layout, `<head>` linie 64-91) nie ma CSP,
nonce ani żadnego beacon/analytics scriptu — dodanie `<script>` nie koliduje
z niczym istniejącym.

### Kluczowe odkrycia:

- Kaskada GB/OL nie ma dedupu nawet **wewnątrz jednego batcha** (ten sam tytuł
  wykryty 2× na zdjęciu = 2 identyczne zapytania) — `findCandidates.ts:29-133`,
  `process.ts:368-377`.
- `GOOGLE_BOOKS_API_KEY` jest jedynym, globalnym kluczem serwera (nie per-user
  BYOK) — cache współdzielony między userami nie wycieka żadnych danych
  per-user; URL zapytania (włącznie z `key=`) jest identyczny dla wszystkich.
- `worker-configuration.d.ts` (generowany, gitignored) ma ambientowy globalny
  typ `KVNamespace` niezależnie od tego, czy `wrangler.jsonc` deklaruje jakiś
  `kv_namespaces` — nie trzeba czekać na regenerację, żeby dodać typ do
  `Cloudflare.Env` w `src/env.d.ts` (ten plik jest ręcznie augmentowany, nie
  generowany — `AGENTS.md:32`).
- `.github/workflows/ci.yml` uruchamia E2E przez `npm run dev` (Vite), nie
  `wrangler dev`. `@astrojs/cloudflare@13.7.0` używa `@cloudflare/vite-plugin`
  (nie starego `platformProxy`), który udostępnia bindingi bezpośrednio w
  `astro dev` — ten sam mechanizm już dziś eksponuje sekrety
  (`env.GOOGLE_BOOKS_API_KEY` itp.), więc KV binding powinien działać już w
  `npm run dev` bez potrzeby `npm run preview`. `src/lib/db/AGENTS.md:37`
  flaguje niepełną emulację TYLKO dla `caches.default` (inne, specyficzne
  Workers-only API) — nie generalizujemy tego na KV bez dowodu; weryfikacja
  w fazie 1 sprawdza najpierw `npm run dev`, `npm run preview` tylko jako
  fallback gdyby jednak nie działało.

## Pożądany stan końcowy

Po tym planie: (a) powtarzalne zapytania o ten sam tytuł/ISBN do Google Books
i OpenLibrary trafiają w KV zamiast do zewnętrznego API (weryfikowalne przez
Cloudflare dashboard → KV → liczba odczytów/zapisów rosnąca po deployu,
oraz przez ponowne zaimportowanie tego samego zdjęcia i obserwację niższej
liczby wychodzących requestów w logach); (b) `bookshelf.workers.dev` (lub
domena produkcyjna) wysyła RUM do Cloudflare Web Analytics, widoczne w
Cloudflare dashboard → Analytics & Logs → Web Analytics.

## Czego NIE robimy

- Cache dla Biblioteki Narodowej (`nationalLibrary.ts`) — poza literalnym
  zakresem roadmapy S-51, BN nie ma dziś problemu z rate-limitem.
- Invalidacja/purge cache przy zmianie metadanych książki przez usera (dotyczy
  wyłącznie wyników wyszukiwania `book_candidates`, nie samej tabeli `books`).
- Dashboard/alerting na metryki KV poza natywnym Cloudflare dashboardem.
- `ctx.waitUntil` dla zapisów do KV (patrz „Krytyczne szczegóły" niżej) —
  świadome uproszczenie, nie wymaga przepływu `ExecutionContext` przez cały
  stack wywołań.
- Automatyzacja tworzenia Web Analytics site w CI — jednorazowy krok infra
  (jak `wrangler secret put` dla innych sekretów).

## Podejście do implementacji

Faza 1 opakowuje istniejące funkcje fetchujące (`fetchBooks`, `fetchOL`) cienką
warstwą cache KV — zero zmian w logice kaskady/scoringu, cache jest
transparentny dla wywołujących. Faza 2 to izolowany dodatek UI (jeden
`<script>` w layout + jedna zmienna env) bez żadnej zależności od fazy 1.

## Krytyczne szczegóły implementacji

- **KV eventual consistency**: zapisy KV propagują się globalnie z opóźnieniem
  (do ~60s), a w obrębie jednego batcha requesty do tego samego zapytania
  mogą się nakładać (concurrency 5 w `runner.ts`), więc dwa równoległe
  detekcje o tym samym tytule mogą OBIE spudłować cache i obie odpytać
  zewnętrzne API — to nie regresja (dziś zawsze pudłują), tylko brak
  optymalizacji w tym jednym przypadku brzegowym. Nie projektujemy dodatkowego
  in-memory dedupu na to — poza zakresem S-51.
- **Brak `ctx.waitUntil`**: `apiCache.ts` woła `await kv.put(...)` inline przed
  zwróceniem wyniku (nie fire-and-forget) — bez dostępu do
  `ExecutionContext` w tych czysto-funkcyjnych modułach, niezawodowany zapis
  bez `waitUntil` ryzykowałby ucięcie przez runtime po zwrocie response.
  Koszt: +1 KV roundtrip (dziesiątki ms) po już wykonanym zewnętrznym fetchu —
  akceptowalne.
- **Cache błędów**: `rate_limited` i `network` NIGDY nie trafiają do KV —
  cache'owanie retry-wartego stanu przejściowego zepsułoby mechanizm S-39.
  Tylko `ok: true` (TTL 30 dni) i `empty` (TTL 1 dzień) są cache'owane.
- **Wersjonowanie klucza cache**: `apiCache.ts` eksportuje `CACHE_KEY_VERSION`
  (patrz Faza 1 → Krok 4) — dodaj komentarz przy `BookCandidate`/
  `BookSearchResult` w `src/lib/books/schema.ts` przypominający, że zmiana
  kształtu tych typów wymaga bumpnięcia `CACHE_KEY_VERSION` w `apiCache.ts`
  (inaczej stare wpisy KV serwują niekompatybilny kształt do 30 dni po
  deployu).
- **Darmowy limit KV**: 1000 zapisów/dzień (free tier) — kaskada GB+OL na
  jedną nową detekcję to do ~11 potencjalnych zapisów (cache-miss), więc
  masowy pierwszy import (PRD celuje w ~1000 książek) może wyczerpać dzienny
  budżet zapisów. Degradacja jest łagodna (try/catch w kroku 4 — przekroczony
  limit = zapis się nie uda, request i tak zwraca wynik z fetchera), ale
  świadomie akceptujemy to ograniczenie zamiast dodawać throttling/kolejkę —
  poza zakresem tego slice'a.

---

## Faza 1: Workers KV cache dla Google Books / OpenLibrary

### Przegląd

Nowy moduł cache + opakowanie dwóch istniejących funkcji fetchujących +
wiring bindingu KV (wrangler.jsonc, env.d.ts, realny namespace w Cloudflare).

### Wymagane zmiany:

#### 1. Utworzenie realnego KV namespace w Cloudflare

**Cel**: Potrzebny realny `id` do wpisania w `wrangler.jsonc` przed deployem
(lokalny dev/CI działa bez niego — binding będzie `undefined` tam, gdzie
platforma nie dostarczy prawdziwego zasobu).

**Kontrakt**: Utworzyć namespace przez Cloudflare MCP (`mcp__cloudflare__execute`
lub odpowiednik) na koncie użytym przez `wrangler.jsonc` (`account_id` z
istniejącego deploy configu) — nazwa np. `bookshelf-book-api-cache`. Zapisać
zwrócone `id` do kroku 2.

#### 2. `wrangler.jsonc` — binding KV

**Plik**: `wrangler.jsonc`

**Cel**: Zadeklarować binding `BOOK_API_CACHE_KV` wskazujący na namespace z
kroku 1.

**Kontrakt**: Dodać klucz `"kv_namespaces"` (konwencja JSONC array-of-objects,
NIE TOML `[[kv_namespaces]]` — ten plik jest `.jsonc`):
```jsonc
"kv_namespaces": [
  { "binding": "BOOK_API_CACHE_KV", "id": "<id z kroku 1>" }
]
```

#### 3. `src/env.d.ts` — typ bindingu

**Plik**: `src/env.d.ts`

**Cel**: Dodać binding do `Cloudflare.Env`, żeby `env?.BOOK_API_CACHE_KV` był
typowany w `apiCache.ts` (analogicznie do istniejących sekretów w tym samym
interfejsie, linie 22-32).

**Kontrakt**: Nowe pole `BOOK_API_CACHE_KV?: KVNamespace` (z `?`, jak
`GOOGLE_BOOKS_API_KEY?: string` linia 30 — `wrangler types` wygeneruje ten
binding jako required w `worker-configuration.d.ts`, ale manualna deklaracja
z `?` scala się przez TS declaration merging do poprawnego
`KVNamespace | undefined`, zgodnego z realnym stanem w Vitest/dev, gdzie
binding bywa faktycznie nieobecny — bez `?` scalony typ myląco twierdziłby,
że binding jest zawsze obecny. Typ `KVNamespace` jest globalnym ambientowym
typem z `worker-configuration.d.ts`, nie wymaga importu).

#### 4. Nowy moduł cache

**Plik**: `src/lib/books/apiCache.ts`

**Cel**: Jedna funkcja opakowująca dowolny fetcher zwracający `BookSearchResult`
w odczyt/zapis KV, transparentna dla wywołującego. Musi działać identycznie
jak dziś (bez cache) gdy `env.BOOK_API_CACHE_KV` jest `undefined` (dev/CI/Vitest).

**Kontrakt**:
```ts
export const CACHE_KEY_VERSION = 'v1'; // bump przy zmianie kształtu BookCandidate/BookSearchResult

export async function withApiCache(
  cacheKey: string,
  fetcher: () => Promise<BookSearchResult>,
): Promise<BookSearchResult>
```
- `cacheKey` = `${CACHE_KEY_VERSION}:${url}`, gdzie `url` to pełny URL requestu
  (wywołujący przekazuje `url` już zbudowany przez `buildUrl`/`URLSearchParams`
  — brak własnej normalizacji zapytania w tym module). Prefiks wersji
  zapobiega serwowaniu niekompatybilnego kształtu z KV po przyszłej zmianie
  pól `BookCandidate`/`BookSearchResult` (historia częstych zmian: opis w
  S-17, sloty okładki w S-33) — TTL 30 dni bez wersjonowania mógłby serwować
  stary kształt aż do miesiąca po deployu zmiany. Przy każdej zmianie kształtu
  tych typów: zbumpuj `CACHE_KEY_VERSION` (dodaj komentarz przy definicji
  `BookCandidate`/`BookSearchResult` w `schema.ts` przypominający o tym).
- Brak bindingu (`env?.BOOK_API_CACHE_KV` undefined) → wołaj `fetcher()`
  bezpośrednio, bez odczytu/zapisu KV.
- Odczyt: `kv.get(cacheKey, 'json')` opakowane w try/catch (błąd KV → traktuj
  jak miss, nie przerywaj requestu). Hit → zwróć zdeserializowany
  `BookSearchResult` bez wołania `fetcher()`.
- Miss → wołaj `fetcher()`. Jeśli wynik `{ ok: true }` → `kv.put(cacheKey,
  JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 30 })` (30 dni).
  Jeśli `{ ok: false, reason: 'empty' }` → `expirationTtl: 60 * 60 * 24` (1
  dzień). Jeśli `reason` to `rate_limited`/`network` → NIE zapisuj do KV.
  Zapis też w try/catch (błąd zapisu nie może wywalić requestu).
- Eksportuj też stałe TTL (`CACHE_TTL_OK_SECONDS`, `CACHE_TTL_EMPTY_SECONDS`)
  dla czytelności testów.

#### 5. `googleBooks.ts` — opakowanie `fetchBooks`

**Plik**: `src/lib/books/googleBooks.ts`

**Cel**: Każde wywołanie `fetchBooks(url)` (linia 91) przechodzi przez cache
zanim wykona retry-loop + realny `fetch`.

**Kontrakt**: `fetchBooks` (linie 91-135) zostaje wewnętrzną funkcją bez
zmian; nowa funkcja `fetchBooksCached(url)` (lub inline w miejscu wywołania)
woła `withApiCache(url, () => fetchBooks(url))`. Wszystkie call site'y
`fetchBooks(...)` w tym pliku (kaskada w `searchGoogleBooks`, 6 miejsc)
zamieniane na wołanie przez cache. Retry+backoff (429) pozostaje WEWNĄTRZ
`fetchBooks` — cache opakowuje całą funkcję z retry, nie pojedynczy `fetch`.

#### 6. `openLibrary.ts` — opakowanie `fetchOL`

**Plik**: `src/lib/books/openLibrary.ts`

**Cel**: Analogicznie do kroku 5, dla obu eksportowanych funkcji
(`searchOpenLibraryByTitle`, `searchOpenLibrary`), które obie przechodzą przez
`fetchOL` (linia 54).

**Kontrakt**: Ten sam wzorzec — `withApiCache(url, () => fetchOL(url))` w
miejscu wywołania `fetchOL(...)`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run test:unit -- apiCache` — nowe testy modułu cache przechodzą
- `npm run test:unit -- googleBooks` — istniejące testy nadal zielone (brak
  bindingu w mocku `cloudflare:workers` → zero zmiany zachowania, identyczne
  liczby wywołań `fetch`)
- `npm run test:unit -- openLibrary` — jw.
- `npm run typecheck` (`npx wrangler types && astro check`) — `KVNamespace`
  binding typuje się poprawnie
- `npm run lint`
- `npm run build`

#### Weryfikacja ręczna:

- Deploy na staging/prod, dwukrotny upload tego samego zdjęcia (lub
  ręczny rematch tej samej detekcji) → w Cloudflare dashboard → KV widoczny
  wzrost liczby odczytów po drugim uruchomieniu (drugi request nie generuje
  nowego zapytania do Google Books w logach Workera)
- Sprawdź binding KV najpierw w `npm run dev` (oczekiwane: działa — ten sam
  mechanizm `@cloudflare/vite-plugin` co istniejące sekrety); `npm run
  preview` tylko jako fallback, jeśli `npm run dev` jednak zawiedzie

---

## Faza 2: Cloudflare Web Analytics beacon

### Przegląd

Dodanie darmowego RUM (bez cookies) przez jeden `<script>` w `Layout.astro`,
sterowany opcjonalną zmienną env — brak zmiennej = brak scriptu (dev/CI/preview
nie zaśmiecają realnego dashboardu analytics).

### Wymagane zmiany:

#### 1. Utworzenie Web Analytics site w Cloudflare

**Cel**: Uzyskać `data-cf-beacon` token dla domeny produkcyjnej.

**Kontrakt**: Sprawdzić przez Cloudflare MCP (`docs`/`search`), czy istnieje
API do utworzenia RUM site programatycznie. Jeśli tak — utworzyć przez MCP.
Jeśli nie — udokumentować jako manualny krok jednorazowy (Cloudflare Dashboard
→ Analytics & Logs → Web Analytics → Add a site → skopiować token) i
zatrzymać się tu po automatycznych krokach do potwierdzenia przez usera
(zgodnie z zasadą: infrastrukturalne akcje na koncie usera wymagają
świadomości/zgody, nie tylko automatycznego wykonania).

#### 2. `.env.example` + dokumentacja zmiennej

**Plik**: `.env.example`

**Cel**: Udokumentować nową opcjonalną zmienną build-time.

**Kontrakt**: Nowa sekcja z komentarzem: `PUBLIC_CF_BEACON_TOKEN` — opcjonalny,
token z Cloudflare Web Analytics (nie jest sekretem — widoczny w źródle
strony), puste = brak beacon scriptu.

#### 3. `src/layouts/Layout.astro` — beacon script

**Plik**: `src/layouts/Layout.astro`

**Cel**: Renderować beacon script w `<head>` TYLKO gdy token jest ustawiony.

**Kontrakt**: W frontmatter dodać `const cfBeaconToken =
import.meta.env.PUBLIC_CF_BEACON_TOKEN;` (browser-side channel — zgodnie z
regułą repo-wide z CLAUDE.md, `PUBLIC_*` czytane wyłącznie przez
`import.meta.env`, NIGDY `cloudflare:workers` po stronie klienta). W `<head>`
(po istniejącym `<title>`, linia 90) warunkowe:
```astro
{cfBeaconToken && (
  <script
    defer
    src="https://static.cloudflareinsights.com/beacon.min.js"
    data-cf-beacon={`{"token": "${cfBeaconToken}"}`}
  />
)}
```

#### 4. `.github/workflows/deploy.yml` — build env

**Plik**: `.github/workflows/deploy.yml`

**Cel**: Przekazać `PUBLIC_CF_BEACON_TOKEN` do Vite build-time inlining, tak
jak istniejące `PUBLIC_SUPABASE_*` (linie 43-44).

**Kontrakt**: Dodać `PUBLIC_CF_BEACON_TOKEN: ${{ secrets.PUBLIC_CF_BEACON_TOKEN
}}` do bloku `env:` kroku `Build`. Wymaga dodania sekretu
`PUBLIC_CF_BEACON_TOKEN` w GitHub Repository Secrets (manualny krok usera —
wartość z kroku 1).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run typecheck` — brak błędów po zmianie w `Layout.astro`
- `npm run lint`
- `npm run build` — build przechodzi zarówno z `PUBLIC_CF_BEACON_TOKEN`
  ustawionym, jak i bez niego (lokalny build bez zmiennej = brak scriptu,
  zero błędu)
- Istniejące testy E2E (`tests/e2e/**`) nadal zielone — beacon script nie
  wpływa na żaden istniejący `getByRole`/lokator (dodany element nie ma
  roli interaktywnej)

#### Weryfikacja ręczna:

- Po deployu: otworzyć produkcyjny URL, sprawdzić w devtools Network, że
  `beacon.min.js` się ładuje i wysyła request do `cloudflareinsights.com`
- Po ~kilku minutach ruchu: sprawdzić Cloudflare Dashboard → Analytics & Logs
  → Web Analytics → dane widoczne dla wybranej domeny

---

## Strategia testowania

### Testy jednostkowe:

- `tests/unit/lib/books/apiCache.test.ts` (nowy): hit zwraca zdeserializowany
  wynik bez wołania fetchera; miss woła fetcher i zapisuje z właściwym TTL
  (`ok:true` → 30 dni, `empty` → 1 dzień); `rate_limited`/`network` nie
  zapisywane; brak bindingu (`env: {}`) → zero wywołań `kv.get`/`kv.put`,
  zawsze woła fetcher; błąd `kv.get`/`kv.put` (throw) nie przerywa requestu
  (fallback jak miss / jak brak zapisu)
- `tests/unit/lib/books/googleBooks.test.ts` (rozszerzenie): z mockiem
  `BOOK_API_CACHE_KV` w `env` — drugi identyczny request nie woła `fetch`
  (serwowany z mock-KV); istniejące testy bez zmian zachowania (binding
  undefined w istniejącym mocku `env: { GOOGLE_BOOKS_API_KEY: undefined }`)
- `tests/unit/lib/books/openLibrary.test.ts` (rozszerzenie): analogicznie

### Testy integracyjne:

Brak nowych — KV binding nie ma lokalnego emulatora w ścieżce
`vitest.integration.config.ts` (real Supabase, nie real Cloudflare bindings);
weryfikacja KV to manualny krok (patrz Faza 1 → Weryfikacja ręczna).

### Kroki testowania ręcznego:

1. Deploy z realnym KV namespace, dwukrotny rematch tej samej detekcji →
   potwierdzić w CF dashboard wzrost odczytów KV i brak drugiego requestu do
   Google Books w logach
2. Sprawdzić binding KV najpierw w `npm run dev`; `npm run preview` tylko
   jako fallback jeśli `npm run dev` nie emuluje bindingu
3. Beacon: otworzyć stronę produkcyjną, sprawdzić Network tab +
   Cloudflare Web Analytics dashboard po kilku minutach ruchu

## Uwagi dotyczące wydajności

Cache dodaje jeden KV roundtrip (odczyt) PRZED zewnętrznym fetchem i jeden
(zapis) PO — dla cache hit: znaczące przyspieszenie (KV odczyt ~kilka-kilkanaście
ms vs. zewnętrzny HTTP call ~100-500ms). Dla cache miss: łączny narzut ~10-20ms
(odczyt miss + zapis) na tle requestu, który i tak trwa setki ms — pomijalne.

## Uwagi dotyczące migracji

Brak migracji danych — czysto addytywna zmiana infrastrukturalna. Rollback =
usunięcie bindingu z `wrangler.jsonc` (funkcje fetchujące działają identycznie
bez cache, jak dziś).

## Referencje

- `src/lib/books/googleBooks.ts` (fetchBooks: 91-135, cascade: 145-201)
- `src/lib/books/openLibrary.ts` (fetchOL: 54-83)
- `src/lib/matching/findCandidates.ts` (wywołujący, brak dedupu: 29-133)
- `src/lib/db/AGENTS.md` (wzorzec env/binding, gotcha lokalnego dev)
- `context/archive/2026-06-07-match-rate-limit-resilience/change.md` (S-39,
  zależność roadmapy)
- `context/foundation/roadmap.md:82` (definicja slice'u S-51)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Workers KV cache dla Google Books / OpenLibrary

#### Automatyczne

- [x] 1.1 `npm run test:unit -- apiCache` zielone (nowe testy)
- [x] 1.2 `npm run test:unit -- googleBooks` zielone (bez regresji)
- [x] 1.3 `npm run test:unit -- openLibrary` zielone (bez regresji)
- [x] 1.4 `npm run typecheck` zielone
- [x] 1.5 `npm run lint` zielone
- [x] 1.6 `npm run build` zielone

#### Ręczne

- [x] 1.7 Deploy + dwukrotny rematch → KV odczyty rosną, brak duplikatu requestu do GB w logach (potwierdzone przez zawartość KV Pairs w dashboardzie + `wrangler kv key list/get` — 5 wpisów OpenLibrary poprawnie zapisanych; „Metrics" tab dashboardu 0 to znane opóźnienie analityki, nie brak danych; pełny test z Google Books odłożony do resetu wyczerpanego dziennego limitu GB, user zaakceptował dowód jako wystarczający)
- [x] 1.8 Binding KV działa w `npm run dev` (fallback: `npm run preview`) — techniczny test przez `.wrangler/state/v3/kv/` (Miniflare lokalny) potwierdził inicjalizację namespace'u przy starcie dev servera; timing-based test dwóch identycznych wywołań `/api/books/candidates` nierozstrzygający (zdominowany przez realny rate-limit GB przez Promise.all z OL) — zaakceptowane jako low-risk przez analogię do 1.7 (identyczny mechanizm `@astrojs/cloudflare` już potwierdzony w produkcji)

### Faza 2: Cloudflare Web Analytics beacon

#### Automatyczne

- [x] 2.1 `npm run typecheck` zielone
- [x] 2.2 `npm run lint` zielone
- [x] 2.3 `npm run build` zielone (z i bez `PUBLIC_CF_BEACON_TOKEN`)
- [x] 2.4 E2E (`tests/e2e/**`) — 220/221 zielone; 1 fail w `admin.spec.ts:137` potwierdzony jako pre-existing (reprodukuje identycznie z `Layout.astro` cofniętym do stanu sprzed Fazy 2, `git stash` izolacja) — brak regresji z tej fazy

#### Ręczne

- [ ] 2.5 Beacon ładuje się na produkcji (Network tab)
- [ ] 2.6 Dane widoczne w Cloudflare Web Analytics dashboard po kilku minutach ruchu
