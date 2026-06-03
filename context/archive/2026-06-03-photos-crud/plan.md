# S-29 Photos CRUD Implementation Plan

## Overview

Domykamy zarządzanie zdjęciami w katalogu: użytkownik może **usunąć** zdjęcie (z czyszczeniem
Storage i kaskadą detekcji/kandydatów, przy zachowaniu skatalogowanych książek i historii
kosztów vision), **przenieść** je na inną półkę, a widok pojedynczej półki rozdziela książki i
zdjęcia na **dwie zakładki** zamiast dwóch stackowanych sekcji. Zdjęcia wgrane przed wdrożeniem
deduplikacji (NULL `file_hash_sha256`) dostają widoczny badge.

## Current State Analysis

- **API zdjęć** (`src/pages/api/photos/`):
  - `index.ts` — tylko `POST` (rejestracja wgranego zdjęcia; FK `23503`→404, hash `23505`→409 z
    czyszczeniem Storage orphana via `.storage.from('shelf-photos').remove(...)`).
  - `[id].ts` — tylko `GET` (metadane + signed URL + detekcje + kandydaci). **Brak PATCH/DELETE.**
  - `check-hash.ts` — `GET ?hash=` (zero-cost dedup pre-upload).
- **Lista zdjęć per półka** — `GET /api/shelves/[id]/photos` (`src/pages/api/shelves/[id]/photos.ts`)
  już istnieje i zwraca `PhotoListItemDTO[]` (stage, counts, signed thumbnail, latest_vision_run).
  **Nie tworzymy nowego `GET /api/photos?shelf_id=`** — byłby duplikatem.
- **Widok półki** — `src/pages/shelves/[id].astro` renderuje blok statystyk + `ShelfBooksIsland`
  (`client:load`, props `{shelfId}`) + `PhotoListIsland` (`client:load`, props `{shelfId, shelfName}`)
  jako dwie pionowe sekcje. To miejsce konwersji na zakładki.
- **Storage** — bucket `shelf-photos` (private). Usunięcie pliku: `.storage.from('shelf-photos').remove([path])`.
- **Kaskady FK (potwierdzone w `0001_initial_schema.sql` + `0015_vision_cost_preservation.sql`):**
  - `detections.photo_id` → `photos` **ON DELETE CASCADE** → `book_candidates.detection_id` **CASCADE**.
  - `shelf_entries.photo_id` → **SET NULL**, `shelf_entries.detection_id` → **SET NULL** (skatalogowane książki przeżywają).
  - `corrections.detection_id` → **SET NULL** (telemetria korekt przeżywa).
  - `vision_runs.photo_id` / `refine_calls.photo_id` → **SET NULL** (S-30: koszty przeżywają).
- **Wzorzec view-mode/persist** — `useDetectionViewMode()` w `DetectionReview.tsx` (localStorage
  `bookshelf:detection-view-mode`, `ViewModeSwitcher` z `aria-pressed` + testid `view-mode-{m}`).
- **Wzorzec CRUD endpointu** — `src/pages/api/shelves/[id].ts` (parseUuidParam→404, maybeSingle
  ownership pre-check, SQLSTATE mapping `P0001`/`23505`/`PGRST116`, apiResponse/apiError).
- **Wzorzec move w UI** — `ShelfBooksIsland` `handleMove` (optimistic + rollback, `POST /api/books/{id}/move`).

## Desired End State

W zakładce „Zdjęcia" na `/shelves/[id]` każdy wiersz zdjęcia ma akcje **Usuń** (modal potwierdzenia
z liczbą wykrytych pozycji do skasowania) i **Przenieś** (picker półki). Usunięcie czyści Storage +
DB (detekcje/kandydaci znikają, skatalogowane książki i koszty zostają). Zdjęcia z NULL hash mają
badge „⚠ Bez hash". Zakładka aktywna jest pamiętana w `localStorage`. Weryfikacja: unit testy
endpointów + komponentów zielone, E2E (tab persistence + delete flow z mockiem) zielone, `npm run
typecheck`/`lint`/`test` zielone.

### Key Discoveries:

