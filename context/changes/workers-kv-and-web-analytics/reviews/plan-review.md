<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: S-51: Workers KV cache + Web Analytics — plan implementacji

- **Plan**: context/changes/workers-kv-and-web-analytics/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-12
- **Werdykt**: DO POPRAWY
- **Ustalenia**: 0 krytycznych, 3 ostrzeżenia, 1 obserwacja

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | OSTRZEŻENIE |
| Kompletność planu | OSTRZEŻENIE |

## Ugruntowanie

Grounding: 8/8 ścieżek ✓, 4/4 symboli ✓ (GOOGLE_BOOKS_API_KEY?: string linia 30 env.d.ts; 6 call site'ów fetchBooks: 149/158/169/176/187/195; 2 call site'y fetchOL: 102/118; wrangler `addBinding(kv.binding, "KVNamespace", "kv_namespaces", ...)` w cli.js:204969), brief↔plan ✓ (TTL, klucz cache, zakres źródeł identyczne w obu dokumentach).

## Ustalenia

### F1 — Binding KV w `Cloudflare.Env` musi być opcjonalny (`?`), inaczej typ kłamie o dostępności w dev/CI/Vitest

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1, Krok 3 (`src/env.d.ts` — typ bindingu)
- **Szczegóły**: Kontrakt kroku 3 podaje `BOOK_API_CACHE_KV: KVNamespace` (BEZ `?`), inaczej niż analogiczne istniejące pole `GOOGLE_BOOKS_API_KEY?: string` (`src/env.d.ts:30`), które jest opcjonalne właśnie dlatego, że w Vitest `cloudflare:workers` jest stubowane jako `env: {}` (`vitest.config.ts:8-18`). Zweryfikowałem empirycznie (probe + `npm run typecheck`): `wrangler types` dla bindingu zadeklarowanego w `kv_namespaces` wygeneruje w `worker-configuration.d.ts` **required** pole (`addBinding` w wrangler `cli.js:204969`, renderowane bez `?` — dokładnie jak `ASSETS: Fetcher` dziś). Manualna deklaracja w `src/env.d.ts` merguje się z tym generowanym typem przez TS declaration merging — gdy manualna wersja ma `?`, scalony typ poprawnie zwęża się do `KVNamespace | undefined` (potwierdzone dla `GOOGLE_BOOKS_API_KEY` przez realny `npm run typecheck` — assignment do `string` rzucił `TS2322`). Jeśli krok 3 zostanie wdrożony dosłownie (bez `?`), scalony typ `env.BOOK_API_CACHE_KV` będzie `KVNamespace` (nigdy `undefined`) mimo że w Vitest/dev faktycznie może być `undefined` — guard `if (!env?.BOOK_API_CACHE_KV)` w `apiCache.ts` nadal skompiluje się (nie zablokuje builda), ale typ będzie mylący względem runtime'u, dokładnie ten problem, który `?` przy `GOOGLE_BOOKS_API_KEY` już świadomie rozwiązuje.
- **Poprawka**: Zmienić kontrakt kroku 3 na `BOOK_API_CACHE_KV?: KVNamespace` (z `?`), zgodnie z konwencją `GOOGLE_BOOKS_API_KEY?: string`.
- **Decyzja**: NAPRAWIONE (zastosowano poprawkę w plan.md)

