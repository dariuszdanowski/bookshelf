# Move Book Between Shelves + Versioned Location History (S-07) — Implementation Plan

## Overview

Dodajemy akcję „Przenieś na półkę X" dla książki w katalogu. Przeniesienie nie jest prostą zmianą pola `shelf_id` — materializuje **wersjonowaną historię lokalizacji** (FR-038): na półce docelowej powstaje nowy wpis bieżący (`is_current=true`, pozycja „od lewej" = max+1), a dotychczasowy wpis zostaje oznaczony jako historyczny (`is_current=false`). Data zakupu, metadane ręczne i status przeczytania żyją na `books` i pozostają nietknięte. Realizacja: **dwa typowane zapisy w endpoincie** (INSERT nowego bieżącego → UPDATE starego na historyczny) — bez migracji, bez funkcji/rpc (typ `Database.Functions` jest pusty i nieregenerowalny w branchu — plan-review F1). Kolejność insert-first gwarantuje, że książka nigdy nie zostaje bez bieżącej półki (najwyżej chwilowo na dwóch przy rzadkim błędzie sieci — widoczna i naprawialna).

## Current State Analysis

- **`shelf_entries`** (`supabase/migrations/0001_initial_schema.sql:100-109`): kolumny `book_id`, `shelf_id`, `position_index`, `photo_id`, `detection_id`, `is_current bool default true`, `confirmed_at`. Indeksy na `book_id` i `shelf_id`.
- **Wersjonowanie nieobecne**: każdy istniejący wpis ma `is_current=true`; **żaden** kod nigdy nie ustawia `is_current=false`. Kolumny `is_current` / `confirmed_at` są przygotowanym substratem pod dokładnie ten slice. Wszystkie odczyty filtrują `is_current=true` (`shelves/[id]/books.ts:49-54`, `books/search.ts:50-56`, `shelves/index.ts:28-32`).
- **RLS już domknięte**: `0009_shelf_entries_rls_shelf_ownership.sql:10-22` waliduje **oba** FK (`book_id` i `shelf_id`) na INSERT i UPDATE — dodane defensywnie z komentarzem „domykamy zanim S-07 (move-book) przyjmie shelf_id z klienta". **Nie trzeba zmieniać RLS.** (lessons.md § „RLS na join-tabeli: waliduj OBA FK".)
- **Pozycja „od lewej"**: wzorzec max+1 wśród `is_current=true` (`confirm.ts:114-124`, `books/index.ts:105-113`).
- **`is_read`** na `books` (`0008_catalog_read_and_telemetry.sql:8`) — niezależne od `shelf_entries`, więc przeniesienie go zachowuje automatycznie. Tak samo `purchase_date` (`0010`) i metadane ręczne.
- **UI**: `BookCard.tsx` (per-book akcja `onToggleRead`, wzorzec optimistic update + rollback) używany przez `ShelfBooksIsland` (widok półki) i `CatalogSearchIsland` (`/library`). `CatalogSearchIsland` już pobiera `GET /api/shelves` do chipów filtra. `ShelfBooksIsland` listy półek jeszcze nie pobiera.
- **Wzorzec endpointu mutującego**: `detections/[id]/confirm.ts` — auth 401 → `parseUuidParam` 404 → Zod 400 → select RLS-scoped 404 → mutacja → mapowanie SQLSTATE → envelope `apiResponse`/`apiError`. `export const prerender = false`.
- **Funkcje Postgres jako defense-in-depth** to ustalony wzorzec repo: `handle_new_user`, `prevent_zakupione_delete/rename`, `books_search_text` (IMMUTABLE helper z 0011 po lekcji o generated columns).

## Desired End State

Użytkownik na `/library` (oraz na widoku półki) widzi przy każdej książce kontrolkę „Przenieś na półkę…". Po wybraniu półki docelowej książka znika z dotychczasowej półki i pojawia się na docelowej (na końcu, „od lewej"); status przeczytania, data zakupu i metadane są zachowane. W bazie powstaje rekord historyczny poprzedniej lokalizacji. Weryfikacja: po przeniesieniu `GET /api/shelves/[stara]/books` nie zawiera książki, `GET /api/shelves/[nowa]/books` zawiera ją na ostatniej pozycji; w `shelf_entries` istnieją ≥2 wiersze dla tej książki, dokładnie jeden `is_current=true`.

