# Add Purchase Flow (S-06) Implementation Plan

## Overview

Flow B: użytkownik dodaje zakup na wirtualną półkę „Zakupione" — ręcznie (tytuł + autor + opcjonalna data, domyślnie dziś) lub przez zdjęcie stosu (deleguje do istniejącego pipeline'u S-03→S-05). Ręczna ścieżka ≤ 90 s. Drugi z dwóch równo-ważonych momentów PRD (US-02), po domknięciu Flow A w S-05.

## Current State Analysis

- **„Zakupione"** tworzona przy signup (`0003_handle_new_user.sql`), identyfikowana po `name='Zakupione'` (NIE kolumna `is_system` — computed na endpoincie). Brak server-side helpera → endpoint query po nazwie (RLS-scoped, 0004 hard-lock gwarantuje unikalność).
- **Brak ścieżki tworzenia książki bez detekcji** — `confirmDetectionToCatalog` (`src/lib/books/confirm.ts`) jest detection-bound (guard `detection.status`, `shelf_entries.photo_id/detection_id`, corrections keyed by detection). Flow B manual NIE ma zdjęcia → potrzebny świeży `POST /api/books`.
- **`books` bez `purchase_date`** (ostatnia migracja 0009) → migracja 0010.
- **Upload**: shelf wybierany client-side w `PhotoUploader`, auto-select `list[0]`; `/api/shelves` sortuje „Zakupione" first → już domyślnie pierwsza. Brak obsługi `?shelf=` param.
- **Entry pointy**: header nav w `Layout.astro` (`nav-shelves`, `nav-upload`); brak globalnego „Dodaj zakup".
- **Schematy**: `src/lib/books/schema.ts` (S-05 Confirm/Correct/Batch). DTO też tam.

## Desired End State

Z każdego widoku (header) „Dodaj zakup" → strona `/purchase` z wyborem metody: **ręcznie** (formularz: tytuł wymagany, autor, data zakupu domyślnie dziś, opcjonalnie wydawnictwo/rok/ISBN) → `POST /api/books` → książka na „Zakupione" (`source='manual'`, `is_read=false`, `purchase_date`) → redirect na półkę; **zdjęcie** → link do `/upload?shelf=<zakupione>` (istniejący pipeline). Ręczna ścieżka ≤ 90 s.

## What We're NOT Doing