### F2 — Brak wersjonowania klucza cache przy przyszłej zmianie kształtu `BookCandidate`/`BookSearchResult`

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 1, Krok 4 (`src/lib/books/apiCache.ts`)
- **Szczegóły**: `withApiCache` serializuje/deserializuje `BookSearchResult` przez `JSON.stringify`/`kv.get(key, 'json')` bez żadnej walidacji kształtu przy odczycie. TTL dla trafień to 30 dni. `BookCandidate` (`src/lib/books/schema.ts:8-23`) to czysty typ TS (bez runtime walidacji) i ma historię częstych zmian kształtu w tym repo (opis dodany w S-17, sloty okładki w S-33) — każda przyszła zmiana pola (dodanie/usunięcie/rename) sprawi, że wpisy zapisane PRZED deployem zmiany będą przez do 30 dni zwracać stary/niekompatybilny kształt bez żadnego ostrzeżenia w runtime (np. brak nowego pola, na którym downstream kod może polegać bez guard'a).
- **Poprawka A ⭐ Recommended**: Prefiksuj klucz cache stałą wersji (`const CACHE_KEY_VERSION = 'v1'; cacheKey = \`${CACHE_KEY_VERSION}:${url}\``); bumpuj przy każdej zmianie kształtu `BookCandidate`/`BookSearchResult`.
  - Siła: Jednolinijkowa zmiana teraz; przyszła migracja kształtu jest darmowa (stare wpisy naturalnie wygasają pod starym prefiksem, nieosiągalne pod nowym).
  - Kompromis: Wymaga pamiętania o bumpowaniu wersji przy każdej zmianie kształtu — czysto proceduralne, łatwe do przeoczenia bez przypominajki w kodzie przy typie.
  - Pewność: WYSOKA — standardowy, tani wzorzec cache-versioning, zero nowych zależności.
  - Martwy punkt: Brak automatycznego przypomnienia przy edycji `BookCandidate` poza komentarzem przy stałej.
- **Poprawka B**: Zod-waliduj każdy hit KV względem nowego `BookSearchResultSchema`; traktuj niezgodność jak miss.
  - Siła: Samo-naprawialne nawet bez pamiętania o bumpowaniu wersji — niezgodny stary wpis zostanie odrzucony automatycznie.
  - Kompromis: Wymaga napisania i utrzymania nowego schematu Zod dla typu, który dziś jest czystym TS bez runtime walidacji — większy zakres niż faza 1 dziś planuje, plus narzut CPU na każdy hit.
  - Pewność: ŚREDNIA — poprawne, ale szerszy zakres niż minimalna poprawka.
  - Martwy punkt: Nie chroni przed zmianami zod-valid, ale semantycznie innymi (zmiana znaczenia pola bez zmiany typu).
- **Decyzja**: NAPRAWIONE (Poprawka A — `CACHE_KEY_VERSION` prefiks w plan.md)

### F3 — Brak uwzględnienia darmowego limitu 1000 zapisów KV/dzień przy scenariuszu masowego pierwszego importu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 1 — „Uwagi dotyczące wydajności"
- **Szczegóły**: Cloudflare KV darmowy tier: 100k odczytów / **1k zapisów** / dzień. Kaskada GB dla jednej detekcji to do 6 zapytań + word-fallback (do 3 więcej) + 2 zapytania OL = do ~11 potencjalnych zapisów KV (cache-miss) na JEDNĄ detekcję nowego tytułu. `docs/prd.md` (wizja produktu) i `docs/plan-implementacji.md` (demo content „3 półki, ~30 książek") jasno stawiają jako cel skatalogowanie kolekcji rzędu ~1000 książek — dokładnie scenariusz masowego pierwszego importu, w którym WSZYSTKIE zapytania są cache-miss (pierwsze zetknięcie z danym tytułem), co przy ~30-165 detekcjach na sesję łatwo wyczerpie dzienny budżet 1000 zapisów. Plan nie wspomina o tym limicie ani nie mierzy oczekiwanego wolumenu — degradacja jest łagodna (`kv.put` w try/catch, patrz krok 4), ale user mógłby błędnie zdiagnozować wyczerpanie limitu jako "cache nie działa".
- **Poprawka A ⭐ Recommended**: Udokumentuj limit w planie/kodzie (komentarz przy `apiCache.ts`) i polegaj na istniejącym try/catch (już projektowanym w kroku 4) jako łagodnej degradacji — bez dodatkowego kodu.
  - Siła: Zero dodatkowej złożoności; try/catch już to obsługuje poprawnie.
  - Kompromis: Podczas masowego importu benefit cache'a częściowo zniknie (writes wyczerpane) — bez świadomości tego faktu user mógłby to błędnie zdiagnozować jako bug.
  - Pewność: WYSOKA — typowy, akceptowalny kompromis dla darmowego tier w projekcie tej skali.
  - Martwy punkt: Brak telemetrii w aplikacji pokazującej ile zapisów odrzucił limit (tylko CF dashboard).
- **Poprawka B**: Rozważ Workers Paid ($5/mies., zwiększa limity KV) lub throttling zapisów przy dużych batchach.
  - Siła: Eliminuje ryzyko przekroczenia limitu przy dużych importach.
  - Kompromis: Koszt (choć `docs/plan-implementacji.md` już sugeruje Paid plan potencjalnie potrzebny dla CPU limitu 30s z innych powodów) lub dodatkowa złożoność kolejkowania zapisów.
  - Pewność: ŚREDNIA — nie zweryfikowano, czy user już ma Workers Paid.
  - Martwy punkt: Nie sprawdzono obecnego planu Cloudflare (Free/Paid) na koncie usera.
- **Decyzja**: ZAAKCEPTOWANO RYZYKO JAKO ZDEZAKTUALIZOWANE — user potwierdził zakup Cloudflare Workers Paid ($5/mies.) w trakcie tego przeglądu; limity KV na Paid są rzędu milionów zapisów/dzień, więc scenariusz masowego pierwszego importu (~1000 książek) przestaje być realnym ryzykiem. Notka dokumentacyjna o limicie (dodana do planu przy F2) zostaje jako nieszkodliwa świadomość, bez dalszych zmian kodu.

### F4 — Nadgeneralizacja gotchy „lokalna emulacja bindingów bywa niepełna" do KV bez dowodu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: „Analiza stanu obecnego" (Kluczowe odkrycia, ostatni punkt) + Faza 1 → Weryfikacja ręczna
- **Szczegóły**: Plan cytuje `src/lib/db/AGENTS.md:37` (gotcha specyficzna dla `caches.default`) jako dowód, że KV też może wymagać `npm run preview` zamiast `npm run dev`. Weryfikacja: `astro.config.mjs:42` używa `cloudflare()` bez opcji (brak `platformProxy` — ta opcja nie istnieje już w tej wersji adaptera); `@astrojs/cloudflare@13.7.0` zależy od `@cloudflare/vite-plugin@^1.39.0`, który (per własny README) udostępnia bezpośredni dostęp do Workers runtime API i bindingów w trakcie `astro dev` — to ten sam mechanizm, który dziś już eksponuje sekrety (`env.GOOGLE_BOOKS_API_KEY` itp.) w `npm run dev`. Brak jednoznacznego potwierdzenia z kodu źródłowego pluginu specyficznie dla KV, ale generalizacja z `caches.default` (inny typ API, udokumentowany osobno jako wyjątek) na KV nie ma podstawy — `npm run dev` prawdopodobnie już wystarczy, a krok „zweryfikuj przez npm run preview" może być zbędnym dodatkowym krokiem ręcznym.
- **Poprawka**: Zmień krok weryfikacji ręcznej 1.8 na: „Sprawdź binding KV najpierw w `npm run dev` (oczekiwane: działa, ten sam mechanizm co istniejące sekrety); `npm run preview` tylko jako fallback, jeśli `npm run dev` zawiedzie."
- **Decyzja**: NAPRAWIONE (plan.md: „Kluczowe odkrycia", krok 1.8, „Weryfikacja ręczna" i „Kroki testowania ręcznego" zaktualizowane)