- `GET /api/shelves/[id]/photos` już pokrywa „listę zdjęć per półka" — reuse, nie duplikuj
  (`src/pages/api/shelves/[id]/photos.ts`).
- `photos` nie ma kolumny title/caption → „retitle" z roadmapy odpada (byłby migracją); PATCH = `shelf_id` only.
- `shelf_entries.photo_id`/`detection_id` SET NULL + `books` niezależne od `photos` → DELETE zdjęcia
  nie usuwa skatalogowanych książek (`0001_initial_schema.sql:102-106`).
- S-30 już zmienił FK kosztów na SET NULL — żadna nowa migracja nie jest potrzebna w tym slice.
- `PhotoListItemDTO` w `src/lib/photos/schema.ts` nie zawiera hash — dodajemy derived `legacy_no_hash`, nie surowy hash.

## What We're NOT Doing

- **Nie** tworzymy `GET /api/photos?shelf_id=` (istniejący `GET /api/shelves/[id]/photos` wystarcza).
- **Nie** dodajemy kolumny title/caption do `photos` ani „retitle" (osobny slice, jeśli zajdzie potrzeba).
- **Nie** ruszamy migracji DB (kaskady już gotowe po S-03/S-30).
- **Nie** dodajemy DELETE/move zdjęcia na stronie review (`/photos/[id]`) — tylko w zakładce Zdjęcia.
- **Nie** robimy backfillu hash (osobny, równoległy change `photo-hash-backfill`); tu tylko badge.
- **Nie** dodajemy bulk-delete ani multi-select zdjęć.

## Implementation Approach

Trzy atomic fazy: (1) warstwa API (DELETE + PATCH + schema + SQLSTATE mapping + unit testy,
automated-only), (2) konwersja widoku półki na zakładki (komponent + persist + E2E), (3) akcje
zarządzania zdjęciem w `PhotoListIsland` + flaga `legacy_no_hash` w endpoint liście + badge
(unit + E2E). Każda faza = osobny commit `feat(photos-crud): ...`.

## Phase 1: API — DELETE + PATCH endpointów zdjęcia

### Overview

Dodanie `PATCH` (zmiana `shelf_id`) i `DELETE` (Storage remove + DB delete z kaskadą) do
`src/pages/api/photos/[id].ts`, plus `UpdatePhotoSchema`. Mirror wzorca z `shelves/[id].ts`.

### Changes Required:

#### 1. Schema zdjęcia — input PATCH

**File**: `src/lib/photos/schema.ts`

**Intent**: Dodać `UpdatePhotoSchema` walidujący body PATCH (przeniesienie zdjęcia na inną półkę).

**Contract**: `UpdatePhotoSchema = z.object({ shelf_id: z.uuid() })` + `export type UpdatePhotoInput =
z.infer<typeof UpdatePhotoSchema>`. Pojedyncze wymagane pole `shelf_id` (brak innych edytowalnych
metadanych w MVP).

#### 2. Endpoint PATCH + DELETE

**File**: `src/pages/api/photos/[id].ts` (rozszerzenie istniejącego pliku z `GET`)

**Intent**: `PATCH` aktualizuje `shelf_id` zdjęcia (FK do cudzej/nieistniejącej półki → 404 via
`23503`); `DELETE` najpierw kasuje wiersz DB (kaskada robi resztę), potem best-effort czyści plik ze
Storage. Oba: 401 przed fetchem, `parseUuidParam`→404, ownership egzekwowane przez RLS.

