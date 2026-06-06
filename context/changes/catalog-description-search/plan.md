# S-17 Catalog Description Search — Implementation Plan

## Overview

Domknięcie FR-032 (ostatni otwarty kawałek PRD MVP): pełnotekstowa wyszukiwarka katalogu obejmuje „krótki opis z publicznej bazy". Opis jest capture'owany z Google Books przy matchingu, persystowany w `book_candidates` i `books`, propagowany przez wszystkie ścieżki tworzenia/aktualizacji książki i włączony do GENERATED kolumny `search_text`, po której szuka `GET /api/books/search`.

## Current State Analysis

Świadome cięcie z S-08 (archive `2026-05-29-catalog-search-and-filters/plan.md` §Critical Details): opis NIE jest persystowany nigdzie w łańcuchu. Zmapowane luki (research 2026-06-06):

- **Klienci** — `src/lib/books/googleBooks.ts:9–20` (`VolumeInfoSchema`) nie zawiera `description`, mimo że Google Books API zwraca je w tej samej odpowiedzi (`volumeInfo.description`). `openLibrary.ts` (search API nie zwraca opisów w docs — wymagałby drugiego requestu `/works/{key}` per kandydat). `nationalLibrary.ts:121–122` — BN nie dostarcza opisów.
- **Typy** — `src/lib/books/schema.ts:8–18` (`BookCandidate`), `schema.ts:195–205` (`IdentifyCandidateShape`), `src/lib/books/confirm.ts:6–18` (`ConfirmBookInput`) — bez pola.
- **DB** — `book_candidates` i `books` (migracja `0001`) bez kolumny `description`.
- **search_text** — `0011_books_search_and_color.sql:14–28`: IMMUTABLE helper `books_search_text(p_title, p_authors, p_publisher)` + `GENERATED ALWAYS ... STORED`; 3 parametry, bez opisu. Endpoint `search.ts:96–100` robi escaped `ILIKE` na `search_text`.
- **Ścieżki INSERT/UPDATE books** — confirm (`confirm.ts:87–99`), confirm-batch, `POST /api/books` (`books/index.ts:95–112`), `identify.ts:85–96` — żadna nie przenosi opisu (bo go nie ma).

Najwyższa migracja na main: `0018_book_user_cover.sql` (zweryfikować ponownie przy implementacji — lesson `lessons.md:109–114`).

## Desired End State

Użytkownik wpisuje w `/library` frazę występującą tylko w opisie książki (np. motyw fabularny) i znajduje książkę, której tytuł/autor/wydawca frazy nie zawierają. Nowo potwierdzane książki (z propozycji, z rematch/refine, z kandydata w BookModal) mają zapisany opis z Google Books; istniejące książki zyskują opis przy ręcznym „Wyszukaj po danych" w trybie edit BookModal (per-book refresh przez `PATCH /api/books/[id]`).

Weryfikacja: test integracyjny na realnej DB dowodzi, że `search_text` zawiera opis; testy unit dowodzą capture + propagacji; pełna suita E2E bez regresji.

### Key Discoveries:

