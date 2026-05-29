# Proposal Accept → Catalog (S-05) Implementation Plan

## Overview

Domykamy Flow A end-to-end (gwiazda przewodnia). Po S-04 użytkownik widzi tierowane propozycje per detekcja, ale ekran jest **read-only**. S-05 dodaje warstwę decyzji: accept / reject / correct / manual-entry (pojedynczo i hurtowo), persystencję do katalogu (`books` + `shelf_entries`), telemetrię każdej decyzji (`corrections`), status przeczytania (`books.is_read`, toggle), oraz widok półki z okładkami w kolejności „od lewej". Zamyka US-01 i niesie KPI acceptance-rate + time-to-first-shelf.

## Current State Analysis

- **Review UI read-only**: `src/components/DetectionReview.tsx` (`client:load`, props `{ photoId }`) renderuje tiery (≥0.75 / 0.55–0.75 / <0.55), flagi duplikatów (`duplicate: {type, shelfHint}`), placeholder „brak matchu", oraz przyciski rerun vision/match. **Brak akcji accept/reject/correct** i jakiejkolwiek persystencji decyzji.
- **Źródło danych**: `GET /api/photos/[id]` (`src/pages/api/photos/[id].ts`) zwraca `{ data: { photo, detections: DetectionWithCandidatesDTO[], vision_run } }`. `DetectionWithCandidatesDTO` ma `id, position_index, raw_title, raw_author, vision_confidence, spine_color, bbox, status, candidates: BookCandidateDTO[], duplicate`. `BookCandidateDTO`: `id, source, externalId, title, authors[], isbn10, isbn13, publisher, publishedYear, coverUrl, matchScore, rank`.
- **Schema (migracje 0001–0007)**:
  - `books`: `id, user_id, title, authors[], isbn_10, isbn_13, publisher, published_year, cover_url, source, source_external_id, notes, created_at`. Partial unique `books_user_isbn13 on (user_id, isbn_13) where isbn_13 is not null` → 23505. **Brak `is_read`.**
  - `shelf_entries`: `id, book_id, shelf_id, position_index (nullable int), photo_id, detection_id, is_current (default true), confirmed_at`. RLS pilnuje własności **tylko przez `book_id→books.user_id`**, NIE przez `shelf_id`.
  - `corrections`: `id, user_id, detection_id, original_raw_title, corrected_title, corrected_authors[], correction_type, created_at`. CHECK (inline, auto-nazwa `corrections_correction_type_check`): `in ('title_typo','wrong_author','wrong_book','not_a_book','parse_failure')`. **Brak accept/reject/manual.**
  - `detections.status` CHECK: `in ('pending','matched','confirmed','rejected')` — wartości docelowe już są.
- **Konwencje**: endpointy → `apiResponse`/`apiError` (`src/lib/http/response.ts`, `ApiErrorCode` zawiera już `CONFLICT`), Zod + `z.flattenError`, inline SQLSTATE mapping (23505→400 VALIDATION_ERROR, P0001→400, PGRST116→404). Klient z `locals.supabase`. Schema per-domena w `src/lib/<domain>/schema.ts` (wzorzec: `shelves/schema.ts` — `CreateX`/`UpdateX` + DTO type). `src/lib/books/schema.ts` już istnieje (mieszka tam `BookCandidateDTO`) — rozszerzamy.
- **Widok półki**: `/shelves/[id].astro` jest dziś photo-centric (auth guard + breadcrumb + `<PhotoListIsland client:load>`). Brak renderu książek, brak `BookCard`. `book_count` w `/api/shelves` to placeholder `0`.
- **Testy**: unit endpointów = mock łańcuchów Supabase (factory `makeXContext`); component = RTL; E2E = `page.route` mock + współdzielony `storageState` (1 signup/run).

## Desired End State