**Contract**:
- `PATCH`: walidacja `UpdatePhotoSchema`; `supabase.from('photos').update({ shelf_id }).eq('id', id)
  .select(...).single()`. Mapping: `23503`→404 `NOT_FOUND` („Półka nie istnieje lub brak dostępu"),
  `PGRST116`→404, inne→500. Zwraca `apiResponse({ data: { photo: PhotoDTO } })`.
- `DELETE`: ownership pre-check `select('id, storage_path').eq('id', id).maybeSingle()` (brak→404,
  zachowujemy `storage_path` do czyszczenia); `delete().eq('id', id)` (błąd→500); po sukcesie
  `storage.from('shelf-photos').remove([storage_path])` — błąd tylko `console.error`, **nie** zmienia
  200. Zwraca `apiResponse({ data: { deleted: true } })`.
- `export const prerender = false` (już jest w pliku).

### Success Criteria:

#### Automated Verification:

- Unit testy PATCH (sukces shelf_id, 23503→404, 401, bad UUID→404, brak body→400) zielone: `npm run test`
- Unit testy DELETE (sukces 200, nieistniejące→404, 401, błąd delete→500, błąd Storage→nadal 200 + log) zielone
- `npm run typecheck` zielony
- `npm run lint` zielony

#### Manual Verification:

- (brak — faza automated-only; warstwa API bez UI)

**Implementation Note**: Faza automated-only — po zielonych automatach przejść do Phase 2 bez pauzy manualnej.

---

## Phase 2: Widok półki — zakładki „Książki / Zdjęcia"

### Overview

Konwersja dwóch stackowanych sekcji na `/shelves/[id]` w zakładki z persystencją wyboru w
`localStorage` (wzór `useDetectionViewMode`).

### Changes Required:

#### 1. Komponent zakładek

**File**: `src/components/ShelfTabs.tsx` (nowy)

**Intent**: React island opakowujący `ShelfBooksIsland` i `PhotoListIsland`, renderujący przełącznik
zakładek i pokazujący aktywną; aktywna zakładka pamiętana w `localStorage`.

**Contract**: Props `{ shelfId: string; shelfName: string }`. Stan `tab: 'books' | 'photos'` z
hookiem `useShelfTab()` (localStorage key `bookshelf:shelf-tab`, mirror `useDetectionViewMode`).
Przełącznik: przyciski `aria-pressed`, testid `shelf-tab-books` / `shelf-tab-photos`; panele testid
`shelf-tab-panel-books` / `shelf-tab-panel-photos`. Renderuje istniejące islands bez zmiany ich API.

**Strategia montażu (oba panele zamontowane, przełączanie przez widoczność):** oba islands montują
się raz; nieaktywny panel jest ukrywany przez `hidden` (CSS), NIE odmontowywany. Skutek: każdy island
fetchuje swoje dane raz przy hydratacji, a przełączenie zakładki jest natychmiastowe (bez re-fetchu /
migotania loadera). Koszt: jeden „eager" fetch listy zdjęć nawet gdy startujemy na zakładce Książki —
akceptowalny (lekki DB query + signed URLs; brak realnego vision). Alternatywa „conditional render"
odrzucona: re-fetch i skeleton przy każdym przełączeniu psują UX.

#### 2. Strona półki — render zakładek zamiast 2 sekcji

**File**: `src/pages/shelves/[id].astro`

**Intent**: Zastąpić dwie sekcje (`<section>Książki</section>` + `<section>Zdjęcia</section>`)
pojedynczym `<ShelfTabs client:load shelfId={id} shelfName={shelf.name} />`. Blok statystyk
(`shelf-stats`) zostaje nad zakładkami.

**Contract**: Usunięcie bezpośredniego renderu `ShelfBooksIsland`/`PhotoListIsland`, dodanie
`ShelfTabs`. Zachować istniejące testidy bloku statystyk.

### Success Criteria:

#### Automated Verification:

- Unit test `ShelfTabs` (default tab 'books', przełączenie pokazuje właściwy panel, persist read/write localStorage) zielony: `npm run test`
- E2E: wejście na `/shelves/[id]`, klik „Zdjęcia", reload → zakładka „Zdjęcia" nadal aktywna (`tests/e2e/`) zielony
- `npm run typecheck` / `npm run lint` zielone

#### Manual Verification:

- Zakładki przełączają się płynnie, statystyki widoczne nad nimi, brak migotania przy hydratacji (Studio/przeglądarka — user)

**Implementation Note**: Po zielonych automatach pauza na potwierdzenie manualne (przeglądarka) przed Phase 3.

---

## Phase 3: Akcje zarządzania zdjęciem + badge NULL hash

### Overview

`PhotoListIsland` dostaje akcje **Usuń** (modal potwierdzenia) i **Przenieś** (picker półki) oraz
badge dla zdjęć z NULL hash; endpoint listy zwraca derived `legacy_no_hash`.

### Changes Required:

#### 1. Flaga legacy_no_hash w DTO i endpoincie listy

**File**: `src/lib/photos/schema.ts` + `src/pages/api/shelves/[id]/photos.ts`

**Intent**: Dodać `legacy_no_hash: boolean` do `PhotoListItemDTO` i wyliczyć je w endpoincie
(`file_hash_sha256 IS NULL`), bez zwracania surowego hash.

**Contract**: `PhotoListItemDTO.legacy_no_hash: boolean`. W zapytaniu listy dociągnąć
`file_hash_sha256` do selecta i zmapować `legacy_no_hash: row.file_hash_sha256 == null`. Unit test
endpointu rozszerzony o ten przypadek.

#### 2. Modal potwierdzenia usunięcia

**File**: `src/components/PhotoListIsland.tsx`

**Intent**: Akcja „Usuń" otwiera in-app modal (nie `window.confirm`) informujący o konsekwencjach
(skasowane zostaną wykryte pozycje; skatalogowane książki pozostaną), po potwierdzeniu woła
`DELETE /api/photos/{id}` i usuwa wiersz z listy (optimistic + rollback przy błędzie).

**Contract**: Stan `pendingDeletePhotoId`, modal testid `photo-delete-confirm` + przyciski
`photo-delete-confirm-yes` / `photo-delete-confirm-cancel`; akcja w wierszu testid `delete-photo-{id}`.
Komunikat zawiera `detected_count` zdjęcia. Po sukcesie filtruje `photos` state.

**Guard przy trwającym vision:** przycisk „Usuń" (oraz „Przenieś") jest `disabled`, gdy
`photo.has_running_run === true` lub `stage === 'processing'` — z tooltipem „Trwa analiza, poczekaj
na zakończenie". Zapobiega usunięciu wiersza, do którego współbieżny `process.ts` zaraz zapisze
detekcje/koszt (write do skasowanego wiersza = ciche 0 rows lub osierocony vision_run). Unit test
pokrywa stan disabled dla `has_running_run`.