### Key Discoveries:
- RLS oba-FK gotowe (`0009...sql:10-22`) — endpoint może przyjąć `shelf_id` z klienta bez nowej polityki.
- Substrat wersjonowania (`is_current`/`confirmed_at`) już w schemacie — slice tylko go uruchamia.
- Optimistic-update + rollback wzorzec do skopiowania z `ShelfBooksIsland.tsx:42-65`.
- FR-029 „dokładnie jedna bieżąca półka" pozostaje egzekwowane app-level (status quo — dziś też brak constraintu DB). Świadomie nie dodajemy partial unique index: kolejność insert-first chwilowo łamałaby unikalność, a `Database.Functions` jest puste → rpc/funkcja nieregenerowalna w branchu (plan-review F1).
- Brak migracji w tym slice — kolumny `is_current`/`confirmed_at` już istnieją; cała zmiana to kod aplikacyjny + UI.

## What We're NOT Doing

- **Widok historii lokalizacji w UI** (timeline „gdzie była") — materializujemy dane historyczne (drogie do dorobienia wstecz, tanie teraz — risk note roadmapy), ale ekran prezentujący historię to osobny follow-up micro-slice. MVP pokazuje wyłącznie bieżącą lokalizację.
- **Bulk move** (przenoszenie wielu książek naraz) — pojedyncza książka per akcja.
- **Drag-and-drop** między półkami — kontrolka select wystarcza.
- **Zmiana pozycji w obrębie tej samej półki** (reorder) — poza zakresem; przeniesienie zawsze ląduje na końcu półki docelowej.
- **Przenoszenie NA „Zakupione" jako specjalny przypadek** — „Zakupione" to zwykła półka docelowa; bez dodatkowej logiki (data zakupu już jest na książce).

## Implementation Approach

Dwie fazy: (1) warstwa danych — Zod, endpoint `POST /api/books/[id]/move` z dwoma typowanymi zapisami, testy jednostkowe; (2) UI — kontrolka wyboru półki w `BookCard`, podpięcie w obu wyspach (optimistic + rollback), E2E. **Brak migracji** — kolumny wersjonowania już istnieją.

Endpoint robi RLS-scoped pre-selecty (czytelne 404), liczy `max+1` na półce docelowej, po czym **INSERT nowego bieżącego → UPDATE starego na historyczny**. Bez rpc/funkcji (typ `Database.Functions` pusty, nieregenerowalny w branchu). Non-atomowość zaakceptowana (zgodna z istniejącym `confirm.ts`); kolejność insert-first → książka nigdy nie znika.

## Critical Implementation Details

- **Kolejność zapisów (insert-first)**: najpierw `INSERT` nowego wpisu (`is_current=true`, `max+1` na docelowej), dopiero potem `UPDATE` starego wpisu na `is_current=false`. Gwarantuje, że przy błędzie między zapisami książka jest co najwyżej na dwóch półkach (widoczna, naprawialna), nigdy bez bieżącej. **Nie wolno** dodawać partial unique index `(book_id) WHERE is_current` — złamałby tę kolejność.
- **Pre-select bieżącego wpisu**: endpoint musi pobrać dotychczasowy bieżący wpis (`shelf_entries` where `book_id`+`is_current`) by (a) złapać „już na tej półce" → 409, (b) mieć `id` do UPDATE-historycznego. Brak bieżącego wpisu → 409/404 (książka bez lokalizacji — stan nienormalny).

## Phase 1: Warstwa danych — endpoint + walidacja

### Overview
Endpoint API z walidacją, RLS-scoped pre-selectami, dwoma zapisami (historia) i mapowaniem błędów. Bez migracji.

### Changes Required:

#### 1. Zod schema przeniesienia

**File**: `src/lib/books/schema.ts`

**Intent**: Walidacja body endpointu move.

**Contract**: `MoveBookSchema = z.object({ shelf_id: z.string().uuid() }).strict()` + `type MoveBookInput = z.infer<...>`. Zgodnie z istniejącym stylem `UpdateBookReadSchema`.

#### 2. Endpoint move

**File**: `src/pages/api/books/[id]/move.ts`

**Intent**: Przyjąć `shelf_id` docelowy, zweryfikować ownership obu zasobów (czytelne 404), przenieść książkę dwoma zapisami zachowując historię, zwrócić nową lokalizację.

**Contract**: `POST`, `export const prerender = false`. Sekwencja: 401 gdy `!locals.user`; `parseUuidParam(params.id)` → 404; parse JSON → 400; `MoveBookSchema.safeParse` → 400 z `z.flattenError`; RLS-scoped `select` książki → 404 gdy brak; RLS-scoped `select` półki docelowej → 404 gdy brak; RLS-scoped `select` bieżącego wpisu (`shelf_entries` where `book_id`+`is_current=true`) → jeśli brak → 409 `CONFLICT` („Książka nie ma bieżącej lokalizacji."), jeśli jego `shelf_id === target` → 409 `CONFLICT` („Książka już jest na tej półce."); policz `max(position_index)+1` wśród `is_current=true` na docelowej (wzorzec `confirm.ts:113-125`); **INSERT** nowego wpisu (`book_id`, `shelf_id=target`, `position_index`, `is_current=true`, `photo_id=null`, `detection_id=null`) — błąd → 500; **UPDATE** starego wpisu `id` na `is_current=false` — błąd → 500 (loguj, ale nowy wpis już istnieje; książka widoczna na obu — naprawialne). Mapowanie błędów Supabase: `console.error` z whitelist (`code`/`message`, nigdy raw err — lessons.md), `err instanceof Error ? err.message : String(err)`. Sukces: `apiResponse({ data: { book_id, shelf_id } })`.

#### 3. Testy jednostkowe endpointu

**File**: `tests/unit/pages/api/books/move.test.ts`

**Intent**: Pokryć ścieżki kontraktu.

**Contract**: Wzorzec z `tests/unit/pages/api/shelves/id.test.ts` (mock łańcuchów `from(...).select/insert/update(...)`). Mock musi rozróżniać kolejne wywołania `from('books')` / `from('shelves')` / `from('shelf_entries')` (select bieżącego, max-position, insert, update). Przypadki: 401 (brak usera), 404 (zły UUID), 400 (brak/niepoprawny `shelf_id` w body), 404 (książka nie znaleziona/cudza), 404 (półka docelowa nie znaleziona/cudza), 409 (brak bieżącego wpisu), 409 (cel == bieżąca półka), 500 (INSERT nowego wpisu pada), 200 (happy path — INSERT na docelowej + UPDATE starego na `is_current=false`, envelope `{ data: { book_id, shelf_id } }`).

### Success Criteria:

#### Automated Verification:
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test` (nowy plik move.test.ts zielony, reszta bez regresji)

#### Manual Verification:
- (brak — Phase 1 jest czysto kodowa, bez migracji; weryfikacja end-to-end w Phase 2 manual + E2E).

**Implementation Note**: Po Phase 1 i zielonych automatach — przejdź do Phase 2 (brak osobnego gatu manualnego, bo brak migracji/DB-side effektów do obejrzenia).

---

## Phase 2: UI — kontrolka przeniesienia + podpięcie wysp

### Overview
Kontrolka wyboru półki docelowej w `BookCard`, podpięta w widoku półki i `/library`, z optimistic update i rollback. E2E na ścieżce ręczny zakup → przenieś.

### Changes Required:

#### 1. Kontrolka przeniesienia w BookCard

**File**: `src/components/BookCard.tsx`

**Intent**: Renderować picker półki docelowej obok toggle „przeczytana", gdy komponent dostanie listę półek i handler.

**Contract**: Nowe opcjonalne propsy: `shelves?: ShelfDTO[]`, `currentShelfId?: string`, `onMove?: (bookId: string, targetShelfId: string) => void`. Gdy `shelves` i `onMove` podane: render natywnego `<select>` (placeholder „Przenieś na półkę…", opcje = półki bez `currentShelfId`) z `data-testid={\`move-book-${book.id}\`}`; `onChange` woła `onMove(book.id, value)` i resetuje select do placeholdera. Gdy brak propsów — kontrolka się nie renderuje (zero regresji w miejscach bez move). Etykiety polskie w curly-brace form (lessons.md § JSX polish quotes).

#### 2. Podpięcie w widoku półki

**File**: `src/components/ShelfBooksIsland.tsx`

**Intent**: Pobrać listę półek i obsłużyć przeniesienie z usunięciem książki z bieżącego widoku.

**Contract**: `useEffect` fetch `GET /api/shelves` → `shelves` state (wzorzec z `CatalogSearchIsland.tsx:34-45`). `handleMove(bookId, targetShelfId)`: optimistic usuń książkę z listy; `POST /api/books/${bookId}/move` z `{ shelf_id: targetShelfId }`; rollback (przywróć książkę) gdy `!res.ok` lub network error. Przekazać `shelves`, `currentShelfId={shelfId}`, `onMove` do `BookCard`.

#### 3. Podpięcie w katalogu

**File**: `src/components/CatalogSearchIsland.tsx`

**Intent**: Obsłużyć przeniesienie z aktualizacją nazwy/półki w wynikach.

**Contract**: `shelves` już pobrane. `handleMove(bookId, targetShelfId)`: optimistic ustaw `shelf_id`/`shelf_name` książki na docelowe; `POST /api/books/${bookId}/move`; rollback do poprzednich wartości gdy błąd. Przekazać `shelves`, `currentShelfId={book.shelf_id}`, `onMove` do `BookCard` w mapie wyników.

#### 4. E2E przeniesienia

**File**: `tests/e2e/move-book.spec.ts`

**Intent**: Golden path bez vision: ręczny zakup → przeniesienie → weryfikacja nowej lokalizacji.

**Contract**: Wykorzystać współdzieloną sesję (storageState). Utworzyć półkę docelową (lub użyć istniejącej), dodać książkę ręcznie przez Flow B (S-06, bez vision), przejść do `/library`, użyć `move-book-${id}` select → wybrać półkę docelową, asercja: książka pokazuje nową nazwę półki / pojawia się na widoku półki docelowej i znika z poprzedniej. Bez `page.route` na vision (ścieżka ręczna nie woła LLM). Jeśli seeding książki w E2E okaże się zbyt kruchy — odnotować i oprzeć asercję o minimalny stan, ale E2E pozostaje first-class (CLAUDE.md).

### Success Criteria:

#### Automated Verification:
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test`
- E2E: `npx playwright test move-book` (zielony lokalnie / w CI z lokalną Supabase)

#### Manual Verification:
- Na `/library`: wybór półki w pickerze przenosi książkę; po odświeżeniu jest na nowej półce, status przeczytania i data zakupu zachowane.
- Na widoku półki: przeniesiona książka znika; pojawia się na końcu („od lewej") półki docelowej.
- Przeniesienie z „Zakupione" na zwykłą półkę działa tak samo.

**Implementation Note**: Po Phase 2 i zielonych automatach — pauza na manualne potwierdzenie (przeglądarka) przed archiwizacją.

---

## Testing Strategy

### Unit Tests:
- Endpoint move: 401 / 404 (uuid, książka, półka) / 400 (zod) / 409 (brak bieżącego, cel==bieżąca) / 500 (INSERT pada) / 200 happy (INSERT + UPDATE-historyczny).

### Integration Tests:
- Pominięte w branchu (DB mockowana — lessons.md). Brak migracji w tym slice → brak `db push`; realna walidacja przez E2E (lokalna Supabase w CI) + manual.

### Manual Testing Steps:
1. UI: przenieś książkę z `/library`, odśwież, potwierdź nową półkę + zachowany `is_read`/`purchase_date`.
2. Widok półki: przeniesiona książka znika z bieżącej, pojawia się na końcu docelowej.
3. Przenieś z „Zakupione" → zwykła półka.
4. Spróbuj przenieść na tę samą półkę (opcja wykluczona w UI; przez API → 409).
5. (Opcjonalnie, lokalna Supabase) `select count(*) from shelf_entries where book_id=… ` → ≥2 wiersze, dokładnie jeden `is_current=true`.

## Performance Considerations

Pojedyncza książka, dwa zapisy + jeden `max()` z indeksu `shelf_entries_shelf_id_idx` — pomijalne.

## Migration Notes

Brak migracji w tym slice — kolumny `is_current`/`confirmed_at` istnieją od 0001; RLS oba-FK od 0009. `database.types.ts` bez zmian (brak nowych obiektów DB).

## References

- Roadmap S-07: `context/foundation/roadmap.md`
- lessons.md § „RLS na join-tabeli: waliduj OBA FK", § „Branch per change", § „Server-side error logging", § „JSX polish quotes"
- Wzorzec endpointu: `src/pages/api/detections/[id]/confirm.ts`, `src/pages/api/shelves/[id].ts`
- Pozycja max+1: `src/lib/books/confirm.ts:113-125`
- Optimistic update: `src/components/ShelfBooksIsland.tsx:42-65`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Warstwa danych — endpoint + walidacja

#### Automated
- [x] 1.1 Typecheck przechodzi: `npm run typecheck` — b5b4132
- [x] 1.2 Lint przechodzi: `npm run lint` — b5b4132
- [x] 1.3 Unit przechodzą (move.test.ts zielony, brak regresji): `npm run test` — b5b4132

### Phase 2: UI — kontrolka przeniesienia + podpięcie wysp

#### Automated
- [x] 2.1 Typecheck przechodzi: `npm run typecheck`
- [x] 2.2 Lint przechodzi: `npm run lint`
- [x] 2.3 Unit przechodzą: `npm run test`
- [x] 2.4 E2E przechodzi: `npx playwright test move-book`

#### Manual
- [ ] 2.5 `/library`: picker przenosi książkę; po odświeżeniu nowa półka, zachowany is_read/purchase_date
- [ ] 2.6 Widok półki: książka znika z bieżącej, pojawia się na końcu docelowej
- [ ] 2.7 Przeniesienie z „Zakupione" → zwykła półka działa
