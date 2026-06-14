# Metadane zakupu książki — Implementation Plan

## Overview

Dodajemy opcjonalne atrybuty zakupu do każdej książki: datę zakupu (już istnieje w DB),
cenę (PLN), miasto i wydarzenie (np. Targi Książki). Użytkownik edytuje je per-książka
w BookModal lub hurtowo na stronie photo review (date/city/event propagują do wszystkich
potwierdzonych książek ze zdjęcia). Biblioteka (/library) dostaje nowe filtry: dropdown
wydarzeń, city freetext, zakres dat zakupu, zakres ceny.

## Current State Analysis

- `books.purchase_date` (date, nullable) — istnieje od 0010; ustawiany tylko przez Flow B
  (POST /api/books z `source:'manual'`). Confirm endpoint go nie zapisuje.
- `books.search_text` — GENERATED STORED; aktualny helper `books_search_text(title, authors,
  publisher, description)` (4 args, migration 0019). Rozszerzany o purchase_city/event.
- `photos` table — brak kolumn purchase_*. PATCH /api/photos/[id] akceptuje tylko `shelf_id`.
- `UpdateBookSchema` — brak purchase_price/city/event. `.strict()` odrzuca dodatkowe pola.
- `SearchBooksQuerySchema` — brak filtrów zakupowych.
- Confirm endpoint (`confirm.ts`) pobiera `photo.shelf_id` ale NIE czyta purchase_*.
- `confirm-batch.ts` i `correct.ts` — analogicznie, nie propagują purchase info.
- `BookModal` — brak sekcji zakupu; `purchase_date` niewidoczny w edit mode.
- Najwyższy numer migracji na main: 0025 → następna: **0026**.

## Desired End State

- Każda książka w katalogu ma opcjonalne pola: `purchase_date`, `purchase_price` (PLN),
  `purchase_city`, `purchase_event` — edytowalne w BookModal (edit + add mode).
- Na stronie `/photos/[id]` widoczna sekcja „Informacje o zakupie tej partii": date/city/event;
  zapis PATCH do `photos`; przy każdym confirm/correct kopiowane do books.
- `/library` filtruje po: wydarzeniu (dropdown unikalnych wartości), mieście (freetext),
  zakresie dat zakupu, zakresie ceny.
- `books.search_text` obejmuje purchase_city i purchase_event (q= w search).
- Autocomplete w BookModal i PhotoPurchasePanel oparty o GET /api/books/purchase-hints.

### Key Discoveries

- `books_search_text` trzeba przebudować (DROP column → DROP function → new function → ADD
  column) — identyczny wzorzec jak w 0019_books_description_search.sql.
- `UpdatePhotoSchema` (src/lib/photos/schema.ts:17) ma `.object({ shelf_id })` — rozszerzamy
  to samo pole o opcjonalne purchase_*.
- confirm.ts:74-76 fetches `photo.shelf_id` — wystarczy dorzucić `purchase_date, purchase_city,
  purchase_event` do SELECT, wtedy wchodą do books INSERT.
- confirm-batch.ts i correct.ts RÓWNIEŻ tworzą books rows → muszą dostać tę samą propagację.
- `CatalogBookDTO` = `ShelfBookDTO & { shelf_id, shelf_name, spine_color }` — rozszerzamy
  ShelfBookDTO o nowe pola, żeby dotarły do BookCard/CatalogSearchIsland.

## What We're NOT Doing

- Wielowalutowość — price jest zawsze PLN.
- Wiele zakupów per-książka (relacja 1:N, osobna tabela) — zostaje 1 rekord na books.
- Propagacja ceny ze zdjęcia do książek (cena jest indywidualna per-książka).
- Panel statystyk wydatków / timeline zakupów (scope na późniejszy slice).
- Eksport CSV z danymi zakupu.
- M8 `purchase-add-book-merge` — ten slice jest prerequisite; M8 planowany po merge.

## Implementation Approach

Cztery fazy w kolejności zależności: DB schema → API → BookModal UI → Photo panel + filtry.
Każda faza ma swój atomic commit. Migracja jest jedna (0026) obejmująca zarówno books jak
i photos, żeby books_search_text rebuild był jednorazowy.

## Critical Implementation Details