#### 3. Akcja „Przenieś" (picker półki)

**File**: `src/components/PhotoListIsland.tsx`

**Intent**: Picker półek (jak w `ShelfBooksIsland.handleMove`) woła `PATCH /api/photos/{id}` z
`{ shelf_id }`; po sukcesie zdjęcie znika z bieżącej listy (przeniesione na inną półkę).

**Contract**: Dociągnięcie listy półek `GET /api/shelves` (jak w `ShelfBooksIsland`), select/przycisk
testid `move-photo-{id}`. Optimistic remove + rollback. „Zakupione" i bieżąca półka traktowane jak w
move książek (bieżąca półka wykluczona z targetów).

#### 4. Badge NULL hash

**File**: `src/components/PhotoListIsland.tsx`

**Intent**: Gdy `photo.legacy_no_hash`, pokazać badge „⚠ Bez hash" z tooltipem „Wgrane przed
wdrożeniem deduplikacji — możliwy duplikat".

**Contract**: Badge testid `legacy-hash-badge-{id}`, renderowany warunkowo obok stage badge.

### Success Criteria:

#### Automated Verification:

- Unit test `PhotoListIsland` (modal delete: open→confirm woła DELETE i usuwa wiersz; cancel zamyka; move woła PATCH; badge widoczny gdy legacy_no_hash; Usuń/Przenieś `disabled` gdy `has_running_run`) zielony: `npm run test`
- Unit test endpointu listy: `legacy_no_hash=true` dla NULL hash, `false` wpp — zielony
- E2E: delete flow (mock `DELETE /api/photos/*` → zdjęcie znika z listy; modal potwierdzenia) + badge widoczny dla legacy — zielony (`tests/e2e/`)
- `npm run typecheck` / `npm run lint` zielone

#### Manual Verification:

