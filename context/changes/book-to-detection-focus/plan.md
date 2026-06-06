# S-37: Deep-link książka → review z fokusem na detekcji — Implementation Plan

## Overview

Z karty książki w katalogu (`/library`) i na widoku półki (`/shelves/[id]`) link „Źródłowe
zdjęcie" prowadzi dziś do `/photos/[photo_id]` bez wskazania, KTÓRA detekcja była źródłem
tej książki. Slice dodaje `detection_id` do books API i obsługę `?detection=<uuid>` na
stronie review: overlay fokusuje ramkę tej detekcji, lista scrolluje do jej pozycji.

## Current State Analysis

- **DB**: `shelf_entries.detection_id uuid REFERENCES detections(id) ON DELETE SET NULL`
  istnieje od `0001_initial_schema.sql:106`; `confirmDetectionToCatalog` zapisuje je
  ([src/lib/books/confirm.ts:137](src/lib/books/confirm.ts)).
- **API**: oba SELECT-y na `shelf_entries` pomijają `detection_id` —
  [src/pages/api/shelves/\[id\]/books.ts:51](src/pages/api/shelves/[id]/books.ts) i
  [src/pages/api/books/search.ts:52](src/pages/api/books/search.ts); DTO
  (`ShelfBookDTO`, `CatalogBookDTO` w [src/lib/books/schema.ts](src/lib/books/schema.ts))
  nie mają pola.
- **UI link (S-15)**: [src/components/BookCard.tsx:145-153](src/components/BookCard.tsx) —
  `href={/photos/${photo_id}}`, bez query.
- **Review (S-18/S-25)**: `DetectionReview` ma stan `focusedDetectionId`
  ([src/components/DetectionReview.tsx:1633](src/components/DetectionReview.tsx));
  `PhotoDetectionOverlay` przy focusie renderuje wyłącznie tę ramkę; scroll do pozycji
  listy działa przez `data-testid="detection-{row|tile|card}-{position_index}"`
  (`handleMarkerContextMenu`, DetectionReview.tsx:1830-1837). Strona
  [src/pages/photos/\[id\].astro](src/pages/photos/[id].astro) nie czyta query params.
- **`GET /api/photos/[id]`** zwraca detekcje z ich `id` — po stronie review żadna zmiana
  API nie jest potrzebna (match `?detection=` po `DetectionWithCandidatesDTO.id`).

## Desired End State

Link „Źródłowe zdjęcie" = `/photos/<photo_id>?detection=<detection_id>` (gdy detection_id
niepuste). Wejście z parametrem: overlay w trybie fokus (1 ramka), lista przescrollowana
do pozycji detekcji. Brak parametru / nieznane id / zniekształcony UUID → zachowanie
identyczne jak dziś (pełny widok, zero błędów).

### Key Discoveries:

- Cały mechanizm fokusu już istnieje (S-18) — slice to wyłącznie wiring danych + initial state.
- `parseUuidParam` z [src/lib/http/response.ts](src/lib/http/response.ts) nadaje się do
  walidacji query param w `.astro` (zwraca null dla śmieci → graceful).
- FK `ON DELETE SET NULL` gwarantuje, że po skasowaniu detekcji (re-process) link
  degraduje się do wersji bez query — bez wiszących referencji.
- **Potwierdzone detekcje renderują się w review**: `GET /api/photos/[id]` nie filtruje
  detekcji po statusie (filtr `succeeded` dotyczy vision_runs), a stan „zdecydowane"
  (`decidedIds`) jest sesyjny — deep-link do confirmed detection ma co fokusować.

## What We're NOT Doing

- Zero migracji DB (kolumna istnieje).
- Bez zmian w `GET /api/photos/[id]` (detection id już w payloadzie).
- Bez persystencji fokusu w URL przy klikaniu w review (stan lokalny jak dotąd) — tylko
  initial focus z query.
- Bez deep-linków z innych miejsc niż karta książki (np. historia lokalizacji) — osobny slice.