- **purchase_date dla ścieżki zdjęcia** — photo-path deleguje do S-03→S-05 confirm (nie niesie intencji zakupu); książki lądują na Zakupione z `purchase_date=NULL`. Auto-data tylko dla manual entry. (FR-028 „default dziś" realizujemy dla ręcznej ścieżki; przeniesienie daty przez pipeline rozpoznawania odroczone.)
- **Wyświetlanie purchase_date** — S-06 zapisuje datę; render (na karcie/szczegółach) odroczony do book-detail / S-08.
- **Telemetria Flow B manual** — `corrections` jest detection-bound; ręczny zakup bez detekcji nie jest „korektą" → brak wiersza corrections.
- **Move z Zakupione** — to S-07 (historia lokalizacji).

## Critical Implementation Details

- **purchase_date default**: kolumna nullable (bez DB default); endpoint przy manual entry ustawia dziś (`new Date().toISOString().slice(0,10)`) gdy pole pominięte — `new Date()` jest OK w Workers runtime (blokada dotyczy tylko workflow scripts). Jawnie podany NULL niemożliwy (Zod: pominięte → today).
- **Zakupione resolution**: nowy helper `getPurchasedShelfId(supabase)` w `src/lib/shelves/purchased.ts` — query `shelves` po `name` z `PURCHASED_SHELF_NAME` const (dedupe literału z `RESERVED_NAMES`). RLS scope-uje do usera; `maybeSingle()`; brak → 500 (Zakupione zawsze istnieje po signup — brak = stan nieoczekiwany).
- **exact-dup**: manual entry z `isbn_13` już w katalogu → 409 CONFLICT (mirror wzorca z `confirm.ts`); pre-check + 23505 backstop.

## Phase 1: Substrat — migracja 0010 + schema + helper

### Changes Required:

**File**: `supabase/migrations/0010_books_purchase_date.sql` — `alter table books add column purchase_date date;` (nullable).

**File**: `src/lib/db/database.types.ts` — dopisz `purchase_date: string | null` do books Row + `purchase_date?: string | null` Insert/Update (ręczny dopis — lokalny stack AV-blocked).

**File**: `src/lib/books/schema.ts` — `AddPurchaseSchema` (`.strict()`): `title` min1 max300 wymagany; `authors` opcjonalne array; `publisher` opcjonalne max200; `published_year` opcjonalne int 1000–2100; `isbn_13` opcjonalne `/^\d{13}$/`; `isbn_10` opcjonalne `/^\d{9}[\dX]$/`; `purchase_date` opcjonalne `z.string()` ISO date (`YYYY-MM-DD`). `AddPurchaseInput` type.

**File**: `src/lib/shelves/purchased.ts` (nowy) — `PURCHASED_SHELF_NAME = 'Zakupione'` const + `getPurchasedShelfId(supabase): Promise<string | null>`.

### Success Criteria:
#### Automated:
- Migracja 0010 parsuje się czysto
- Unit: AddPurchaseSchema (valid minimal title-only, pełny, invalid: brak title, zły isbn, zła data, extra field przez .strict)
- Typecheck / lint / build zielone
#### Manual:
- (deferred post-merge) Studio: `books.purchase_date` kolumna widoczna

## Phase 2: Endpoint POST /api/books

### Changes Required:

**File**: `src/pages/api/books/index.ts` (nowy) — `POST`. 401 guard; Zod `AddPurchaseSchema`; resolve Zakupione przez `getPurchasedShelfId` (brak → 500); exact-dup po `isbn_13` (jeśli podany) → 409 CONFLICT; insert `books` (`user_id`, pola, `source='manual'`, `purchase_date = input ?? today`); insert `shelf_entries` (shelf=Zakupione, `position_index = max+1`, `photo_id=null`, `detection_id=null`, `is_current=true`) — przy porażce rollback książki (wzorzec F1 z S-05); 23505 backstop → 409. Zwraca `{ data: { book_id, shelf_id } }` status 201.

### Success Criteria:
#### Automated:
- Unit: 401, 400 (brak title / zły isbn / extra field), 201 (book+shelf_entry na Zakupione, source=manual, purchase_date default today gdy pominięte), 409 (isbn dup), 500 (brak Zakupione / shelf_entries fail→rollback)
- Typecheck / lint / build zielone
#### Manual:
- (deferred) Dev: dodanie ręczne → książka na Zakupione z datą

## Phase 3: UI — /purchase + entry point + upload preset

### Changes Required:

**File**: `src/pages/purchase.astro` (nowy) — auth guard; renderuje `AddPurchaseIsland`.

**File**: `src/components/AddPurchaseIsland.tsx` (nowy) — `client:load`. Toggle metody: **ręcznie** (formularz: title wymagany, author, data zakupu input type=date default dziś, collapsible „więcej": publisher/rok/isbn) → `POST /api/books` → redirect `/shelves/<shelf_id>`; **zdjęcie** → link `/upload?shelf=<zakupione_id>` (fetch id z `/api/shelves` lub przez helper na stronie). 409 → komunikat „Masz już tę książkę". Minimalizm pod KPI ≤90s.

**File**: `src/layouts/Layout.astro` — header nav „Dodaj zakup" (`data-testid="nav-add-purchase"`, href `/purchase`) obok `nav-shelves`/`nav-upload`.

**File**: `src/pages/upload.astro` + `src/components/PhotoUploader.tsx` — odczyt `?shelf=` z searchParams w `upload.astro`, przekaż `presetShelfId` do `PhotoUploader`, seed `selectedShelfId` (override `list[0]` gdy preset obecny i istnieje na liście).

### Success Criteria:
#### Automated:
- Component test AddPurchaseIsland: render toggle; manual submit → POST /api/books z polami + redirect; 409 → komunikat; photo toggle → link z shelf param
- Typecheck / lint / build zielone
#### Manual:
- (deferred) Dev: „Dodaj zakup" z headera → ręczne dodanie ≤90s; zdjęcie → upload z Zakupione preselected

## Phase 4: E2E golden path

**File**: `tests/e2e/add-purchase-flow.spec.ts` (nowy) — mock `page.route`: `POST /api/books` → 201, `GET /api/shelves/[id]/books` → książka. Scenariusz: header „Dodaj zakup" → /purchase → ręczny formularz (title+author+data) → submit → redirect na Zakupione → książka widoczna. Plus: toggle metody zdjęcie pokazuje link do upload.

### Success Criteria:
#### Automated:
- E2E spec zielony (mock); typecheck/lint zielone
#### Manual:
- (deferred post-merge) pełny manual smoke Flow B na prod

## Progress

### Phase 1: Substrat
#### Automated
- [ ] 1.1 Migracja 0010 parsuje się czysto
- [ ] 1.2 Unit AddPurchaseSchema (valid/invalid)
- [ ] 1.3 Typecheck zielony
- [ ] 1.4 Lint zielony
- [ ] 1.5 Build zielony
#### Manual
- [ ] 1.6 Studio: books.purchase_date widoczna (post-merge)

### Phase 2: Endpoint POST /api/books
#### Automated
- [ ] 2.1 Unit: 401/400/201/409/500 + rollback + purchase_date default today
- [ ] 2.2 Typecheck zielony
- [ ] 2.3 Lint zielony
- [ ] 2.4 Build zielony
#### Manual
- [ ] 2.5 Dev: ręczne dodanie → książka na Zakupione (post-merge)

### Phase 3: UI
#### Automated
- [ ] 3.1 Component AddPurchaseIsland: toggle/manual submit/409/photo link
- [ ] 3.2 Typecheck zielony
- [ ] 3.3 Lint zielony
- [ ] 3.4 Build zielony
#### Manual
- [ ] 3.5 Dev: „Dodaj zakup" z headera ≤90s; upload preset Zakupione (post-merge)

### Phase 4: E2E
#### Automated
- [ ] 4.1 E2E add-purchase-flow spec zielony (mock)
- [ ] 4.2 Typecheck + lint zielone
#### Manual
- [ ] 4.3 Pełny manual smoke Flow B na prod (post-merge + db push)
