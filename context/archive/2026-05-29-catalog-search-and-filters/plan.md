# Catalog Search & Filters (S-08) Implementation Plan

## Overview

Wyszukiwarka katalogu na `/library`: pełnotekst po tytule/autorze/wydawnictwie + filtry (kolor grzbietu, półka multi-select, status przeczytania), kombinowalne. Wyniki = karta książki z nazwą półki + pozycją + statusem. Brak wyników → jednoznaczne „nie masz tej książki". Domyka US-03 (in-bookstore „czy mam?") i US-04 (in-home „czerwony grzbiet o smokach").

## Current State Analysis

- **Brak strony katalogu** — jest tylko per-półka `/shelves/[id]` (ShelfBooksIsland). `/library` oczekiwany (komentarz w `index.astro`, landing CTA tymczasowo → /shelves).
- **`spine_color` tylko na `detections`** — `books` nie ma kolumny; ścieżka books→shelf_entries(detection_id)→detections jest 2-hop i NULL dla manual/Flow-B. Kolor to load-bearing differentiator (PRD) → denormalizujemy na books.
- **Brak „krótkiego opisu"** — nie persystowany w `books`/`book_candidates`; klienci S-04 (googleBooks/openLibrary) go nie pobierają. Cut z S-08.
- **`authors` to text[]** — ILIKE na array nie wyraża się wprost w supabase-js → generated column `search_text`.
- **Brak tsvector/GIN** w migracjach; ~1000 książek/user (target_scale small) → ILIKE wystarcza, p95<1s.
- **Wzorce**: query books per-shelf w `shelves/[id]/books.ts`; nested select shelf-name w `confirm.ts`/`books/index.ts`; `.in()` ustalony; `.or()`/`.ilike()` — nowość. `BookCard` (props `{book: ShelfBookDTO, onToggleRead}`) NIE pokazuje nazwy półki. RLS `user_id=auth.uid()` na books.

## Desired End State

Header „Biblioteka" → `/library`: pole szukania (debounce) + filtry (kolor dropdown, półka multi-select, status radio). `GET /api/books/search` zwraca książki usera filtrowane/wyszukane, każda z nazwą półki + pozycją + kolorem + statusem; toggle read działa. Brak wyników → „nie masz tej książki". Kombinacja pełnotekst + dowolne filtry.

## What We're NOT Doing

- **Full-text po opisie (FR-032 „krótki opis")** — opis nie jest persystowany; capture wymaga modyfikacji klientów S-04 + confirm + re-fetch backfill. Odroczone do osobnego follow-up slice'a (zarejestrować w roadmap). S-08 szuka po title/author/publisher.
- **Filtr koloru dla książek manual/Flow-B** — mają `spine_color=NULL` (brak detekcji); filtr koloru ich nie zwróci (świadome — kolor jest atrybutem rozpoznania ze zdjęcia).
- **tsvector/ranking trafności** — ILIKE substring wystarcza przy ~1000; sortowanie po position/tytule, nie po relevance score.
- **Filtr typ oprawy / dekada** (PRD Non-Goals).

## Critical Implementation Details

- **`search_text` generated STORED**: `lower(coalesce(title,'') || ' ' || array_to_string(authors,' ') || ' ' || coalesce(publisher,''))` — wszystkie funkcje immutable, więc legalne dla GENERATED ALWAYS AS ... STORED. Search: `.ilike('search_text', '%'+term+'%')` (term lower + escape `%`/`_`/`,`).
- **spine_color capture w confirm**: helper `confirmDetectionToCatalog` dostaje już `detection` — dorzucić `spine_color` do args (endpointy confirm/correct/batch selectują `spine_color` z detekcji i przekazują); books insert ustawia `spine_color`. Manual (`POST /api/books`, correct manual) → null.
- **Backfill spine_color**: migracja 0011 UPDATE books z detekcji przez shelf_entries (is_current).
- **Shelf filter przez embedded**: `.select('...,shelf_entries!inner(position_index, is_current, shelves(id,name))')` + `.eq('shelf_entries.is_current', true)`; multi-select → `.in('shelf_entries.shelf_id', [...])`.

## Phase 1: Substrat — migracja 0011 + capture + schema

**File**: `supabase/migrations/0011_books_search_and_color.sql` —
`alter table books add column spine_color text;`
`alter table books add column search_text text generated always as (lower(coalesce(title,'') || ' ' || array_to_string(authors,' ') || ' ' || coalesce(publisher,''))) stored;`
backfill: `update books set spine_color = (select d.spine_color from shelf_entries se join detections d on d.id = se.detection_id where se.book_id = books.id and se.is_current and d.spine_color is not null limit 1) where spine_color is null;`

**File**: `src/lib/db/database.types.ts` — dopisz `spine_color: string|null` + `search_text: string|null` (generated — w Insert też `?`, ale endpoint go nie ustawia) do books Row/Insert/Update.

**File**: `src/lib/books/confirm.ts` — `ConfirmDetectionArgs.detection` + book insert: dodaj `spine_color` (z detekcji). Args rozszerzone o `detection.spine_color`.

**File**: `src/pages/api/detections/[id]/confirm.ts`, `correct.ts`, `photos/[id]/confirm-batch.ts` — select `spine_color` z detekcji + przekaż do helpera (manual w correct → brak, bo brak detekcji-koloru intencji; pozostaje null).

**File**: `src/lib/books/schema.ts` — `SearchBooksQuerySchema` (q?: string, color?: enum SPINE_COLORS, shelf_ids?: string[], read?: 'read'|'unread'|'all') + `CatalogBookDTO` (ShelfBookDTO + `shelf_name`, `spine_color`).

### Success Criteria:
#### Automated:
- Migracja 0011 parsuje się; generated column poprawnie się liczy (sprawdzalne w teście integr./manualnie)
- Unit: SearchBooksQuerySchema (valid/invalid color, read enum, shelf_ids uuid[])
- Unit: confirm helper przekazuje spine_color do books insert (rozszerzony test)
- Typecheck/lint/build zielone
#### Manual:
- (post-merge) Studio: books.spine_color + search_text; backfill wypełnił kolor dla photo-books

## Phase 2: GET /api/books/search

**File**: `src/pages/api/books/search.ts` (nowy) — `GET`. Query params: `q`, `color`, `shelf` (powtarzalne/CSV), `read`. Parse via SearchBooksQuerySchema. Buduje query na `books` (RLS): embedded `shelf_entries!inner(position_index, shelves(id,name))` + `.eq('shelf_entries.is_current', true)`; `q` → `.ilike('search_text', %q%)` (escaped); `color` → `.eq('spine_color', color)`; `shelf[]` → `.in('shelf_entries.shelf_id', ids)`; `read` → `.eq('is_read', bool)` (pomiń gdy 'all'); order title asc. Mapuje na `CatalogBookDTO[]`. Zwraca `{ data: { books, total } }`.

### Success Criteria:
#### Automated:
- Unit: 401; brak filtrów → wszystkie; q ILIKE; color eq; shelf in; read eq; kombinacja; pusta lista → 200 {books:[]}; escape special chars w q
- Typecheck/lint/build zielone
#### Manual:
- (post-merge) Dev: szukanie po fragmencie + filtry kombinowane <1s

## Phase 3: UI — /library + CatalogSearchIsland + nav

**File**: `src/pages/library.astro` (nowy) — auth guard; renderuje `CatalogSearchIsland`.

**File**: `src/components/CatalogSearchIsland.tsx` (nowy) — `client:load`. Pole szukania (debounce ~300ms), filtry: kolor (select z SPINE_COLORS), półka (multi-select checkbox/listbox z `/api/shelves`), status (radio przeczytana/nie/wszystko). Fetch `/api/books/search?...` przy zmianie. Grid `BookCard` z nazwą półki + kolorem; toggle read (PATCH /api/books/[id], optimistic). Skeleton loading; empty-state „Nie masz tej książki" (osobny od „brak filtrów/zacznij szukać").

**File**: `src/components/BookCard.tsx` — opcjonalne propsy `shelfName?`, `spineColor?` (render badge półki + kropka koloru gdy podane; backward-compatible dla ShelfBooksIsland).

**File**: `src/layouts/Layout.astro` — header nav „Biblioteka" (`data-testid="nav-library"`, href `/library`).

**File**: `src/pages/index.astro` — landing CTA flip /shelves → /library (komentarz S-08 to przewidywał).

### Success Criteria:
#### Automated:
- Component test CatalogSearchIsland: render filtrów; wpisanie q → fetch z param; zmiana filtra → fetch; wyniki render BookCard z shelf_name; empty → komunikat; toggle read
- Component test BookCard: shelfName/spineColor render gdy podane; brak gdy nie (regress ShelfBooksIsland)
- Typecheck/lint/build zielone
#### Manual:
- (post-merge) Dev: in-bookstore (q tytuł→shelf+status), in-home (q+kolor→≤3)

## Phase 4: E2E golden path

**File**: `tests/e2e/catalog-search.spec.ts` (nowy) — mock `page.route` `/api/books/search` + `/api/shelves`. Scenariusze: header „Biblioteka" → /library; wpisanie frazy → wyniki z nazwą półki; filtr koloru zawęża; kombinacja q+kolor; brak wyników → „Nie masz tej książki"; toggle read na wyniku. Wait na mount-fetch jako gate hydracji (lekcja S-06).

### Success Criteria:
#### Automated:
- E2E spec zielony (mock); typecheck/lint zielone
#### Manual:
- (post-merge) pełny manual smoke US-03/US-04 na prod

## Progress

### Phase 1: Substrat
#### Automated
- [ ] 1.1 Migracja 0011 parsuje się (spine_color + search_text generated + backfill)
- [ ] 1.2 Unit SearchBooksQuerySchema (valid/invalid)
- [ ] 1.3 Unit confirm helper przekazuje spine_color
- [ ] 1.4 Typecheck zielony
- [ ] 1.5 Lint zielony
- [ ] 1.6 Build zielony
#### Manual
- [ ] 1.7 Studio: spine_color+search_text+backfill (post-merge)

### Phase 2: GET /api/books/search
#### Automated
- [ ] 2.1 Unit: 401/no-filter/q/color/shelf/read/kombinacja/empty/escape
- [ ] 2.2 Typecheck zielony
- [ ] 2.3 Lint zielony
- [ ] 2.4 Build zielony
#### Manual
- [ ] 2.5 Dev: szukanie+filtry <1s (post-merge)

### Phase 3: UI
#### Automated
- [ ] 3.1 Component CatalogSearchIsland (filtry/fetch/wyniki/empty/toggle)
- [ ] 3.2 Component BookCard (shelfName/spineColor opcjonalne)
- [ ] 3.3 Typecheck zielony
- [ ] 3.4 Lint zielony
- [ ] 3.5 Build zielony
#### Manual
- [ ] 3.6 Dev: US-03/US-04 (post-merge)

### Phase 4: E2E
#### Automated
- [ ] 4.1 E2E catalog-search spec zielony (mock)
- [ ] 4.2 Typecheck + lint zielone
#### Manual
- [ ] 4.3 Pełny manual smoke US-03/04 na prod (post-merge + db push)