- Usunięcie realnego zdjęcia w przeglądarce: plik znika ze Storage (Studio), detekcje znikają, skatalogowane książki zostają na półce, koszt vision dalej widoczny w `/api/account/stats` (user)
- Przeniesienie zdjęcia na inną półkę: pojawia się w zakładce Zdjęcia docelowej półki (user)
- Badge „Bez hash" widoczny dla starego zdjęcia (user)

**Implementation Note**: Po zielonych automatach pauza na pełną weryfikację manualną (Storage + cascade) przed `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/pages/api/photos/[id].test.ts` — PATCH + DELETE (mirror `shelves/[id].test.ts` mock factory).
- `tests/unit/pages/api/shelves/photos.test.ts` — rozszerzenie istniejącego pliku o `legacy_no_hash`.
- `tests/unit/components/ShelfTabs.test.tsx` — przełączanie + persist (nowy plik).
- `tests/unit/components/PhotoListIsland.test.tsx` — rozszerzenie istniejącego pliku o delete modal, move, badge, disabled-guard.

### Integration / E2E Tests:

- `tests/e2e/` — tab persistence (klik + reload), delete flow z mockiem `DELETE /api/photos/*`,
  badge dla legacy. Mock wszystkich network calls przez `page.route` (zero realnego vision/Storage).

### Manual Testing Steps (user-only):

1. Usuń zdjęcie → sprawdź Storage (Studio) że plik zniknął, detekcje znikły, skatalogowane książki zostały.
2. Sprawdź `/api/account/stats` że koszt vision przetrwał usunięcie zdjęcia.
3. Przenieś zdjęcie między półkami → pojawia się w docelowej zakładce Zdjęcia.
4. Zweryfikuj badge „Bez hash" dla zdjęcia wgranego przed dedupem.

## Migration Notes

Brak migracji DB — kaskady (`detections` CASCADE, `shelf_entries`/`corrections` SET NULL, koszty
SET NULL po S-30) już na miejscu. Slice jest czysto aplikacyjny.

## References

- Wzorzec CRUD: `src/pages/api/shelves/[id].ts`
- Wzorzec list endpoint: `src/pages/api/shelves/[id]/photos.ts`
- Wzorzec persist/view-mode: `src/components/DetectionReview.tsx` (`useDetectionViewMode`)
- Wzorzec move UI: `src/components/ShelfBooksIsland.tsx` (`handleMove`)
- Kaskady FK: `supabase/migrations/0001_initial_schema.sql:48,64,102-106,118`, `0015_vision_cost_preservation.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API — DELETE + PATCH endpointów zdjęcia

#### Automated

- [x] 1.1 Unit testy PATCH (sukces, 23503→404, 401, bad UUID→404, brak body→400) zielone — 5203798
- [x] 1.2 Unit testy DELETE (200, 404, 401, delete-error→500, Storage-error→200+log) zielone — 5203798
- [x] 1.3 `npm run typecheck` zielony — 5203798
- [x] 1.4 `npm run lint` zielony — 5203798

### Phase 2: Widok półki — zakładki „Książki / Zdjęcia"

#### Automated

- [x] 2.1 Unit test `ShelfTabs` (default, przełączenie, persist) zielony — 734a3f6
- [x] 2.2 E2E tab persistence (klik + reload) zielony — 734a3f6
- [x] 2.3 `npm run typecheck` / `npm run lint` zielone — 734a3f6

#### Manual

- [x] 2.4 Zakładki płynne, statystyki nad nimi, brak migotania (user)

### Phase 3: Akcje zarządzania zdjęciem + badge NULL hash

#### Automated

- [x] 3.1 Unit test `PhotoListIsland` (delete modal, move, badge, disabled-guard) zielony — ad0253a
- [x] 3.2 Unit test endpointu listy: `legacy_no_hash` zielony — ad0253a
- [x] 3.3 E2E delete flow + badge (mock) zielony — ad0253a
- [x] 3.4 `npm run typecheck` / `npm run lint` zielone — ad0253a

#### Manual

- [x] 3.5 Usunięcie realnego zdjęcia: Storage + cascade + książki zostają + koszt przetrwał (user)
- [x] 3.6 Przeniesienie zdjęcia między półkami (user)
- [x] 3.7 Badge „Bez hash" dla starego zdjęcia (user)