- **search_text rebuild**: `GENERATED ALWAYS ... STORED` nie da się ALTER-ować in-place.
  Sekwencja w migracji: `DROP COLUMN search_text` → `DROP FUNCTION books_search_text(text,
  text[], text, text)` → `CREATE FUNCTION` (6 args, +purchase_city, +purchase_event DEFAULT
  NULL) → `ADD COLUMN purchase_price`, `purchase_city`, `purchase_event` do books →
  `ADD COLUMN search_text GENERATED ALWAYS AS (books_search_text(title, authors, publisher,
  description, purchase_city, purchase_event)) STORED`. Kolejność krytyczna — DROP COLUMN
  przed DROP FUNCTION (zależność FK-like).

- **Confirm propagation**: confirm.ts:74-76 już robi SELECT na photos. Wystarczy dorzucić
  `purchase_date, purchase_city, purchase_event` do pola select, a potem przekazać do books
  INSERT (pola nullable = brak info zakupu gdy NULL). Ten sam wzorzec dla confirm-batch.ts
  i correct.ts — oba też tworzą books rows z photo context.

---

## Phase 1: Migracja DB — books + photos purchase columns

### Overview

Dodaje kolumny purchase do books i photos, przebudowuje search_text (include purchase_city/event).

### Changes Required:

#### 1. Nowa migracja 0026

**File**: `supabase/migrations/0026_book_purchase_metadata.sql`

**Intent**: Rozszerzyć books o purchase_price/city/event, przebudować search_text GENERATED
COLUMN (include purchase_city i purchase_event), dodać purchase_date/city/event do photos.

**Contract**: Sekwencja DROP/CREATE wzorowana na 0019 (books_description_search); funkcja
6-arg IMMUTABLE; wszystkie nowe kolumny nullable; `IF NOT EXISTS` / `IF EXISTS` do idempotencji
dla retry:

```sql
-- 1. Drop generated column first (depends on function)
ALTER TABLE books DROP COLUMN IF EXISTS search_text;
DROP FUNCTION IF EXISTS books_search_text(text, text[], text, text);

-- 2. Rebuild helper with purchase_city + purchase_event
CREATE FUNCTION books_search_text(
  p_title text, p_authors text[], p_publisher text, p_description text,
  p_purchase_city text DEFAULT NULL, p_purchase_event text DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(
    coalesce(p_title,'') || ' ' || array_to_string(coalesce(p_authors,'{}'),' ') || ' ' ||
    coalesce(p_publisher,'') || ' ' || coalesce(p_description,'') || ' ' ||
    coalesce(p_purchase_city,'') || ' ' || coalesce(p_purchase_event,'')
  );
$$;

-- 3. New book columns
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS purchase_city  text,
  ADD COLUMN IF NOT EXISTS purchase_event text;

-- 4. Regenerate search_text (backfill: purchase_city/event = NULL → no change in content)
ALTER TABLE books ADD COLUMN search_text text
  GENERATED ALWAYS AS (
    books_search_text(title, authors, publisher, description, purchase_city, purchase_event)
  ) STORED;

-- 5. Photo purchase info (propagated to books on confirm)
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS purchase_date  date,
  ADD COLUMN IF NOT EXISTS purchase_city  text,
  ADD COLUMN IF NOT EXISTS purchase_event text;
```

#### 2. Regeneracja typów DB

**File**: `src/lib/db/database.types.ts`

**Intent**: Odzwierciedlić nowe kolumny w typach TypeScript. Plik jest generowany przez
`supabase gen types typescript --linked`.