- `search_text` to GENERATED STORED na IMMUTABLE helperze — zmiana wyrażenia wymaga **DROP COLUMN → DROP FUNCTION → CREATE FUNCTION (4 parametry) → ADD COLUMN**; STORED przelicza wszystkie wiersze przy ADD (darmowy „backfill" search_text dla istniejących danych).
- Google Books zwraca `description` w tej samej odpowiedzi search — capture jest zero-kosztowy (żadnych dodatkowych requestów).
- **`/api/books/[id]/identify` jest martwy z poziomu UI** (plan-review F1): po refaktorze unified-book-modal żaden komponent go nie woła (tylko unit test). Realny flow „Wyszukaj po danych" = `BookModal` → `POST /api/books/candidates` (read-only) → `handleCandidateSelect` (`BookModal.tsx:404–418`, enumeruje 6 pól) → `POST /api/books` (add) lub `PATCH /api/books/[id]` (edit). **Ręczny per-book backfill = tryb edit BookModal**, nie identify.
- `database.types.ts` regeneruje się tylko z żywej DB (lesson `lessons.md:95–100`) — nowe kolumny dopisać ręcznie w branchu (precedens wcześniejszych slice'ów), pełna regeneracja post-merge.

## What We're NOT Doing

- **Bulk re-fetch backfill** istniejących książek (N wywołań Google Books, rate limit; per-book refresh przez identify wystarcza) — ⚠ świadoma adaptacja vs literalny Outcome roadmapy („backfill (re-fetch)"); odnotowana w change.md, Outcome do korekty przy archive.
- **Ekspozycja opisu w UI** (wyświetlanie w BookModal/wynikach, edycja ręczna) — follow-up; ten slice działa „w tle" wyszukiwarki.
- **Capture z OpenLibrary** (drugi request per kandydat) i **BN** (brak danych w źródle) — `description: null`.
- **tsvector/GIN** — escaped `ILIKE` na ~1000 rekordów/user spełnia NFR p95 < 1 s (wzorzec S-08); nie zmieniamy mechaniki wyszukiwania.

## Implementation Approach

Dwie fazy: (1) substrat DB — migracja kolumn + nowa funkcja search_text + dowód integracyjny na realnej bazie (CI `e2e` job waliduje migrację przez `supabase start`); (2) capture w kliencie GB + propagacja przez wszystkie ścieżki zapisu + testy unit. Kolejność DB-first: faza 2 typowana na kolumnach z fazy 1.

## Critical Implementation Details

- **Kolejność w migracji**: `search_text` zależy od funkcji — `ALTER TABLE books DROP COLUMN search_text` MUSI poprzedzić `DROP FUNCTION books_search_text(text, text[], text)`; nowa funkcja musi pozostać `IMMUTABLE` (42P17 — lesson z 0011: `array_to_string` jest STABLE, stąd helper).
- **Truncation przy capture, nie w DB**: Google potrafi zwrócić wielotysięczne opisy; przycinamy do 2000 znaków w `mapItem()` (STORED search_text rośnie per wiersz; „krótki opis" z PRD). Brak CHECK w DB — koszt bez zysku.
- **`database.types.ts`**: dopisać `description: string | null` do `Row`/`Insert`/`Update` obu tabel + 4. parametr w sygnaturze `books_search_text` ręcznie (plik jest commitowany; pełny regen tylko z żywej DB post-merge).
- **Mocki E2E**: DTO kandydatów/książek rozszerza się o pole nullable — istniejące mocki `page.route` pozostają poprawne (pole opcjonalne w odpowiedziach), ale jeśli któryś Zod parsuje odpowiedź strict — dopisać pole w fixture.
- **Blast radius REQUIRED pola** (plan-review F5): `BookCandidate.description: string | null` łamie typecheck w 5 miejscach — 3 mappery klientów (planowane), literal w `src/pages/api/photos/[id]/match.ts:411–422` (parametr `checkCatalogDuplicate`) i typowana fixture `tests/unit/lib/matching/dedupe.test.ts:5–19` (`makeCandidate`). Untyped fixtures (match/refine/rematch/candidates/identify testy, mocki e2e) kompilują się bez zmian — aktualizować tylko tam, gdzie test dotyka opisu.
- **Integration test a środowisko** (plan-review F4): `vitest.integration.config.ts` czyta `.dev.vars` — u developera wskazuje REMOTE PROD: pre-merge kolumn 0019 tam nie ma (test by padł), a testy tworzą realnych userów przez admin API (zombie przy przerwaniu). Weryfikacja kryterium 1.2 odbywa się w **CI** (efemeryczna Supabase z migracją) lub na lokalnym stacku WSL; nowy test trzyma pattern `describe.skip` bez env + timestamp suffix + cleanup w `afterAll`.

## Phase 1: Substrat DB — kolumny description + search_text v2 + dowód integracyjny

### Overview

Migracja `0019` dodaje `description` do `book_candidates` i `books`, przebudowuje `search_text` na 4-parametrową funkcję; test integracyjny na realnej lokalnej Supabase dowodzi, że opis jest przeszukiwalny.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/0019_books_description_search.sql`

**Intent**: Dodać nullable `description text` do obu tabel i włączyć opis do `search_text`, zachowując IMMUTABLE-helper pattern z 0011.

**Contract**: `book_candidates.description text NULL`; `books.description text NULL`; `books_search_text(p_title text, p_authors text[], p_publisher text, p_description text) returns text immutable` — konkatenacja lowercase jak w 0011 + `coalesce(p_description,'')`; `books.search_text` GENERATED ALWAYS STORED na nowej funkcji. Kolejność: ADD COLUMNs → DROP COLUMN search_text → DROP FUNCTION (stara sygnatura 3-arg) → CREATE FUNCTION 4-arg → ADD COLUMN search_text. Komentarz w migracji wyjaśniający DROP/ADD (GENERATED nie da się ALTER-ować).

#### 2. Typy DB

**File**: `src/lib/db/database.types.ts`

**Intent**: Ręczne dopisanie nowych pól (lesson: regen tylko z żywej DB) zgodnie z istniejącym stylem pliku.

**Contract**: `books.Row/Insert/Update` i `book_candidates.Row/Insert/Update` + `description: string | null`; `Functions.books_search_text.Args` + `p_description: string`.

#### 3. Test integracyjny

**File**: `tests/integration/books-description-search.test.ts`

**Intent**: Dowód na realnej DB (jedyna warstwa dowodząca GENERATED column — unit mock byłby tautologią), wzorzec z `tests/integration/` (signup → RLS-scoped klient).

**Contract**: INSERT książki z `description` zawierającym unikalną frazę → SELECT z `ilike('search_text', '%fraza%')` zwraca rekord; książka bez opisu nadal znajdowana po tytule (regresja 0011); cleanup przez delete usera.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto na świeżej bazie: `npx supabase db reset` (lokalnie w WSL) / job `e2e` w CI (`supabase start` = replay wszystkich migracji)
- Test integracyjny zielony: `npm run test:integration` — **w CI lub na lokalnym stacku WSL** (NIE lokalnie przy `.dev.vars`=remote prod: brak kolumn pre-merge + mutacja prod auth — zob. Critical Implementation Details)
- Typecheck przechodzi: `npm run typecheck`
- Pełna suita unit bez regresji: `npm run test`

#### Manual Verification:

- (post-merge, user-only) Studio prod: kolumny `description` obecne, `search_text` istniejących książek przeliczony (niepusty)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Capture w kliencie Google Books + propagacja przez ścieżki zapisu

### Overview

Opis płynie: Google Books → `BookCandidate` → persist w `book_candidates` (pipeline match) → confirm/confirm-batch/identify/manualny POST → `books.description` → (automatycznie) `search_text`.

### Changes Required:

#### 1. Klient Google Books

**File**: `src/lib/books/googleBooks.ts`

**Intent**: Capture `volumeInfo.description` z odpowiedzi search (zero dodatkowych requestów) z przycięciem do 2000 znaków.

**Contract**: `VolumeInfoSchema` + `description: z.string().optional()`; `mapItem()` → `description: truncate(volumeInfo.description, 2000) ?? null`. Helper truncation lokalny (nie ma współdzielonego).

#### 2. Pozostali klienci + typ kandydata

**File**: `src/lib/books/openLibrary.ts`, `src/lib/books/nationalLibrary.ts`, `src/lib/books/schema.ts`

**Intent**: Rozszerzyć `BookCandidate` o `description: string | null`; OL i BN zwracają `null` (świadome cięcie — zob. What We're NOT Doing).

**Contract**: `BookCandidate.description: string | null` (pole wymagane w typie, nullable w wartości — wymusza świadomą decyzję w każdym mapperze); `IdentifyCandidateShape` + `description` nullable optional.

#### 3. Persist kandydatów — WSZYSTKIE trzy miejsca INSERT (plan-review F2)

**File**: `src/pages/api/photos/[id]/match.ts` (rows `:451–466`, batch insert `:502–505`), `src/pages/api/detections/[id]/rematch.ts` (`:156–174`), `src/pages/api/detections/[id]/refine.ts` (`:333–349`)

**Intent**: Dopisać `description: c.description` do KAŻDEGO z trzech enumerowanych insertów kandydatów (zero spreadów w kodzie — nic nie przepłynie samo); inaczej opis = null na ścieżkach rematch/refine.

**Contract**: trzy enumerowane mapy insertu + pole `description`; enumerowany `.select(...)` returning w `rematch.ts:174` + kolumna.

#### 4. Enumerowane SELECTy kandydatów + ścieżki tworzenia/aktualizacji książki (plan-review F1+F2)

**File**: `src/pages/api/detections/[id]/confirm.ts` (select `:89–94`), `src/pages/api/photos/[id]/confirm-batch.ts` (select `:90–94`), `src/pages/api/detections/[id]/correct.ts` (select `:99–106`), `src/pages/api/photos/[id]/match.ts` (re-read `:248`), `src/lib/books/confirm.ts`, `src/pages/api/books/index.ts`, `src/pages/api/books/[id].ts` (PATCH), `src/pages/api/books/[id]/identify.ts`, `src/lib/books/schema.ts`, `src/components/BookModal.tsx` (+ `src/components/book/BookFields.tsx` jeśli stan tam żyje)

**Intent**: (a) rozszerzyć każdy enumerowany SELECT z `book_candidates` o `description`; (b) propagacja do `books` przez REALNE ścieżki: confirm/confirm-batch (`ConfirmBookInput` + INSERT) oraz **BookModal w obu trybach** — add (`POST /api/books`) i edit (`PATCH /api/books/[id]`); tryb edit to ręczny per-book backfill starych książek. `identify.ts` (apply) dostaje pole dla kompletności (endpoint legacy — bez klienta UI; adnotacja w kodzie).

**Contract**: `ConfirmBookInput + description: string | null` i INSERT w `confirm.ts`; `AddPurchaseSchema` (`.strict()` — pole MUSI być jawnie dodane, inaczej 400) + `description: z.string().max(2000).nullable().optional()`; analogicznie schema PATCH (`UpdateBookSchema` lub odpowiednik w `books/schema.ts`) + UPDATE w `books/[id].ts`; `IdentifyCandidateShape` + pole i UPDATE w `identify.ts` (1 linia, legacy); typ `SearchCandidate` (`BookModal.tsx:156–167`) + `description`, `handleCandidateSelect` zapisuje opis do UKRYTEGO stanu (nie do `BookFieldValues` — bez kontrolki UI), payload POST i PATCH dołącza go tylko gdy pochodzi z wybranego kandydata.

#### 5. Testy unit

**File**: `tests/unit/lib/books/googleBooks.test.ts` (lub istniejący plik klienta), `tests/unit/...confirm*`, `tests/unit/pages/api/books/*`

**Intent**: Dowód capture (z truncation i bez opisu), propagacji confirm→INSERT i identify→UPDATE, walidacji `AddPurchaseSchema` (2000 max). Wzorce mocków jak w istniejących testach (chainable mock z `search.test.ts:29–36`).

**Contract**: min. 5 nowych przypadków: GB mapuje opis / truncate >2000 / brak opisu → null; confirm przenosi description do insertu; identify apply przenosi do update; schema odrzuca >2000.

### Success Criteria:

#### Automated Verification:

- Lint + typecheck przechodzą: `npm run lint`, `npm run typecheck`
- Pełna suita unit zielona (w tym nowe testy): `npm run test`
- Test integracyjny nadal zielony: `npm run test:integration`
- Pełne E2E bez regresji: `npx playwright test`

#### Manual Verification:

- (post-merge, user-only) realny pipeline: zdjęcie → confirm propozycji z GB → książka ma opis w Studio → fraza z opisu znajduje książkę w `/library`
- (post-merge, user-only) „Wyszukaj po danych" w trybie edit BookModal na starej książce bez opisu → opis uzupełniony po zapisie (PATCH)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Capture GB: opis obecny / dłuższy niż 2000 (truncate) / nieobecny (null)
- Propagacja: `confirmDetectionToCatalog` INSERT z description; `identify` apply UPDATE z description
- `AddPurchaseSchema`: akceptuje null/brak, odrzuca >2000

### Integration Tests:

- Realna DB: `search_text` zawiera frazę z opisu (Phase 1) — jedyny wiarygodny dowód GENERATED; auto-walidacja migracji w CI (`supabase start`)

### Manual Testing Steps:

1. (post-merge) Upload zdjęcia → akceptacja propozycji → opis widoczny w Studio na rekordzie books
2. Wyszukanie frazy występującej tylko w opisie → książka w wynikach `/library`
3. „Wyszukaj po danych" + zapis (edit BookModal) na książce sprzed migracji → opis uzupełniony, fraza znajdowalna

## Performance Considerations

`search_text` rośnie o ≤2000 znaków/wiersz — ILIKE na ~1000 rekordów/user pozostaje w NFR p95 < 1 s (wzorzec S-08, bez indeksu full-text). ADD COLUMN GENERATED STORED przepisuje tabelę `books` przy migracji — tabele per-user są małe, akceptowalne.

## Migration Notes

Migracja idempotentnie aplikowana przez `deploy.yml` post-merge (migrate-first przed deployem Workera). Walidacja pre-merge: job `e2e` w CI robi `supabase start` (pełny replay 0001–0019). Istniejące książki: `description = NULL` (szukanie po tytule/autorze/wydawcy bez zmian), `search_text` przeliczony automatycznie przy ADD COLUMN.

## References

- Roadmapa: `context/foundation/roadmap.md` → S-17 (+ świadome cięcie w S-08 `## Done`)
- Wzorzec migracji GENERATED + IMMUTABLE helper: `supabase/migrations/0011_books_search_and_color.sql:14–28`
- Świadome cięcie opisu w S-08: `context/archive/2026-05-29-catalog-search-and-filters/plan.md` §Critical Details + `reviews/impl-review.md` F4
- Lessons: `context/foundation/lessons.md` (migracje numeracja na main, regen typów z żywej DB, generated artifacts w lint ignores)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Substrat DB — kolumny description + search_text v2 + dowód integracyjny

#### Automated

- [x] 1.1 Migracja aplikuje się czysto (`npx supabase db reset` / CI `supabase start`) — 75e6876
- [x] 1.2 Test integracyjny zielony (`npm run test:integration`) — 75e6876
- [x] 1.3 Typecheck przechodzi (`npm run typecheck`) — 75e6876
- [x] 1.4 Pełna suita unit bez regresji (`npm run test`) — 75e6876

#### Manual

- [ ] 1.5 (post-merge, user-only) Studio prod: kolumny obecne, search_text przeliczony

### Phase 2: Capture w kliencie Google Books + propagacja przez ścieżki zapisu

#### Automated

- [x] 2.1 Lint + typecheck przechodzą (`npm run lint`, `npm run typecheck`)
- [x] 2.2 Pełna suita unit zielona z nowymi testami (`npm run test`)
- [x] 2.3 Test integracyjny nadal zielony (`npm run test:integration`)
- [x] 2.4 Pełne E2E bez regresji (`npx playwright test`)

#### Manual

- [ ] 2.5 (post-merge, user-only) confirm z GB → opis w Studio → fraza z opisu znajduje książkę
- [ ] 2.6 (post-merge, user-only) „Wyszukaj po danych" w edit BookModal uzupełnia opis starej książki