## Implementation Approach

Dwie fazy: (1) warstwa danych — `detection_id` przez oba endpointy + DTO + testy unit;
(2) warstwa UI — link z query, parsowanie param, initial focus + scroll w DetectionReview,
testy unit + E2E.

## Phase 1: detection_id w books API

### Overview

`shelf_entries.detection_id` przepływa do `ShelfBookDTO` i `CatalogBookDTO`.

### Changes Required:

#### 1. DTO schema

**File**: `src/lib/books/schema.ts`

**Intent**: dodać `detection_id` do obu DTO, żeby klienci (BookCard przez /library
i /shelves/[id]) mieli identyfikator detekcji źródłowej.

**Contract**: `ShelfBookDTO.detection_id: string | null` i
`CatalogBookDTO.detection_id: string | null` — nullable jak `photo_id` (ręczne wpisy
i stare rekordy mają NULL). Pole **wymagane** (nie optional) → fixtures w istniejących
testach komponentów wymagają dopisania pola: `tests/unit/components/BookCard.test.tsx`,
`ShelfBooksIsland.test.tsx`, `CatalogSearchIsland.test.tsx` (+ inne, które TS wskaże).

#### 2. GET /api/shelves/[id]/books

**File**: `src/pages/api/shelves/[id]/books.ts`

**Intent**: eksponować detection_id z aktualnego shelf_entry.

**Contract**: SELECT rozszerzony o `detection_id`; mapper przepisuje `row.detection_id`
do DTO. Wzorzec identyczny jak istniejące `photo_id`.

#### 3. GET /api/books/search

**File**: `src/pages/api/books/search.ts`

**Intent**: jw. dla katalogu.

**Contract**: SELECT + `EntryRow` + mapa `placement` + mapper rozszerzone o
`detection_id` (pattern `photo_id`).

#### 4. Testy unit endpointów

**File**: `tests/unit/pages/` (istniejące pliki testów obu endpointów)

**Intent**: asercja przepływu detection_id (wartość i null) w obu odpowiedziach.

**Contract**: rozszerzenie istniejących testów o pole w fixture + expect.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test` (rozszerzone testy obu endpointów zielone)

#### Manual Verification:

- (brak — warstwa danych w całości pokryta automatami)

---

## Phase 2: UI wiring — link, query param, initial focus

### Overview

BookCard linkuje z `?detection=`, strona review parsuje param i przekazuje do island,
DetectionReview ustawia initial focus + scroll po załadowaniu detekcji.

### Changes Required:

#### 1. BookCard link

**File**: `src/components/BookCard.tsx`

**Intent**: deep-link z identyfikatorem detekcji, gdy jest dostępny.

**Contract**: `href` = `/photos/{photo_id}?detection={detection_id}` gdy
`book.detection_id` truthy, inaczej dotychczasowe `/photos/{photo_id}`. Typ propsa
`book` pokrywa nowe pole z DTO (Phase 1).

#### 2. Strona review — parsowanie query

**File**: `src/pages/photos/[id].astro`

**Intent**: walidacja `?detection=` po stronie SSR i przekazanie do island.

**Contract**: `parseUuidParam(Astro.url.searchParams.get('detection') ?? undefined)` →
`initialFocusedDetectionId: string | null` jako prop `DetectionReview`. Zniekształcony
UUID → null (graceful, bez redirectu — strona renderuje się normalnie).

#### 3. DetectionReview — initial focus

**File**: `src/components/DetectionReview.tsx`

**Intent**: po załadowaniu detekcji, jeśli `initialFocusedDetectionId` wskazuje
istniejącą detekcję — ustawić fokus overlay i przescrollować listę do jej pozycji.

**Contract**: nowy opcjonalny prop `initialFocusedDetectionId?: string | null`.
Po fetchu (`setDetections`): jeżeli id ∈ loadedDetections → `setFocusedDetectionId(id)`
oraz scroll do `[data-testid="detection-{prefix}-{position_index}"]` (reużycie logiki
`handleMarkerContextMenu`, z uwzględnieniem aktywnego `viewMode`). Scroll po
wyrenderowaniu listy (effect obserwujący zakończenie loadingu, jednorazowy). Nieznane
id → no-op. Fokus ustawiony raz — późniejsze interakcje usera działają jak dotąd
(w tym `onClearFocus`).

#### 4. Testy unit komponentów

**File**: `tests/unit/components/` (istniejące pliki BookCard / DetectionReview)

**Intent**: (a) BookCard renderuje href z query gdy detection_id, bez query gdy null;
(b) DetectionReview z `initialFocusedDetectionId` ustawia fokus po fetchu; nieznane id
→ brak fokusu.

**Contract**: rozszerzenie istniejących suites (mock fetch jak w obecnych testach).

#### 5. E2E

**File**: `tests/e2e/book-to-detection-focus.spec.ts` (nowy)

**Intent**: golden path ryzyka — z karty książki przez deep-link do review z fokusem;
plus degradacja przy nieistniejącym detection id.

**Contract**: scenariusz 1: upload (mock vision) → confirm detekcji → karta książki ma
link z `?detection=` → klik → overlay w trybie fokus (`photo-overlay` widoczny, 1 marker)
+ wiersz listy w viewport; scenariusz 2: wejście na `/photos/[id]?detection=<obcy-uuid>`
→ pełny widok bez trybu fokus (wszystkie markery widoczne — business outcome, nie
asercja konsoli). Mock vision przez `page.route` (zero realnych wywołań LLM), wzorce
z `book-source-photo-link.spec.ts`.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test`
- E2E: `npm run test:e2e` (nowy spec + regresja book-source-photo-link, detection-list-views)