**Contract**: Lokalna Supabase niedostępna w branchu (WSL AV-block + migracja idzie na prod
po merge) → ręczna edycja typów: dodać `purchase_price`, `purchase_city`, `purchase_event` do
`books.Row/Insert/Update`; dodać `purchase_date`, `purchase_city`, `purchase_event` do
`photos.Row/Insert/Update`. Flaga w komentarzu `// ręczna edycja — regeneruj po db push`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run typecheck` przechodzi (nowe pola w database.types.ts znane kompilatorowi)
- [ ] `npm run lint` zielony
- [ ] `npm run test` zielony (brak regresji — migration nie jest testowana w unit)
- [ ] Plik `supabase/migrations/0026_book_purchase_metadata.sql` istnieje i jest poprawny SQL (review)

#### Manual Verification:

- [ ] (user) `supabase migration up --local` na lokalnym stacku wykonuje się bez błędu; `SELECT purchase_price, purchase_city, purchase_event FROM books LIMIT 1;` nie rzuca błędu; `SELECT purchase_date, purchase_city, purchase_event FROM photos LIMIT 1;` też OK

---

## Phase 2: Warstwa API

### Overview

Rozszerza schematy Zod, endpointy PATCH books/photos, confirm/batch/correct propagację,
nowy endpoint purchase-hints, filtry search.

### Changes Required:

#### 1. Schematy books — nowe pola

**File**: `src/lib/books/schema.ts`

**Intent**: Rozszerzyć `UpdateBookSchema` o purchase_price/city/event; dodać do
`ShelfBookDTO` / `CatalogBookDTO`; rozszerzyć `SearchBooksQuerySchema` o filtry zakupowe.

**Contract**:
- `UpdateBookSchema`: dodać opcjonalne nullable pola:
  ```
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
  purchase_price: z.number().min(0).max(99999.99).nullable().optional()
  purchase_city:  z.string().max(200).nullable().optional()
  purchase_event: z.string().max(200).nullable().optional()
  ```
- `ShelfBookDTO`: dodać `purchase_date: string | null`, `purchase_price: number | null`,
  `purchase_city: string | null`, `purchase_event: string | null`.
- `SearchBooksQuerySchema`: dodać
  ```
  purchase_event:    z.string().max(200).optional()
  purchase_city:     z.string().max(200).optional()
  purchase_date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  purchase_date_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  purchase_price_min: z.coerce.number().min(0).optional()
  purchase_price_max: z.coerce.number().min(0).optional()
  ```

#### 2. Schemat photos — purchase fields

**File**: `src/lib/photos/schema.ts`

**Intent**: Rozszerzyć `UpdatePhotoSchema` o opcjonalne purchase_date/city/event.

**Contract**: `UpdatePhotoSchema` staje się `z.object({ shelf_id: z.uuid().optional(), ... })` —
shelf_id teraz opcjonalne (żeby PATCH mógł aktualizować tylko purchase info bez shelf_id).
Dodać:
```
purchase_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
purchase_city:  z.string().max(200).nullable().optional()
purchase_event: z.string().max(200).nullable().optional()
```
Uwaga: empty PATCH (żadne pole nie podane) = no-op, 200 bez efektu — brak `.refine`. Zgodne
z REST PATCH semantics i prostsze w obsłudze po stronie klienta.

#### 3. PATCH /api/books/[id] — pass-through nowych pól

**File**: `src/pages/api/books/[id].ts`

**Intent**: Przepuścić purchase_price/city/event/date do UPDATE w Supabase gdy podane w body.

**Contract**: Endpoint po walidacji przez UpdateBookSchema buduje `updateData` object
z pól które są defined. Dodać nowe pola do tego object-building wzorca (identycznie jak
`cover_url`, `title` etc.). Null → czyści pole. Brak pola (undefined) → nie dotyka.

#### 4. PATCH /api/photos/[id] — purchase info na zdjęciu

**File**: `src/pages/api/photos/[id].ts`

**Intent**: Rozszerzyć PATCH endpoint o przyjmowanie i zapis purchase_date/city/event
na wierszu photos.

**Contract**: Handler w photos/[id].ts:366 hardkoduje `.update({ shelf_id: parsed.data.shelf_id })`.
Gdy shelf_id opcjonalne, musi być dynamiczne budowanie update object:
```ts
const patch: Record<string, unknown> = {};
if (parsed.data.shelf_id !== undefined) patch.shelf_id = parsed.data.shelf_id;
if (parsed.data.purchase_date !== undefined) patch.purchase_date = parsed.data.purchase_date;
if (parsed.data.purchase_city !== undefined) patch.purchase_city = parsed.data.purchase_city;
if (parsed.data.purchase_event !== undefined) patch.purchase_event = parsed.data.purchase_event;
```
Null w polu → czyści wartość w DB. Undefined (pole nie przesłane) → nie dotyka. Istniejący
guard „auth + photo ownership" (RLS) bez zmian.

#### 5. Confirm/batch/correct — propagacja purchase info ze zdjęcia

**Files**: `src/pages/api/detections/[id]/confirm.ts`,
`src/pages/api/photos/[id]/confirm-batch.ts`,
`src/pages/api/detections/[id]/correct.ts`

**Intent**: Gdy books INSERT, skopiować purchase_date/city/event z `photos` row do `books`.

**Contract**: W confirm.ts linia 74-76 SELECT na photos już pobiera `shelf_id`. Rozszerzyć
SELECT o `purchase_date, purchase_city, purchase_event`. Przy INSERT do books dodać te trzy
pola warunkowo (jeśli non-null). Identyczny wzorzec dla confirm-batch (photos SELECT jest
na początku pętli) i correct (też pobiera photo_id → shelf_id).

#### 6. GET /api/books/purchase-hints

**File**: `src/pages/api/books/purchase-hints.ts` (nowy)

**Intent**: Zwrócić unikalne wartości purchase_event lub purchase_city usera do autocomplete
w BookModal i PhotoPurchasePanel.

**Contract**:
```
GET /api/books/purchase-hints?type=event   → { data: { hints: string[] } }
GET /api/books/purchase-hints?type=city    → { data: { hints: string[] } }
```
Query: `SELECT DISTINCT purchase_event FROM books WHERE user_id = auth.uid() AND
purchase_event IS NOT NULL ORDER BY purchase_event LIMIT 50`.
Schema: `z.object({ type: z.enum(['event', 'city']) })`. 401 dla niezalogowanego.
`export const prerender = false`.

#### 7. GET /api/books/search — filtry zakupowe

**File**: `src/pages/api/books/search.ts`

**Intent**: Zastosować nowe filtry purchase_event/city/date_from/to/price_min/max do query SQL.

**Contract**: W Step 2 (books query) dodać warunki:
- `purchase_event`: `.eq('purchase_event', val)` (exact match z dropdown)
- `purchase_city`: `.ilike('purchase_city', '%' + escape(val) + '%')` (zawiera, escape `%_\`)
- `purchase_date_from` / `purchase_date_to`: `.gte('purchase_date', from)` / `.lte('purchase_date', to)`
- `purchase_price_min` / `purchase_price_max`: `.gte('purchase_price', min)` / `.lte('purchase_price', max)`
Rozszerzyć SELECT books (Step 2) o `purchase_date, purchase_price, purchase_city, purchase_event`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run typecheck` — brak błędów typów w zmienionych plikach
- [ ] `npm run lint` — zielony
- [ ] `npm run test` — unit testy search/books API zielone (zaktualizować mocki o nowe pola)
- [ ] `curl -s GET /api/books/purchase-hints?type=event` na running dev zwraca `{ data: { hints: [] } }` (lokalny dev, auth cookie)

