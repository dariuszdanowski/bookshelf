# Cofnięcie akceptacji książki (unconfirm) — Implementation Plan

## Overview

Dodanie odwracalności akceptacji w review zdjęcia: nowy endpoint `POST /api/detections/[id]/unconfirm`
+ helper `unconfirmDetectionFromCatalog` (odwrócenie `confirmDetectionToCatalog`) + przycisk
„Cofnij" w widoku potwierdzonym (Karty/Lista/Kafelki). Symetria do istniejącej ścieżki
reject → `unreject`.

## Current State Analysis

- **Accept tworzy 4 zapisy** (`src/lib/books/confirm.ts:57-188`): INSERT `books`, INSERT
  `shelf_entries`, UPDATE `detections.status='confirmed'`, INSERT `corrections (accept)`.
- **Reject ma pełną symetrię cofania**: `unreject.ts` flipuje status `rejected → matched/pending`
  (po count `book_candidates`) i kasuje `corrections.correction_type='reject'`. UI: `RejectedDecidedView`
  (`DetectionReview.tsx`) z przyciskiem „Cofnij" → `handleUndoReject` w `useDetectionDecision`
  → `POST /unreject` → `onUndecided` aktualizuje `decidedIds`/`confirmedIds`.
- **Accept NIE ma cofania**: widok potwierdzony w `DetectionCard`/`DetectionRow`/`DetectionTile`
  jest statyczny (zielony, tytuł + „Dodano do katalogu", bez akcji). `useDetectionDecision`
  nie ma `handleUnconfirm`.
- **FK `shelf_entries.book_id references books(id) on delete cascade`** (`0001_initial_schema.sql:102`):
  skasowanie książki kaskadowo usuwa jej `shelf_entries`. `shelf_entries.detection_id references
  detections(id) on delete set null` (`:106`) — entry wiązany z detekcją przez `detection_id`.
- **Telemetria**: `corrections.detection_id references detections(id) on delete set null` (`:118`).

### Key Discoveries:

- Endpoint-wzorzec do skopiowania: `src/pages/api/detections/[id]/unreject.ts` (status reset +
  telemetry delete; bez body; 404 privacy).
- Helper-wzorzec + jego test: `src/lib/books/confirm.ts` + `tests/unit/lib/books/confirm.test.ts`
  (mock factory łańcucha Supabase per tabela).
- UI-wzorzec cofania: `RejectedDecidedView` + `handleUndoReject` w `DetectionReview.tsx`.
- Reset statusu: count `book_candidates` → `matched`/`pending` (`unreject.ts:47-61`).
- `ApiErrorCode` zawiera już `CONFLICT` (użyte w `confirm.ts:142,158` ze statusem 409).

## Desired End State

W widoku potwierdzonym (3 tryby) jest przycisk „Cofnij". Klik → książka + `shelf_entry`
znikają z katalogu/półki, detekcja wraca do `matched`/`pending`, korekty akceptacji
skasowane, karta wraca do stanu „do decyzji" (kandydaci + Akceptuj/Odrzuć). Re-akceptacja
działa normalnie. Cudza detekcja → 404; nie-confirmed → 409.

## What We're NOT Doing

- Osobny undo dla `confirm-batch` (bulk) — pojedyncze „Cofnij" per detekcja wystarcza; bulk-undo
  poza zakresem.
- Historia „kosza"/restore skasowanych książek.
- Nowy `correction_type='undo_accept'` — kasujemy korektę akceptacji (jak `unreject`), nie dodajemy
  nowego sygnału.
- Zmiana zachowania accept/confirm samego w sobie.

## Implementation Approach

Backend-first: helper czystej logiki (testowalny bez DB) + cienki endpoint, potem UI
podpięte przez `useDetectionDecision`. Bez migracji (operujemy na istniejących tabelach/FK).

## Critical Implementation Details

- **Kolejność delete (RLS-krytyczna)**: usuń `shelf_entries` PRZED `books`. Polityka
  `shelf_entries_delete_own` (`0002_rls_policies.sql:100`) autoryzuje przez `exists(books
  where id=book_id and user_id=auth.uid())` — gdyby książkę skasować pierwszą, RLS-check dla
  entry mógłby nie przejść. Orphan-check (count pozostałych entries) i tak wymaga usunięcia
  entry najpierw.
- **NIE kasować `book_candidates`** detekcji — zostają, by re-akceptacja po cofnięciu działała
  normalną ścieżką `confirm(candidate_id)`.

## Phase 1: Backend — helper + endpoint

### Overview

Odwrócenie `confirmDetectionToCatalog` jako helper + endpoint `POST /unconfirm`, z guardami
i RLS-scope (przez request-scoped `locals.supabase`).

### Changes Required:

#### 1. Helper odwracający confirm

**File**: `src/lib/books/confirm.ts`

**Intent**: Dodać `unconfirmDetectionFromCatalog(supabase, userId, detectionId)` — usuwa wpis
katalogowy utworzony przy akceptacji i przywraca detekcję do edycji. Bez transakcji (każdy krok
retry-safe, jak confirm).

**Contract**: Sygnatura `(supabase: Supabase, userId: string, detectionId: string) => Promise<UnconfirmResult>`
gdzie `UnconfirmResult = { ok: true; status: 'matched' | 'pending' } | { ok: false; reason: 'not_confirmed' | 'not_found' }`.
Kroki: (0) SELECT detection `id,status` — brak → `not_found`; `status!=='confirmed'` → `not_confirmed`.
(1) SELECT `shelf_entries.book_id` WHERE `detection_id=detectionId` (bez filtra `is_current` —
S-15 może togglować flagę przy przenoszeniu książki; szukamy entry po wiązaniu z detekcją).
(2) DELETE `shelf_entries` WHERE `detection_id=detectionId`. (3) Dla każdego zebranego `book_id`:
count pozostałych `shelf_entries` na ten `book_id`; gdy 0 → DELETE `books` WHERE `id=book_id`
(RLS `user_id`; cascade i tak czyści ewentualne resztki). (4) count `book_candidates(detection_id)`
→ UPDATE `detections.status` = `matched`/`pending`. (5) best-effort DELETE `corrections` WHERE
`detection_id=detectionId AND correction_type IN ('accept','field_edit','manual_entry')`.

#### 2. Endpoint unconfirm

**File**: `src/pages/api/detections/[id]/unconfirm.ts` (nowy)

**Intent**: Cienki HTTP-wrapper na helper — auth guard, `parseUuidParam`, mapowanie wyniku na
envelope. Wzorzec skopiowany z `unreject.ts`.

**Contract**: `POST`, bez body. `prerender=false`. 401 gdy brak usera; 404 dla złego UUID /
`not_found`; 409 `CONFLICT` dla `not_confirmed`; 200 `{ data: { status } }` sukces; 500 +
`console.error` na nieoczekiwane. Konsumuje wyłącznie `apiResponse`/`apiError`.

### Success Criteria:

#### Automated Verification:

- Unit helper: pełny happy-path (entry+book usunięte, status reset, korekty skasowane): `npm run test -- confirm`
- Unit helper: guard `not_confirmed` (status≠confirmed → brak DELETE) i `not_found`
- Unit helper: orphan-safety (książka z drugim entry NIE jest kasowana)
- Integration RLS: cudza detekcja nie daje się cofnąć (404, brak mutacji): `npm run test:integration`
- Typecheck/lint/build zielone: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- (brak — czysto serwerowe, pokryte automatami)

---

## Phase 2: UI — przycisk „Cofnij" w widoku potwierdzonym

### Overview

Podpięcie cofania w `useDetectionDecision` i dodanie „Cofnij" do widoku potwierdzonego w
3 trybach prezentacji, symetrycznie do reject.

### Changes Required:

#### 1. Hook decyzji — handleUnconfirm

**File**: `src/components/DetectionReview.tsx` (`useDetectionDecision`)

**Intent**: Dodać `handleUnconfirm` (mirror `handleUndoReject`): `POST /unconfirm` → po sukcesie
`setState('pending')`, `setDecidedKind(null)`, `onUndecided?.(detection.id)`. Eksponować w return hooka.

**Contract**: `handleUnconfirm: () => Promise<void>`; obsługa 409 (komunikat „Nie jest zaakceptowana"),
błędów sieci jak reszta hooka. `onUndecided` już istnieje i czyści `decidedIds`/`confirmedIds`.

#### 2. Widok potwierdzony z „Cofnij" ×3

**File**: `src/components/DetectionReview.tsx` (`DetectionCard`/`DetectionRow`/`DetectionTile`,
gałąź `decidedKind==='confirmed'`)

**Intent**: Dodać przycisk „Cofnij" (busy → „Cofam...") obok etykiety „Dodano do katalogu",
wywołujący `handleUnconfirm`. Zachować pokazany tytuł+autora książki (zaakceptowany kandydat).

**Contract**: `data-testid="undo-confirm-button"` w każdym z 3 widoków; `disabled` podczas `busy`;
spójny styl z `undo-reject-button`.

### Success Criteria:

#### Automated Verification:

- Typecheck/lint/build zielone
- Unit/komponent (jeśli istnieje pokrycie DetectionReview) zielone: `npm run test`
- E2E: akceptuj książkę → „Cofnij" → znika z listy potwierdzonych, wraca jako „do decyzji"
  (mock vision/match): `npm run test:e2e`
- E2E: „Cofnij" przy cudzej/nie-confirmed nie wybucha (graceful)

#### Manual Verification:

- (user-only) Realny flow: dodaj pominiętą → Akceptuj → „Cofnij" → książka znika z półki
  (sprawdź w /shelves/[id]), detekcja wraca do edycji
- (user-only) Re-akceptacja po cofnięciu działa i nie dubluje wpisu

---

## Testing Strategy

### Unit Tests:

- Helper `unconfirmDetectionFromCatalog` (mock Supabase per tabela, wzorzec `confirm.test.ts`):
  happy-path, `not_confirmed`, `not_found`, orphan-safety, status `matched` vs `pending`.

### Integration Tests:

- RLS: user B nie cofa akceptacji detekcji usera A (404, zero mutacji w katalogu A).

### Manual Testing Steps:

1. Akceptuj kandydata → „Cofnij" → karta wraca do „do decyzji", książka znika z `/shelves/[id]`.
2. Cofnij, potem ponów Akceptuj → dokładnie jeden wpis w katalogu (brak duplikatu).
3. Odśwież po cofnięciu → detekcja nadal `matched`/`pending` (trwałość).

## Migration Notes

Brak migracji — operujemy na istniejących tabelach i FK (`on delete cascade` z `shelf_entries`).

## References

- Endpoint-wzorzec: `src/pages/api/detections/[id]/unreject.ts`
- Helper + test: `src/lib/books/confirm.ts`, `tests/unit/lib/books/confirm.test.ts`
- UI-wzorzec: `RejectedDecidedView` + `handleUndoReject` w `src/components/DetectionReview.tsx`
- FK: `supabase/migrations/0001_initial_schema.sql:99-111`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend — helper + endpoint

#### Automated

- [x] 1.1 Unit helper: happy-path (entry+book usunięte, status reset, korekty skasowane) — acd4314
- [x] 1.2 Unit helper: guard `not_confirmed` i `not_found` — acd4314
- [x] 1.3 Unit helper: orphan-safety (książka z drugim entry NIE kasowana) — acd4314
- [x] 1.4 Integration RLS: cudza detekcja → 404, brak mutacji — acd4314
- [x] 1.5 Typecheck / lint / build zielone — acd4314

### Phase 2: UI — przycisk „Cofnij" w widoku potwierdzonym

#### Automated

- [x] 2.1 `handleUnconfirm` w `useDetectionDecision` + eksport w return
- [x] 2.2 Przycisk „Cofnij" (`undo-confirm-button`) w DetectionCard/Row/Tile
- [x] 2.3 Typecheck / lint / build / unit zielone
- [x] 2.4 E2E: akceptuj → Cofnij → wraca do „do decyzji"
- [x] 2.5 E2E: Cofnij przy nie-confirmed/cudzej nie wybucha

#### Manual

- [x] 2.6 (user-only) Realny flow: Akceptuj → Cofnij → książka znika z półki, detekcja wraca
- [x] 2.7 (user-only) Re-akceptacja po cofnięciu nie dubluje wpisu