#### Manual Verification:

- Klik „Źródłowe zdjęcie" na realnej książce z kolekcji → ramka jej detekcji
  podświetlona, lista przescrollowana (user-only, Studio/przeglądarka)

---

## Testing Strategy

### Unit Tests:

- detection_id passthrough w obu endpointach (wartość + null)
- BookCard href z/bez query
- DetectionReview initial focus: znane id / nieznane id / brak propa

### Integration Tests:

- (brak nowych — RLS niezmienione, scope istniejących policy)

### Manual Testing Steps:

1. Otwórz `/library`, kliknij „Źródłowe zdjęcie" przy książce dodanej z detekcji
2. Sprawdź: overlay pokazuje 1 ramkę, lista przescrollowana do pozycji
3. Wyczyść fokus (przycisk overlay) → wracają wszystkie ramki

## Performance Considerations

Brak — jedno dodatkowe pole w istniejących SELECT-ach, zero nowych zapytań.

## Migration Notes

Zero migracji. Stare wpisy `shelf_entries` z `detection_id IS NULL` (oraz ręczne wpisy)
dostają link bez query — zachowanie sprzed slice'a.

## References

- Roadmapa: `context/foundation/roadmap.md` → S-37 (At a glance + Backlog Handoff)
- Mechanizm fokusu: `src/components/PhotoDetectionOverlay.tsx` (S-18), `src/components/DetectionReview.tsx:1830-1844`
- Wzorzec E2E: `tests/e2e/book-source-photo-link.spec.ts` (S-15)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: detection_id w books API

#### Automated

- [ ] 1.1 Typecheck: `npm run typecheck`
- [ ] 1.2 Lint: `npm run lint`
- [ ] 1.3 Unit: `npm run test`

### Phase 2: UI wiring — link, query param, initial focus

#### Automated

- [ ] 2.1 Typecheck: `npm run typecheck`
- [ ] 2.2 Lint: `npm run lint`
- [ ] 2.3 Unit: `npm run test`
- [ ] 2.4 E2E: `npm run test:e2e`

#### Manual

- [ ] 2.5 Deep-link na realnej kolekcji: fokus ramki + scroll listy (user-only)