#### Manual Verification:

- [ ] (user) PATCH /api/books/[id] z `{ purchase_price: 29.99, purchase_city: "Kraków" }` → Supabase Studio pokazuje zaktualizowany wiersz
- [ ] (user) PATCH /api/photos/[id] z `{ purchase_city: "Warszawa", purchase_event: "Targi Książki" }` → photos row zaktualizowany
- [ ] (user) Confirm detekcji ze zdjęcia gdzie photo.purchase_city != NULL → books row ma purchase_city ustawione

---

## Phase 3: BookModal — sekcja „Informacje o zakupie"

### Overview

Dodaje collapsible sekcję do BookModal (edit i add mode) z polami date/price/city/event.
Autocomplete city/event z purchase-hints. Zapis przez istniejący PATCH /api/books/[id].

### Changes Required:

#### 1. PurchaseSection komponent

**File**: `src/components/PurchaseSection.tsx` (nowy)

**Intent**: Reużywalny kontrolowany komponent z 4 polami zakupu: date (input type=date),
price (input type=number, suffix „zł"), city (input text + datalist autocomplete), event
(input text + datalist autocomplete). Przyjmuje hints[] z rodzica (jedno pobranie na mount).

**Contract**: Props:
```ts
interface PurchaseSectionProps {
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseCity: string | null;
  purchaseEvent: string | null;
  cityHints: string[];
  eventHints: string[];
  onChange: (patch: { purchaseDate?: string|null; purchasePrice?: number|null;
                       purchaseCity?: string|null; purchaseEvent?: string|null }) => void;
  disabled?: boolean;
}
```
Collapsible z `<details><summary>Informacje o zakupie</summary>...`. `datalist` dla city i event.

#### 2. BookModal — integracja PurchaseSection

**File**: `src/components/BookModal.tsx`

**Intent**: Rozszerzyć `BookModalBook` o purchase pola; w edit mode załadować je z book data;
w add i edit mode wyrenderować `<PurchaseSection>` w scrollable body; przy save dorzucić
do payload PATCH.

**Contract**:
- `BookModalBook` type (linia ~23-42): dodać `purchase_date`, `purchase_price`, `purchase_city`,
  `purchase_event` (wszystkie `string | null` lub `number | null`).
- Stan lokalny: dodać `purchaseDate`, `purchasePrice`, `purchaseCity`, `purchaseEvent`.
- Fetch hints: `useEffect` na mount — dwa GET /api/books/purchase-hints (event + city),
  wyniki do `cityHints[]` i `eventHints[]` state.
- Save handler: dorzucić purchase pola do PATCH body (undefined gdy nie zmienione).
- `<PurchaseSection>` wstawić po `<BookFields>` w scrollable body, w obu mode (add + edit).

### Success Criteria:

#### Automated Verification:

- [ ] `npm run typecheck` — BookModal.tsx bez błędów
- [ ] `npm run lint` — zielony
- [ ] `npm run test` — unit testy BookModal jeśli istnieją; brak regresji

#### Manual Verification:

- [ ] (user) BookModal w trybie edit pokazuje sekcję „Informacje o zakupie" z 4 polami
- [ ] (user) Autocomplete podpowiada wartości z GET /api/books/purchase-hints
- [ ] (user) Zapis → books row w Studio ma nowe wartości; ponowne otwarcie modalu pokazuje zapisane dane
- [ ] (user) Add mode: dodanie książki z ceną/miastem → wiersz w books z purchase_price/city/event

---

## Phase 4: Photo review panel + filtry biblioteki + E2E

### Overview

Dodaje `PhotoPurchasePanel` na stronie /photos/[id] (sekcja nad detekcjami), rozszerza
`CatalogSearchIsland` o filtry zakupowe i pisze testy E2E.

### Changes Required:

#### 1. PhotoPurchasePanel komponent

**File**: `src/components/PhotoPurchasePanel.tsx` (nowy)

**Intent**: Panel wyświetlany na /photos/[id] nad listą detekcji. Pokazuje pola
purchase_date/city/event dla zdjęcia (NIE ceny). Ładuje istniejące wartości z photo data.
Auto-zapisuje (debounced 600ms) przez PATCH /api/photos/[id].

**Contract**:
- Props: `photoId: string; initialPurchaseDate: string|null; initialCity: string|null;
  initialEvent: string|null; cityHints: string[]; eventHints: string[]`.
- UI: `<details><summary>Informacje o zakupie tej partii</summary>...` + helper text
  „Data, miasto i wydarzenie zostaną skopiowane do każdej zatwierdzonej książki ze zdjęcia."
- Debounce 600ms → `PATCH /api/photos/[photoId]` z `{ purchase_date, purchase_city, purchase_event }`.
- Pokazuje feedback „Zapisano" (2s) po PATCH 200.
- Hints fetch: props z rodzica (photos/[id].astro może nie znać hints → fetch w useEffect).

#### 2. Integracja PhotoPurchasePanel na stronie photo review

**File**: `src/pages/photos/[id].astro`

**Intent**: Wstawić `<PhotoPurchasePanel client:load>` nad `<DetectionReview client:load>`.
Przekazać initial values z photos row (serwer-side fetch, SSR, RLS-respecting supabase).

**Contract**: W server-side fetch (Astro frontmatter) rozszerzyć SELECT na photos o
`purchase_date, purchase_city, purchase_event`. Wstawić `<PhotoPurchasePanel>` między
breadcrumb + header a `<DetectionReview>`. Props: `photoId`, `initialPurchaseDate`,
`initialCity`, `initialEvent` (ze zdjęcia) + ewentualne hints (opcjonalnie jako async).

#### 3. CatalogSearchIsland — nowe filtry zakupowe

**File**: `src/components/CatalogSearchIsland.tsx`

**Intent**: Dodać 4 nowe elementy filtrowania: dropdown Wydarzenie (z hints), pole Miasto
(text freetext), zakres dat zakupu (od/do), zakres ceny (min/max).

**Contract**:
- Nowy state: `purchaseEvent: string`, `purchaseCity: string`, `purchaseDateFrom: string`,
  `purchaseDateTo: string`, `purchasePriceMin: string`, `purchasePriceMax: string`.
- Fetch hints `event` na mount → `eventHints[]` do dropdown `<select>` (+ opcja pusta „Wszystkie").
- Budowanie URL: dodać nowe query params do `URLSearchParams` przy każdej zmianie filtra.
- **useEffect deps**: dodać wszystkie 6 nowych state vars (`purchaseEvent`, `purchaseCity`,
  `purchaseDateFrom`, `purchaseDateTo`, `purchasePriceMin`, `purchasePriceMax`) do dependency
  array efektu `runSearch` — bez tego zmiana filtra nie wywoła search.
- UI: nowa sekcja „Zakup" pod istniejącymi filtrami (zamykana `<details>`) — Wydarzenie
  dropdown, Miasto text, Data od/do (date inputs), Cena min-max (number inputs).

#### 4. E2E testy

**File**: `tests/e2e/book-purchase.spec.ts` (nowy)

**Intent**: Pokryć: (a) PhotoPurchasePanel saves → confirm propagates; (b) BookModal edit
purchase section; (c) library filters.

**Contract**: Plik z `test.describe.serial`. Mockować PATCH /api/photos/[id], GET hints,
PATCH /api/books/[id], GET /api/books/search (z `page.route`). Scenariusze:
1. `panel na photo page: ustawia city/event → PATCH wywołany z właściwymi danymi`
2. `confirm detekcji: purchase info pojawia się w book (mock confirm response)`
3. `BookModal edit: wypełnia purchase fields → PATCH books z tymi polami`
4. `library filter event: dropdown zmienia wartość → search request ma purchase_event param`
5. `library filter price range: min/max → search request ma purchase_price_min/max`

### Success Criteria:

#### Automated Verification:

- [ ] `npm run typecheck` — zielony
- [ ] `npm run lint` — zielony
- [ ] `npm run test` — unit zielone (brak regresji)
- [ ] `npm run test:e2e` — nowy spec `book-purchase.spec.ts` przechodzi (5 scenariuszy)

#### Manual Verification:

- [ ] (user) Na /photos/[id] widoczna sekcja „Informacje o zakupie tej partii"; wpisanie miasto → zapisuje na hover; Studio pokazuje photo.purchase_city
- [ ] (user) Confirm książki ze zdjęcia gdzie photo.purchase_city = „Kraków" → books.purchase_city = „Kraków"
- [ ] (user) /library: Filtr Wydarzenie dropdown ładuje unikalne wartości z bazy
- [ ] (user) /library: Filtr Miasto freetext filtruje wyniki; zakres dat/ceny filtruje poprawnie

---

## Testing Strategy

### Unit Tests

- `UpdateBookSchema` — walidacja nowych pól (min 0 dla price, format daty, null clearing)
- `SearchBooksQuerySchema` — nowe query params
- search.ts — SQL filter logic dla każdego nowego parametru (mockowany Supabase)
- purchase-hints.ts — 401, 400 (bad type), 200 (mocked DISTINCT)

### E2E

- `tests/e2e/book-purchase.spec.ts` — 5 scenariuszy (Phase 4)
- Wszystkie `page.route` mocks — zero real DB hits w E2E.

### Manual Testing Steps

1. `supabase migration up --local` (lub walidacja na prod po merge)
2. PATCH book z purchase_price = 49.99, purchase_city = „Kraków" → Studio
3. Wgraj nowe zdjęcie; ustaw city/event w panelu; Confirm → book.purchase_city = wartość
4. /library: filter po wydarzeniu, mieście, zakresie dat, zakresie ceny

## Migration Notes

- Migracja 0026 jest atomowa (jeden plik). Na prod idzie po merge przez `deploy.yml` → `supabase db push`.
- Rebuild `search_text` GENERATED STORED przelicza wszystkie istniejące books rows przy ADD COLUMN
  (darmowy backfill; purchase_city/event = NULL → nie zmienia treści search_text dla istniejących).
- Lokalny stack: `supabase migration up --local` lub `supabase db push --local`.
  NIE `supabase db reset` (niszczy dane).
- Ręczna edycja `database.types.ts` zamiast generowania — typ jest generowany bez żywej DB.
  Po merge i `db push` na prod → `supabase gen types typescript --linked` i commit aktualizacji.

## References

- `supabase/migrations/0019_books_description_search.sql` — wzorzec rebuild search_text
- `src/lib/books/schema.ts` — UpdateBookSchema, SearchBooksQuerySchema, ShelfBookDTO
- `src/lib/photos/schema.ts` — UpdatePhotoSchema
- `src/pages/api/detections/[id]/confirm.ts` — wzorzec propagacji (photo → book)
- `src/pages/api/books/search.ts` — 2-step query pattern
- `src/components/BookModal.tsx` — miejsce integracji PurchaseSection
- `src/pages/photos/[id].astro` — miejsce integracji PhotoPurchasePanel
- `context/changes/purchase-add-book-merge/` — następny slice (prerequisite zależność)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migracja DB

#### Automated

- [x] 1.1 `npm run typecheck` przechodzi po ręcznej edycji database.types.ts — 236d782
- [x] 1.2 `npm run lint` zielony — 236d782
- [x] 1.3 `npm run test` zielony (brak regresji) — 236d782
- [x] 1.4 Plik `supabase/migrations/0026_book_purchase_metadata.sql` istnieje i jest poprawny SQL (review) — 236d782

#### Manual

- [x] 1.5 (user) `supabase migration up --local` bez błędu; SELECT purchase_price FROM books i purchase_date FROM photos bez błędu — 236d782

### Phase 2: Warstwa API

#### Automated

- [x] 2.1 `npm run typecheck` — brak błędów typów
- [x] 2.2 `npm run lint` — zielony
- [x] 2.3 `npm run test` — unit testy search/books API zielone
- [x] 2.4 GET /api/books/purchase-hints?type=event na dev zwraca `{ data: { hints: [] } }`

#### Manual

- [x] 2.5 (user) PATCH /api/books/[id] z purchase_price + purchase_city → Studio pokazuje wartości
- [x] 2.6 (user) PATCH /api/photos/[id] z purchase_city + purchase_event → photos row zaktualizowany
- [x] 2.7 (user) Confirm detekcji → books.purchase_city skopiowane ze zdjęcia

### Phase 3: BookModal purchase section

#### Automated

- [ ] 3.1 `npm run typecheck` — BookModal.tsx bez błędów
- [ ] 3.2 `npm run lint` — zielony
- [ ] 3.3 `npm run test` — brak regresji

#### Manual

- [ ] 3.4 (user) BookModal edit pokazuje sekcję z 4 polami; autocomplete podpowiada wartości
- [ ] 3.5 (user) Zapis w BookModal → books.purchase_price/city/event w Studio
- [ ] 3.6 (user) Add mode z ceną/miastem → wiersz books z tymi polami

### Phase 4: Photo review panel + filtry biblioteki + E2E

#### Automated

- [ ] 4.1 `npm run typecheck` — zielony
- [ ] 4.2 `npm run lint` — zielony
- [ ] 4.3 `npm run test` — brak regresji
- [ ] 4.4 `npm run test:e2e` — book-purchase.spec.ts 5/5 zielone

#### Manual

- [ ] 4.5 (user) Panel na /photos/[id] widoczny; wpis miasto → Studio pokazuje photo.purchase_city
- [ ] 4.6 (user) Confirm ze zdjęcia → books.purchase_city propagowane
- [ ] 4.7 (user) /library filter Wydarzenie dropdown ładuje unikalne wartości
- [ ] 4.8 (user) /library filtry miasto/daty/ceny filtrują poprawnie