Użytkownik na `/photos/[id]` widzi przy każdej detekcji akcje **Akceptuj / Odrzuć / Popraw** oraz, gdy brak matchu, inline **„Wpisz ręcznie"**. Przycisk **„Akceptuj pre-zaznaczone"** hurtowo zatwierdza wszystkie kandydaci ≥0.75. Po akceptacji ląduje na `/shelves/[id]` z gridem okładek (kolejność „od lewej"), każda z badge'em statusu przeczytania i toggle 1-klik. Lista półek pokazuje realny `book_count`. Każda decyzja (accept/reject/field_edit/manual_entry) ma wiersz w `corrections`. Exact-duplicate (ten sam ISBN w katalogu) jest blokowany komunikatem.

### Key Discoveries:

- Pozycja „od lewej" jest darmowa: `detections.position_index` to kolejność vision od lewej — kopiujemy ją do `shelf_entries.position_index` (manual/bez-detekcji → `max(position_index)+1` na danej półce).
- `shelf_id` przy akceptacji **derywujemy z `photo.shelf_id`** (nie z inputu usera) → brak wektora cross-user injection mimo luki RLS na `shelf_id`.
- Exact-dup i tak rzuciłby 23505 z `books_user_isbn13`; robimy **pre-check** dla przyjaznego 409 zamiast surowego błędu unique.
- `correction_type` w `database.types.ts` jest `string|null` (CHECK nie odbity jako TS enum) — rozszerzenie CHECK nie wymaga zmian typów poza regenŚ.

## What We're NOT Doing

- **Re-search przy correct** (PRD §8 wspomina re-query) — correct/manual tworzą książkę z typed pól bez ponownego odpytania Google Books. Świadoma adaptacja zgodna z intencją roadmap („korygować pola przed akceptacją"). Re-match to ewentualny post-MVP.
- **S-06/S-07/S-08** — Flow B (dodaj zakup), przenoszenie z historią lokalizacji, wyszukiwarka/filtry. `shelf_entries.is_current` zostaje `true` (wersjonowanie lokalizacji to S-07).
- **Strojenie progów** (0.75/0.55 zostają z S-04), eskalacja modelu, paleta kolorów (zamrożenie przed S-08).
- **Edycja `books` poza `is_read`** — `PATCH /api/books/[id]` w S-05 obsługuje wyłącznie `is_read` (reszta pól odrzucana walidacją), choć trasa jest rozszerzalna.

## Implementation Approach

Backend-first, sześć faz atomic. Substrat danych (migracja + schema) → endpointy decyzji ze współdzielonym helperem insert-do-katalogu → warstwa read/list → przepisanie review UI → widok półki z okładkami → E2E golden path. Każda faza ma zielone automaty (typecheck/lint/build/vitest) przed manualną weryfikacją usera; migracja testowana na lokalnym stacku (nie `db push` w branchu).

## Critical Implementation Details

- **Kolejność w confirm helperze**: (0) **guard idempotencji** — jeśli `detection.status === 'confirmed'`, zwróć idempotentny skip (409 CONFLICT „już zaakceptowano" / w batch → `skipped`) **bez insertu**; chroni przed duplikatami books/shelf_entries dla książek bez ISBN (brak unique poza partial `books_user_isbn13`) przy double-click / reload / retry — guardrail NFR „nie tworzy duplikatów książek"; (1) pre-check exact-dup po `isbn_13` w katalogu usera → jeśli jest, 409 CONFLICT **przed** jakimkolwiek insertem; (2) insert `books` (mapuj 23505→409 jako backstop); (3) insert `shelf_entries` (shelf_id z photo, position z detection); (4) update `detections.status='confirmed'`; (5) insert `corrections` (telemetria). Brak transakcji multi-statement w Supabase REST → kolejność tak dobrana, by najgorszy częściowy błąd zostawiał spójny stan (książka bez wpisu półkowego jest widoczna w katalogu, nie znika; retry idempotentny po isbn-dup).
- **Telemetria — mapowanie decyzji → `correction_type`**: accept→`'accept'`, reject→`'reject'`, correct-z-kandydatem→`'field_edit'`, manual (brak candidate)→`'manual_entry'`. `original_raw_title` = `detection.raw_title`; `corrected_title`/`corrected_authors` wypełniane przy field_edit/manual.

## Phase 1: Substrat danych (migracja 0008 + schema books)

### Overview

Dodaje `books.is_read`, rozszerza enum `corrections.correction_type`, regeneruje typy, definiuje Zod + DTO dla decyzji katalogowych.

### Changes Required:

#### 1. Migracja 0008

**File**: `supabase/migrations/0008_catalog_read_and_telemetry.sql`

**Intent**: Dodać status przeczytania na książce i poszerzyć dozwolone typy telemetrii o decyzje accept/reject/correct/manual.

**Contract**: `books.is_read boolean not null default false`. Rozszerzenie CHECK na `corrections.correction_type` (drop inline constraint + add nazwany) o wartości `accept`, `reject`, `field_edit`, `manual_entry` (zachowując 5 dotychczasowych):

```sql
alter table books add column is_read boolean not null default false;

alter table corrections drop constraint corrections_correction_type_check;
alter table corrections add constraint corrections_correction_type_check
  check (correction_type in (
    'title_typo','wrong_author','wrong_book','not_a_book','parse_failure',
    'accept','reject','field_edit','manual_entry'
  ));
```

#### 2. Regeneracja typów

**File**: `src/lib/db/database.types.ts`

**Intent**: Odbić `books.is_read` w wygenerowanych typach (Row/Insert/Update).

**Contract**: Po `supabase db reset` na lokalnym stacku zregenerować typy `npm run db:types` (skrypt istnieje; wymaga linked/lokalnego stacku) i **zacommitować** `database.types.ts` — plik jest git-tracked, a CI **nie ma** kroku `supabase gen types` (tylko `wrangler types`), więc typecheck w CI czyta wersję z repo. Offline fallback: ręczny dopis `is_read: boolean` do `books` Row + `is_read?: boolean` Insert/Update. Plik jest już w `eslint.config.mjs` ignores. `correction_type` pozostaje `string|null`.

#### 3. Schema decyzji katalogowych

**File**: `src/lib/books/schema.ts` (rozszerzenie istniejącego)

**Intent**: Zod schematy dla bodies endpointów (confirm/correct/batch/read-toggle) + DTO książki na półce.

**Contract**: Eksporty: `ConfirmDetectionSchema` (`{ candidate_id: uuid }`), `CorrectDetectionSchema` (discriminated: z `candidate_id` + edytowane `title/authors/publisher/published_year`, LUB manual bez `candidate_id` z tymi samymi polami — `title` wymagany, reszta opcjonalna), `ConfirmBatchSchema` (`{ items: {detection_id: uuid, candidate_id: uuid}[]).min(1)`), `UpdateBookReadSchema` (`{ is_read: boolean }`). Typy DTO: `ShelfBookDTO` (`id, title, authors[], cover_url, published_year, position_index, is_read`). Walidacja pól wg FR-019 (title/author/publisher/rok), `published_year` int w sensownym zakresie.

### Success Criteria:

#### Automated Verification:
- Migracja parsuje się / aplikuje czysto na lokalnym stacku: `npx supabase db reset`
- Typecheck zielony: `npm run typecheck`
- Lint zielony: `npm run lint`
- Build zielony: `npm run build`
- Unit: `src/lib/books/schema.ts` — confirm/correct(both modes)/batch/read schematy akceptują valid i odrzucają invalid input (`npm run test`)

#### Manual Verification:
- Po `npx supabase db reset` w Studio: kolumna `books.is_read` (default false) i nowy CHECK na `corrections` widoczne.

---

## Phase 2: Endpointy decyzji + helper insert-do-katalogu

### Overview

Rdzeń backendu: confirm/reject/correct (PRD §8) + współdzielony helper persystujący do katalogu + batch + blokada exact-dup + telemetria.

### Changes Required:

#### 1. Helper insert-do-katalogu

**File**: `src/lib/books/confirm.ts` (nowy)

**Intent**: Jedna ścieżka „detekcja + wybór → książka w katalogu", konsumowana przez confirm/correct/batch. Zwraca wynik per detekcja (sukces / 409-dup).

**Contract**: `confirmDetectionToCatalog(supabase, userId, { detection, shelfId, book: {title, authors, isbn_10, isbn_13, publisher, published_year, cover_url, source, source_external_id}, correctionType, correctedFields? })`. Kolejność wg „Critical Implementation Details": guard idempotencji (`detection.status==='confirmed'` → skip/409) → pre-check exact-dup (`books` po `isbn_13` usera) → insert books → insert shelf_entries (`shelf_id`, `position_index` = `detection.position_index ?? max+1`, `photo_id`, `detection_id`, `is_current=true`) → update `detections.status='confirmed'` → insert corrections. Wynik: `{ ok: true, bookId } | { ok: false, reason: 'duplicate', shelfHint? }`.

#### 2. Confirm (accept jako-jest)

**File**: `src/pages/api/detections/[id]/confirm.ts` (nowy)

**Intent**: Accept wskazanego kandydata bez zmian; telemetria `accept`.

**Contract**: `POST`, `parseUuidParam` na `id`, Zod `ConfirmDetectionSchema`. Wczytuje detekcję + wybranego kandydata + `photo.shelf_id` (RLS-scoped; brak → 404). Mapuje kandydata na `book` (source z candidate), woła helper z `correctionType='accept'`. Dup → 409 CONFLICT z `shelfHint`. Zwraca `{ data: { book_id, shelf_id } }`.

#### 3. Correct (edycja pól lub manual)

**File**: `src/pages/api/detections/[id]/correct.ts` (nowy)

**Intent**: Accept z poprawionymi polami (z kandydatem) lub wpis ręczny (bez kandydata, brak matchu); telemetria `field_edit` / `manual_entry`.

**Contract**: `POST`, `CorrectDetectionSchema`. Z `candidate_id`: baza = kandydat, nadpisz edytowane pola, `source` zachowany, `correctionType='field_edit'`, `corrected_title/authors` do telemetrii. Bez `candidate_id`: `source='manual'`, ISBN null (chyba że podany), `correctionType='manual_entry'`. Woła helper. Dup → 409. Zwraca `{ data: { book_id, shelf_id } }`.

#### 4. Reject

**File**: `src/pages/api/detections/[id]/reject.ts` (nowy)

**Intent**: Oznacz detekcję jako odrzuconą + telemetria `reject`; brak wpisu do katalogu.

**Contract**: `POST`, brak body. Update `detections.status='rejected'` (RLS-scoped; PGRST116→404), insert `corrections` (`correction_type='reject'`, `original_raw_title=detection.raw_title`). Zwraca `{ data: { rejected: true } }`.

#### 5. Confirm-batch

**File**: `src/pages/api/photos/[id]/confirm-batch.ts` (nowy)

**Intent**: Hurtowa akceptacja pre-zaznaczonych (≥0.75) jednym round-tripem; raport per-item.

**Contract**: `POST`, `ConfirmBatchSchema` (`items[]` = {detection_id, candidate_id}). Waliduje, że detekcje należą do tego `photo` (RLS-scoped). Pętla po helperze (`accept`), zbiera wyniki. Zwraca `{ data: { confirmed: [{detection_id, book_id}], skipped: [{detection_id, reason}] } }` (200 nawet przy częściowych dup-skip — częściowy sukces nie jest błędem). Bez kandydatów do akcji → 400 VALIDATION_ERROR.

### Success Criteria:

#### Automated Verification:
- Unit confirm: accept tworzy book+shelf_entry+correction(accept), status confirmed, position z detekcji; exact-dup → 409; bad UUID → 404; **re-confirm już-confirmed detekcji → skip/409 bez duplikatu (guard idempotencji, także bez ISBN)**
- Unit correct: field_edit nadpisuje pola + correction(field_edit); manual (bez candidate) → source=manual + correction(manual_entry); dup → 409
- Unit reject: status→rejected + correction(reject); brak detekcji → 404
- Unit batch: wiele accept w jednym wywołaniu, raport confirmed/skipped, dup w środku nie wywraca reszty; pusta lista → 400
- Typecheck / lint / build zielone

#### Manual Verification:
- Na lokalnym stacku (Studio): accept realnej detekcji wstawia wiersz `books` + `shelf_entries` (position zgodna) + `corrections`; powtórny accept tego samego ISBN → 409 bez duplikatu.

---

## Phase 3: Read toggle + lista książek półki + realny book_count

### Overview

Warstwa odczytu/edycji katalogu pod widok półki.

### Changes Required:

#### 1. Toggle przeczytania

**File**: `src/pages/api/books/[id].ts` (nowy)

**Intent**: Przełączyć `is_read` (FR-023); rozszerzalny PATCH książki.

**Contract**: `PATCH`, `parseUuidParam`, `UpdateBookReadSchema` (`{is_read}`; inne pola odrzucone). Update `books` (RLS books_update_own; PGRST116→404). Zwraca `{ data: { id, is_read } }`.

#### 2. Książki na półce

**File**: `src/pages/api/shelves/[id]/books.ts` (nowy)

**Intent**: Lista książek danej półki w kolejności „od lewej" dla widoku półki.

**Contract**: `GET`, `parseUuidParam`. Join `shelf_entries`→`books` po `shelf_id`, `is_current=true`, `order by position_index asc nulls last`. Zwraca `{ data: { books: ShelfBookDTO[] } }`. Brak/cudza półka → 404 (RLS + walidacja własności półki).

#### 3. Realny book_count

**File**: `src/pages/api/shelves/index.ts` + `src/pages/api/shelves/[id].ts`

**Intent**: Zastąpić placeholder `book_count: 0` realnym zliczeniem (FR-009). **Blast radius do zaktualizowania**: `tests/unit/pages/api/shelves/index.test.ts` (asercje `book_count: 0` w ~:87,89,128,131), fixture `tests/unit/components/PhotoUploader.test.tsx:24`; `src/components/ShelfListItem.tsx` już renderuje `book_count` (pokaże realne liczby — sanity check w manualu); stale komentarze placeholder w `shelves/schema.ts` + `shelves/index.ts` poprawić.

**Contract**: PostgREST nie wyraża `GROUP BY count` w jednym wywołaniu, a count-per-półka to N+1 (regres NFR p95<1s). Zamiast tego: pobierz `shelf_entries.select('shelf_id').eq('is_current', true)` (RLS-scoped) **równolegle** z `shelves`, zlicz do `Map<shelf_id, number>` w JS (idiom repo — analogicznie do JS-sort w tym pliku i `candidatesByDetId` Map w `photos/[id].ts`). Dwa zapytania total, bez N+1. `ShelfDTO.book_count` w GET list + GET [id] wypełniony realnie; POST (nowa półka) słusznie zostaje `0`. Filtr `is_current=true` spójny z GET books-on-shelf.

### Success Criteria:

#### Automated Verification:
- Unit `PATCH /api/books/[id]`: toggle is_read, walidacja odrzuca obce pola, bad UUID→404, PGRST116→404
- Unit `GET /api/shelves/[id]/books`: kolejność po position_index asc, mapowanie ShelfBookDTO, cudza półka→404
- Unit `/api/shelves` book_count: zaktualizowane oczekiwania (realny count)
- Typecheck / lint / build zielone

#### Manual Verification:
- Studio/dev: lista półek pokazuje realne liczby; toggle persystuje `is_read`.

---

## Phase 4: Review UI — akcje accept/reject/correct/manual + bulk

### Overview

Przepisanie `DetectionReview` z read-only na interaktywne decyzje.

### Changes Required:

#### 1. DetectionReview — akcje

**File**: `src/components/DetectionReview.tsx`

**Intent**: Per detekcja: Akceptuj (wybrany kandydat) / Odrzuć / Popraw (inline form: title/author/publisher/rok) / Wpisz ręcznie (gdy brak matchu — inline form bez kandydata). Globalny „Akceptuj pre-zaznaczone" (wszystkie ≥0.75). Po sukcesie redirect na `/shelves/<photo.shelf_id>`.

**Contract**: Nowe handlery wołające: `POST /api/detections/[id]/confirm` (z `candidate_id` aktywnego top/wybranego), `/reject`, `/correct` (body wg trybu), `POST /api/photos/[id]/confirm-batch` (lista pre-zaznaczonych). Stan per detekcja: `decided` (znika/oznacza się po decyzji), busy/error inline. Mapowanie 409→komunikat „Masz już tę książkę". Manual form pokazany przy `!top` (placeholder „brak matchu") oraz dostępny przez „Popraw". Zachować istniejące rerun vision/match. `photo.shelf_id` z DTO (dodać do PhotoDTO jeśli brak — jest: `shelf_id` już w PhotoDTO).

### Success Criteria:

#### Automated Verification:
- Component test: render akcji na detekcji z kandydatem; klik Akceptuj woła confirm z poprawnym candidate_id; Odrzuć woła reject; Popraw otwiera form i wysyła correct z polami; manual form przy braku matchu wysyła correct bez candidate_id; bulk woła confirm-batch z pre-zaznaczonymi; 409 pokazuje komunikat duplikatu (mock fetch)
- Typecheck / lint / build zielone

#### Manual Verification:
- Dev: pełny przepływ na realnym zdjęciu — accept/reject/correct/manual + bulk; po akceptacji redirect na półkę; duplikat blokowany komunikatem.

---

## Phase 5: Widok półki z okładkami + toggle

### Overview

`/shelves/[id]` zyskuje grid książek (kolejność od lewej) z okładkami i toggle przeczytania, nad istniejącą sekcją zdjęć.

### Changes Required:

#### 1. BookCard

**File**: `src/components/BookCard.tsx` (nowy)

**Intent**: Karta książki: okładka (alt = „tytuł — autor" wg NFR a11y), tytuł, autorzy, rok, badge + toggle „przeczytana".

**Contract**: Props `{ book: ShelfBookDTO, onToggleRead }`. Fallback gdy `cover_url` null (placeholder). Toggle = przycisk z `aria-pressed`, optimistic UI.

#### 2. ShelfBooksIsland

**File**: `src/components/ShelfBooksIsland.tsx` (nowy)

**Intent**: React island ładujący książki półki i obsługujący toggle.

**Contract**: Props `{ shelfId }`. `client:load`. Fetch `GET /api/shelves/[id]/books`; render grid `BookCard`; toggle → `PATCH /api/books/[id]` (optimistic, rollback przy błędzie). `Skeleton` podczas ładowania, empty-state „Brak książek na tej półce".

#### 3. Strona półki

**File**: `src/pages/shelves/[id].astro`

**Intent**: Wstawić sekcję książek nad `PhotoListIsland`.

**Contract**: Dodać `<ShelfBooksIsland client:load shelfId={id} />` z nagłówkiem sekcji nad istniejącym `<PhotoListIsland>`. Zachować breadcrumb + „Dodaj zdjęcie".

### Success Criteria:

#### Automated Verification:
- Component test BookCard: render okładki+alt, fallback bez cover, toggle wywołuje onToggleRead, aria-pressed odbija stan
- Component test ShelfBooksIsland: fetch+render grid, empty-state, toggle PATCH (optimistic + rollback przy błędzie) — mock fetch
- Typecheck / lint / build zielone

#### Manual Verification:
- Dev: po akceptacji półka pokazuje okładki w kolejności od lewej; toggle 1-klik zmienia status i persystuje po reloadzie.

---

## Phase 6: E2E golden path (Flow A end-to-end)

### Overview

Playwright spec dowodzący gwiazdy przewodniej: upload → detect → match → accept → katalog → widok półki → toggle, w pełni mockowany.

### Changes Required:

#### 1. Spec golden path

**File**: `tests/e2e/proposal-accept-to-catalog.spec.ts` (nowy)

**Intent**: Dowieść Flow A end-to-end bez realnego vision/LLM/external (koszt = twardy guardrail).

**Contract**: Współdzielony `storageState`. `page.route` mock: storage upload, `POST /api/photos`, `/process`, `/match`, `GET /api/photos/[id]` (tierowane propozycje + jedna bez matchu + jedna z flagą duplikatu), oraz decyzyjne `confirm`/`correct`/`reject`/`confirm-batch`, `GET /api/shelves/[id]/books`, `PATCH /api/books/[id]`. Scenariusz: bulk-accept pre-zaznaczonych, single correct, single manual przy braku matchu, reject; redirect na półkę; grid okładek w kolejności; toggle read. Asercje na widoczne elementy i wywołane trasy (nie jakość matchu).

### Success Criteria:

#### Automated Verification:
- `npm run test:e2e` (lub docelowy skrypt Playwright) — spec zielony lokalnie
- Typecheck / lint zielone

#### Manual Verification:
- (opcjonalnie) przebieg E2E obserwowany w trybie headed; pełny manual smoke Flow A na prod po merge + `supabase db push` (deferred).

---

## Testing Strategy

### Unit Tests:
- `src/lib/books/schema.ts` — wszystkie schematy (valid/invalid, discriminated correct).
- Endpointy confirm/correct/reject/confirm-batch/books[id]/shelves[id]/books — mock łańcuchów Supabase (factory wzorem `shelves` testów); pełne mapowanie błędów (409 dup, 404, 400, PGRST116).
- `/api/shelves` book_count — zaktualizowane oczekiwania.

### Integration Tests:
- Pominięte na poziomie real-DB w branchu (zgodnie z regułą: Vitest mocks w branchu; real DB po merge). Lokalny stack jako manual.

### Manual Testing Steps:
1. `npx supabase db reset` → sprawdź `books.is_read` + nowy CHECK w Studio.
2. Upload realnego zdjęcia (dev) → review → bulk-accept → sprawdź książki na półce + corrections.
3. Correct pól + manual entry → sprawdź source/telemetrię.
4. Reject → status detekcji + correction.
5. Toggle read → persystencja po reloadzie.
6. Powtórny accept tego samego ISBN → blokada 409.

## Performance Considerations

- Widok półki to ścieżka nawigacji (NFR p95 < 1 s): `GET /api/shelves/[id]/books` z indeksem `shelf_entries_shelf_id_idx`; brak N+1 (jeden join). `book_count` — pojedyncze zapytanie agregujące, nie per-półka w pętli, by lista nie regresowała.

## Migration Notes

- 0008 testowana wyłącznie na lokalnym stacku w branchu; `supabase db push` na prod **po merge do main** (reguła branch-per-change). Migracja additive (nowa kolumna z default, rozszerzenie CHECK) — bez backfillu danych.

## References

- Roadmap: `context/foundation/roadmap.md` → S-05 (★ north star)
- PRD: `context/foundation/prd.md` → FR-019–024, FR-037; §10 scoring, §11 dedupe; US-01
- S-04 (poprzednik, substrat): `context/archive/2026-05-28-external-match-and-proposals/`
- Wzorzec endpointów: `src/pages/api/shelves/[id].ts`, `src/pages/api/photos/[id].ts`
- Memory: `s04-detection-spatial-region-model`, `e2e-playwright-first-class-verification`, `feedback-manual-verification-scope`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Substrat danych

#### Automated
- [ ] 1.1 Migracja 0008 aplikuje się czysto: `npx supabase db reset` — deferred: lokalny stack AV-blocked; weryfikacja po merge + `supabase db push`
- [x] 1.2 Typecheck zielony — 25637f1
- [x] 1.3 Lint zielony — 25637f1
- [x] 1.4 Build zielony — 25637f1
- [x] 1.5 Unit: books/schema.ts (confirm/correct-both/batch/read — valid+invalid) — 25637f1

#### Manual
- [ ] 1.6 Studio: books.is_read (default false) + nowy CHECK corrections widoczne — deferred: po merge + `supabase db push`

### Phase 2: Endpointy decyzji + helper

#### Automated
- [x] 2.1 Unit confirm: accept→book+shelf_entry+correction(accept)+status, position z detekcji, dup→409, bad UUID→404, re-confirm confirmed→skip/409 bez duplikatu (guard idempotencji) — 84d8ccf
- [x] 2.2 Unit correct: field_edit nadpisuje+correction(field_edit); manual→source=manual+correction(manual_entry); dup→409 — 84d8ccf
- [x] 2.3 Unit reject: status→rejected+correction(reject); brak→404 — 84d8ccf
- [x] 2.4 Unit confirm-batch: wiele accept w jednym wywołaniu, raport confirmed/skipped, dup nie wywraca reszty; pusta→400 — 84d8ccf
- [x] 2.5 Typecheck zielony — 84d8ccf
- [x] 2.6 Lint zielony — 84d8ccf
- [x] 2.7 Build zielony — 84d8ccf

#### Manual
- [ ] 2.8 Lokalny stack: accept wstawia books+shelf_entries+corrections; powtórny ISBN→409 bez duplikatu

### Phase 3: Read toggle + lista książek + book_count

#### Automated
- [ ] 3.1 Unit PATCH /api/books/[id]: toggle is_read, odrzuca obce pola, bad UUID→404, PGRST116→404
- [ ] 3.2 Unit GET /api/shelves/[id]/books: kolejność position_index asc, ShelfBookDTO, cudza półka→404
- [ ] 3.3 Unit /api/shelves: book_count realny (zaktualizowane oczekiwania)
- [ ] 3.4 Typecheck zielony
- [ ] 3.5 Lint zielony
- [ ] 3.6 Build zielony

#### Manual
- [ ] 3.7 Dev: lista półek realne liczby; toggle persystuje is_read

### Phase 4: Review UI — akcje + bulk

#### Automated
- [ ] 4.1 Component: accept→confirm(candidate_id), reject→reject, correct→correct(pola), manual→correct(bez candidate), bulk→confirm-batch, 409→komunikat dup
- [ ] 4.2 Typecheck zielony
- [ ] 4.3 Lint zielony
- [ ] 4.4 Build zielony

#### Manual
- [ ] 4.5 Dev: pełny przepływ accept/reject/correct/manual+bulk; redirect na półkę; duplikat blokowany

### Phase 5: Widok półki z okładkami + toggle

#### Automated
- [ ] 5.1 Component BookCard: okładka+alt, fallback bez cover, toggle→onToggleRead, aria-pressed
- [ ] 5.2 Component ShelfBooksIsland: fetch+grid, empty-state, toggle PATCH optimistic+rollback
- [ ] 5.3 Typecheck zielony
- [ ] 5.4 Lint zielony
- [ ] 5.5 Build zielony

#### Manual
- [ ] 5.6 Dev: półka pokazuje okładki od lewej; toggle 1-klik persystuje po reloadzie

### Phase 6: E2E golden path

#### Automated
- [ ] 6.1 E2E spec proposal-accept-to-catalog zielony lokalnie (mock vision/match/decyzje)
- [ ] 6.2 Typecheck + lint zielone

#### Manual
- [ ] 6.3 (opcjonalnie) headed run; pełny manual smoke Flow A na prod deferred do post-merge + db push
