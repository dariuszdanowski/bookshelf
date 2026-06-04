# S-15 „Źródłowe zdjęcie" na karcie książki — Implementation Plan

## Overview

Karta książki (`BookCard`, renderowana identycznie na `/shelves/[id]` i `/library`) dostaje
link **„Źródłowe zdjęcie"** prowadzący do `/photos/[photo_id]` — strony review zdjęcia, z którego
książka została skatalogowana. `photo_id` pochodzi z aktywnego wpisu `shelf_entries`
(`is_current=true`). Gdy `photo_id` jest `NULL` — link się nie renderuje.

## Current State Analysis

- **Oba widoki dzielą jeden komponent** `src/components/BookCard.tsx` — `/shelves/[id]` przez
  `ShelfBooksIsland`, `/library` przez `CatalogSearchIsland`. Jedno miejsce wstawienia linku
  pokrywa oba widoki (spełnia twardy wymóg E1 „identyczne wszędzie" automatycznie).
- **`shelf_entries.photo_id`**: `uuid` **NULLABLE**, FK `ON DELETE SET NULL` — od migracji
  `0001_initial_schema.sql:105`. Usunięcie zdjęcia (S-29 DELETE) już ustawia `photo_id=NULL`.
  **Żadnej migracji nie trzeba.**
- **Oba endpointy filtrują `is_current=true`**, ale **żaden nie selectuje `photo_id`**:
  - `src/pages/api/shelves/[id]/books.ts:51` — `select('position_index, books(...)')`
  - `src/pages/api/books/search.ts:52` — `select('book_id, shelf_id, position_index, shelves(id, name)')`
- **DTO**: `ShelfBookDTO` (`src/lib/books/schema.ts:51-59`) nie ma `photo_id`; `CatalogBookDTO`
  (`:62-66`) dziedziczy z `ShelfBookDTO`. Dodanie pola do bazowego DTO pokrywa oba widoki.
- **`/photos/[id].astro`** istnieje (`src/pages/photos/[id].astro`), auth-guarded (middleware +
  page-level), RLS-scoped (RLS na `photos`), breadcrumbs już są, gracefully degraduje przy braku
  zdjęcia. Cel linku jest gotowy — nie tykamy strony review.
- **Istniejące linki do `/photos/`** (`PhotoListIsland`, `PhotoUploader`) używają `<a href={/photos/${id}}>`
  — ten sam wzorzec zastosujemy w `BookCard`.

### Key Discoveries:

- `shelf_entries.photo_id` `ON DELETE SET NULL` (`0001_initial_schema.sql:105`) — fundament całego
  slice'a; brak migracji.
- Po S-29 DELETE: `photo_id` → NULL **i** `detection_id` → NULL (kaskada detections z photos →
  `shelf_entries.detection_id` SET NULL, `0001:106`). **Dane nie odróżniają** „zdjęcie usunięte" od
  „wpis ręczny" — oba mają `photo_id=NULL`. Stąd jedyne poprawne zachowanie = **ukryj link** (patrz
  „What We're NOT Doing").
- `search.ts` używa mapy `placement` (`:74-81`) keyed po `book_id` — `photo_id` trzeba dorzucić do
  selecta, typu `EntryRow`, mapy i finalnego `result` (`:116-130`).
- `books.ts` mapuje wiersze `shelf_entries` 1:1 (`:65-85`) — `photo_id` to siostrzana kolumna obok
  `position_index`, dorzucana wprost do selecta i mapowania.

## Desired End State

Na `/shelves/[id]` i `/library` każda karta książki skatalogowanej ze zdjęcia pokazuje link
„Źródłowe zdjęcie"; kliknięcie otwiera `/photos/[photo_id]`. Książka dodana ręcznie (Flow B) lub
taka, której źródłowe zdjęcie usunięto, **nie** pokazuje linku — bez błędu, bez martwego linku.

Weryfikacja: `npm run typecheck` + `npm run test` (unit asercje na `photo_id` w odpowiedzi obu
endpointów) + `npm run test:e2e` (link obecny dla książki ze zdjęcia, nieobecny dla ręcznej,
znika po usunięciu zdjęcia) zielone.

## What We're NOT Doing

- **Brak migracji** — `photo_id` już istnieje i jest `SET NULL`.
- **Brak nowego endpointu** — rozszerzamy dwa istniejące selecty.
- **Brak komunikatu „zdjęcia już nie ma"** dla `photo_id=NULL`. Dane nie odróżniają usuniętego
  zdjęcia od wpisu ręcznego (oba `NULL`), więc każdy taki komunikat byłby mylący dla wpisów
  ręcznych. Ukrycie linku jest jedynym zachowaniem zgodnym z danymi. (Świadome rozstrzygnięcie
  napięcia S-15 „graceful ukrycie" ↔ D2 „info zdjęcia już nie ma" na korzyść ukrycia.)
- **Brak zmian w `/photos/[id].astro`** — strona review, breadcrumbs i guard są gotowe.
- **Brak nowego `BookCard` ani refaktoru układów** (to E1/S-34) — dokładamy jeden opcjonalny prop
  do istniejącej karty.

## Implementation Approach

Dwa cienkie etapy: (1) przewlec `photo_id` przez warstwę danych (DTO + dwa selecty + mapowania),
(2) wyrenderować warunkowy link w `BookCard`. Etap 2 zależy od 1. Każdy etap = atomowy commit.

---

## Phase 1: Przewleczenie `photo_id` przez API + DTO

### Overview

`photo_id` z aktywnego `shelf_entry` trafia do `ShelfBookDTO` (bazowy → dziedziczy `CatalogBookDTO`),
zasilany przez oba endpointy.

### Changes Required:

#### 1. DTO bazowy

**File**: `src/lib/books/schema.ts`

**Intent**: Dodać `photo_id` do `ShelfBookDTO`, żeby oba widoki (i `CatalogBookDTO` przez dziedziczenie)
niosły identyfikator źródłowego zdjęcia lub `null`.

**Contract**: `ShelfBookDTO` (`:51-59`) zyskuje pole `photo_id: string | null`. `CatalogBookDTO`
(`:62-66`) bez zmian (dziedziczy).

**Blast radius (pole WYMAGANE → oblewa istniejące testy, F1):** dodanie `photo_id` jako wymaganego
pola wymusza aktualizację konsumentów DTO w testach — zaktualizować w tej samej fazie:
- `tests/unit/pages/api/shelves/id-books.test.ts` — asercja kształtu odpowiedzi (dodać `photo_id`)
- `tests/unit/pages/api/books/search.test.ts` — asercja kształtu odpowiedzi (dodać `photo_id`)
- `tests/unit/components/BookCard.test.tsx` — fixture'y `book` (dodać `photo_id` do obiektów `ShelfBookDTO`)

#### 2. Endpoint widoku półki

**File**: `src/pages/api/shelves/[id]/books.ts`

**Intent**: Selectować `photo_id` z `shelf_entries` i przepisać do DTO.

**Contract**: select (`:51`) → `'position_index, photo_id, books(...)'`; inline typ wiersza i mapowanie
(`:65-85`) zyskują `photo_id` (`row.photo_id`).

#### 3. Endpoint wyszukiwarki katalogu

**File**: `src/pages/api/books/search.ts`

**Intent**: Selectować `photo_id` z `shelf_entries`, przenieść przez mapę `placement` do `CatalogBookDTO`.

**Contract**: select (`:52`) → dorzucić `photo_id`; typ `EntryRow` (`:68-73`) + value mapy `placement`
(`:74`) + wstawienie do mapy (`:76-80`) + finalny `result` (`:116-130`) zyskują `photo_id`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking: `npm run typecheck`
- [ ] Lint: `npm run lint`
- [ ] Unit: `npm run test` — odpowiedź `/api/shelves/:id/books` zawiera `photo_id` (uuid dla książki ze
      zdjęcia, `null` dla ręcznej); analogicznie `/api/books/search`.

#### Manual Verification:

- [ ] (brak — czysty plumbing, pokryty unit + Phase 2 E2E)

**Implementation Note**: Czysto danych — bez ręcznej weryfikacji. Po zielonych automatach przejść do Phase 2.

---

## Phase 2: Link „Źródłowe zdjęcie" w `BookCard` + E2E

### Overview

`BookCard` renderuje warunkowy link do strony review, gdy `book.photo_id` jest obecny.

### Changes Required:

#### 1. Komponent karty

**File**: `src/components/BookCard.tsx`

**Intent**: Gdy `book.photo_id` jest niepuste, wyrenderować link nawigacyjny „Źródłowe zdjęcie"
→ `/photos/[photo_id]`; gdy `null` — nic nie renderować. Spójny z istniejącym wzorcem `<a href>`.

**Contract**: `book.photo_id` (z `ShelfBookDTO`) sterujący renderem `<a href={/photos/${book.photo_id}}>`
w obszarze akcji karty; `data-testid={source-photo-link-${book.id}}`. Brak nowego propa — pole jest
już na `book`. Bez zmian w `ShelfBooksIsland`/`CatalogSearchIsland` (przekazują cały `book`).

#### 2. E2E

**File**: `tests/e2e/` (nowy spec, np. `book-source-photo-link.spec.ts`)

**Intent**: Pokryć ryzyko: link prowadzi do właściwego zdjęcia, jest nieobecny dla wpisu ręcznego,
i znika po usunięciu źródłowego zdjęcia (domknięcie luki S-29). Vision mockowany przez `page.route`
(zero kosztu LLM), unikalne dane per run, cleanup.

**Contract**: scenariusze nazwane po ryzyku — `getByRole('link', { name: /źródłowe zdjęcie/i })`,
`waitForURL('**/photos/**')`, asercja braku linku dla książki dodanej ręcznie (Flow B), oraz
zniknięcia linku po `DELETE /api/photos/[id]` + reload. Bez CSS-selektorów, bez `waitForTimeout`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking: `npm run typecheck`
- [ ] Lint: `npm run lint`
- [ ] Unit: `npm run test`
- [ ] E2E: `npm run test:e2e` — nowy spec zielony (link obecny/nawiguje, nieobecny dla ręcznej,
      znika po usunięciu zdjęcia)

#### Manual Verification:

- [ ] Na `/shelves/[id]` karta książki ze zdjęcia pokazuje „Źródłowe zdjęcie"; klik → poprawna strona review
- [ ] Na `/library` ta sama książka pokazuje link identycznie
- [ ] Książka dodana ręcznie (Flow B) nie pokazuje linku
- [ ] Po usunięciu źródłowego zdjęcia (zakładka Zdjęcia, S-29) link na karcie znika po odświeżeniu

**Implementation Note**: Po zielonych automatach pauza na ręczne potwierdzenie (user-only: Studio/przeglądarka).

---

## Testing Strategy

### Unit Tests:

- `/api/shelves/:id/books` i `/api/books/search` zwracają `photo_id` (uuid vs `null`) — rozszerzyć
  istniejące asercje kształtu DTO, jeśli plik testu endpointu istnieje; w przeciwnym razie dodać minimalny.

### Integration / E2E:

- Golden path: zdjęcie (mock vision) → confirm → na karcie link „Źródłowe zdjęcie" → `/photos/[id]`.
- Negatywny: wpis ręczny (Flow B) → brak linku.
- Regresja S-29: usuń zdjęcie → link znika (book.photo_id=NULL po SET NULL).

### Manual Testing Steps:

1. Wgraj zdjęcie, potwierdź książkę, wejdź na `/shelves/[id]` — sprawdź link i nawigację.
2. Sprawdź tę samą książkę na `/library`.
3. Dodaj zakup ręcznie — potwierdź brak linku.
4. Usuń źródłowe zdjęcie (S-29) — odśwież, potwierdź zniknięcie linku.

## References

- Roadmap: `context/foundation/roadmap.md` → S-15, backlog D2
- Wspólna karta: `src/components/BookCard.tsx`
- Endpointy: `src/pages/api/shelves/[id]/books.ts`, `src/pages/api/books/search.ts`
- DTO: `src/lib/books/schema.ts:51-66`
- Cel linku: `src/pages/photos/[id].astro`
- FK źródło: `supabase/migrations/0001_initial_schema.sql:105`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Przewleczenie photo_id przez API + DTO

#### Automated

- [x] 1.1 Type checking: `npm run typecheck` — 1afeded
- [x] 1.2 Lint: `npm run lint` — 1afeded
- [x] 1.3 Unit: oba endpointy zwracają `photo_id` (uuid vs null) — 1afeded

### Phase 2: Link „Źródłowe zdjęcie" w BookCard + E2E

#### Automated

- [x] 2.1 Type checking: `npm run typecheck` — 83b485b
- [x] 2.2 Lint: `npm run lint` — 83b485b
- [x] 2.3 Unit: `npm run test` — 83b485b (622/622)
- [x] 2.4 E2E: nowy spec zielony (obecny/nawiguje, nieobecny dla ręcznej, znika po usunięciu) — 83b485b

#### Manual

- [x] 2.5 `/shelves/[id]`: link obecny + nawigacja poprawna
- [x] 2.6 `/library`: link identyczny
- [x] 2.7 Wpis ręczny: brak linku
- [x] 2.8 Po usunięciu zdjęcia (S-29): link znika po odświeżeniu
