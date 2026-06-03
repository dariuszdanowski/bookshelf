# "Wgraj mimo to" vs UNIQUE constraint — Implementation Plan

## Overview

„Wgraj mimo to" oferuje ponowny upload tego samego obrazu, którego partial-unique
index `photos_user_hash_unique (user_id, file_hash_sha256)` kategorycznie zabrania.
Na tej ścieżce upload do Storage zawsze się udaje, a INSERT zawsze pada (23505→409),
produkując gwarantowaną sierotę w Storage + UX ślepy zaułek. Plan usuwa niespójną
afordancję u źródła i dokłada server-side cleanup Storage jako obronę jedynej
pozostałej (niedeterministycznej) ścieżki — prawdziwego race przy uploadzie nowego
obrazu.

Wejście: [frame.md](frame.md) (Confidence: HIGH). Reframe potwierdzony przez usera:
jeden obraz = jedno zdjęcie; oba objawy (sierota + ślepy zaułek) to jeden problem.

## Current State Analysis

- `PhotoUploader.tsx:150-191` — `doUpload`: Storage put (`uploading`) **przed** POST; na 409 `setStage('duplicate'); return` bez cleanup wgranego obiektu.
- `PhotoUploader.tsx:237-251` — `handleUploadAnyway` woła tę samą `doUpload` z `pendingFile/pendingHash`; przycisk `upload-anyway-button` (398-404).
- `index.ts:53-72` — POST `/api/photos`: INSERT `photos`; `23505` → 409 `DUPLICATE_PHOTO`. Ma `storage_path` z body (parsed.data).
- `0013_photo_file_hash.sql:7-9` — partial UNIQUE `(user_id, file_hash_sha256) WHERE not null`.
- `0005_storage_shelf_photos.sql:41-46` — polityka `shelf_photos_delete_own`: zalogowany user usuwa własne obiekty (`folder[1]=auth.uid()`) → cleanup możliwy bez service-role.
- `photo-dedup.spec.ts:106-139` — test „Wgraj mimo to continues upload" mockuje POST→201 (fikcja; w prod 409). Anty-wzorzec #1 M3L4.
- `[id].ts` — tylko GET; photo DELETE nie istnieje → brak drugiego źródła sierot.
- Test files: `tests/unit/pages/api/photos/index.test.ts`, `tests/unit/components/PhotoUploader.test.tsx`.

## Desired End State

- Warning duplikatu pokazuje wyłącznie „Otwórz istniejące" + „Anuluj". Brak „Wgraj mimo to".
- Brak ścieżki UI, która wgrywa obraz, by zaraz dostać 409 → zero deterministycznych sierot.
- Gdy POST zwróci `23505` (race przy nowym obrazie), server kasuje świeżo wgrany obiekt Storage zanim zwróci 409 → zero sierot także na ścieżce race.
- `photo-dedup.spec.ts` testuje realny kontrakt (brak przycisku), nie fikcję.

Weryfikacja: `npm run lint && npm run typecheck && npm run test && npm run test:e2e` zielone; manualnie — upload duplikatu pokazuje tylko Open/Cancel.

### Key Discoveries:

- Cleanup bez service-role możliwy: `0005_storage_shelf_photos.sql:41-46`.
- Server zna `storage_path` przy 23505 (`index.ts:42` parsed.data) → naturalne miejsce cleanup.
- Tylko `doUpload` jest źródłem 409 po usunięciu przycisku — pozostaje wyłącznie race.

## What We're NOT Doing

- Nie ruszamy UNIQUE constraint (user potwierdził: jeden obraz = jedno zdjęcie).
- Nie dodajemy service-role (polityka RLS wystarcza).
- Nie implementujemy photo DELETE / S-29 photos-crud (osobny slice).
- Nie zmieniamy kontraktu odpowiedzi POST (zostaje 409 `DUPLICATE_PHOTO`).
- Nie dotykamy browser-side `check-hash` pre-check (działa poprawnie).

## Implementation Approach

Dwie atomowe fazy. P1 usuwa afordancję (primary, user-visible) + naprawia mylący e2e.
P2 dokłada server-side cleanup test-first (M3L5 red→green) jako obronę ścieżki race.

## Phase 1: Usuń niespójną afordancję „Wgraj mimo to"

### Overview

Eliminacja deterministycznego źródła sieroty + ślepego zaułka: przycisk i ścieżka
force-upload znikają; warning duplikatu zostaje informacyjny (Open/Cancel).

### Changes Required:

#### 1. PhotoUploader — usunięcie ścieżki force-upload

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Usunąć przycisk „Wgraj mimo to" i całą ścieżkę ponownego uploadu duplikatu, bo jest niemożliwa do spełnienia przy UNIQUE constraint. Warning duplikatu (pre-check hit) pozostaje informacyjny z „Otwórz istniejące" + „Anuluj".

**Contract**: Usunąć `upload-anyway-button` (398-404), `handleUploadAnyway` (237-251), stany `pendingFile`/`pendingHash` (47-48) + ich settery w `handleFile` (203-204, 220-221) i `handleCancelDuplicate` (254-255). Zachować `handleCancelDuplicate` (Anuluj) i `open-existing-link`. Ścieżka race-409 w `doUpload` (173-178) zostaje — nadal `setStage('duplicate')` (pokaże generyczny komunikat + Anuluj, bo `duplicatePhotoId=null`).

#### 2. Component test — asercja braku przycisku (net-new, opcjonalny)

**File**: `tests/unit/components/PhotoUploader.test.tsx`

**Intent**: Potwierdzić, że przy wykrytym duplikacie warning nie renderuje „Wgraj mimo to", a renderuje Open/Cancel.

**Contract**: Uwaga (F2): obecny `PhotoUploader.test.tsx` mockuje `check-hash` **zawsze** na `{ photo: null }` — NIE ma testu ścieżki duplikatu, więc to **net-new**, nie update. Primary coverage braku przycisku to e2e (#3). Component test opcjonalny: jeśli dodajemy, to nowy przypadek z `check-hash` → `{ photo: {...} }`, asercja `queryByTestId('upload-anyway-button')` === null + obecne `open-existing-link`/`cancel-duplicate-button`.

#### 3. E2E — przepisać mylący test

**File**: `tests/e2e/photo-dedup.spec.ts`

**Intent**: Test „duplicate: clicking Wgraj mimo to continues upload" (106-139) testuje fikcję (mock POST→201). Zastąpić go asercją realnego kontraktu.

**Contract**: Usunąć test 106-139. W teście „shows warning with date and action buttons" (66-86) dodać asercję, że `upload-anyway-button` **nie** istnieje. Zachować pozostałe (Anuluj, no-duplicate).

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test` (PhotoUploader.test.tsx zielony)
- E2E: `npm run test:e2e` (photo-dedup.spec.ts zielony, bez fikcyjnego testu)

#### Manual Verification:

- Upload duplikatu (znany hash) → warning pokazuje tylko „Otwórz istniejące" + „Anuluj", brak „Wgraj mimo to"
- „Otwórz istniejące" prowadzi do `/photos/<id>`; „Anuluj" wraca do drop-zone

**Implementation Note**: Po automatach pauza na manualne potwierdzenie usera przed Phase 2.

---

## Phase 2: Server-side cleanup sieroty przy kolizji hash (obrona race) — test-first

### Overview

Zamknięcie jedynego pozostałego źródła sieroty (prawdziwy race: dwa współbieżne
uploady nowego obrazu, drugi dostaje 23505 po udanym Storage put). M3L5 red→green.

### Changes Required:

#### 1. RED — test cleanup na 23505 (+ rozszerzenie harnessa)

**File**: `tests/unit/pages/api/photos/index.test.ts`

**Intent**: Najpierw padający test (M3L5): gdy INSERT zwróci `23505`, endpoint woła `storage.from('shelf-photos').remove([storage_path])` i dopiero potem zwraca 409.

**Contract**: `makeContext` mockuje dziś `locals.supabase` jako `{ from }` — BEZ `.storage`. Rozszerzyć helper o `storage: { from: vi.fn(() => ({ remove: removeFn })) }` i wystawić `removeFn` do asercji (F1). Nowy przypadek: insert → błąd `{ code: '23505' }`; assert `removeFn` wołane z `[storage_path]` z body; response 409 `DUPLICATE_PHOTO`. Test pada przed implementacją (#2). **Istniejący test 23505 (170-180) musi dalej przechodzić** — przeżyje dzięki try/catch w #2 nawet bez storage-stuba, ale i tak rozszerzamy `makeContext` współdzielony helper, więc oba mają `.storage`.

#### 2. GREEN — cleanup w endpoint

**File**: `src/pages/api/photos/index.ts`

**Intent**: W gałęzi `error.code === '23505'` skasować świeżo wgrany obiekt Storage zanim zwrócimy 409. Cleanup jest best-effort: jego porażka NIE może zmienić odpowiedzi 409.

**Contract**: Przed `return apiError(... DUPLICATE_PHOTO ...)` (63-64): owinąć w `try/catch` wywołanie `await locals.supabase.storage.from('shelf-photos').remove([storage_path])`; w `catch` `console.error` z payloadem, następnie (i tak) `return` 409 (F1 — try/catch gwarantuje, że błąd/niedostępność storage nie wywraca odpowiedzi). `storage_path` już zwalidowany (45-51, należy do usera → polityka `shelf_photos_delete_own` przejdzie). **Założenie (F3)**: `photos` ma dziś jeden unique index (hash), więc `23505` zawsze = kolizja hash → bezpiecznie kasować świeży obiekt. Przy dodaniu kolejnego unique constraint na `photos` ten cleanup wymaga rewizji (rozróżnić, który constraint pękł).

### Success Criteria:

#### Automated Verification:

- Nowy test pada przed #2, przechodzi po: `npm run test`
- Istniejące testy `index.test.ts` zielone (regresja): `npm run test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Manual Verification:

- (opcjonalnie, trudne do odtworzenia) — race nie zostawia sieroty; w praktyce pokryte testem jednostkowym

**Implementation Note**: Po automatach pauza na manualne potwierdzenie usera.

---

## Testing Strategy

### Unit Tests:

- `index.test.ts`: 23505 → `storage.remove([storage_path])` wołane + 409 (M3L5 red→green)
- `PhotoUploader.test.tsx`: warning duplikatu bez `upload-anyway-button`

### Integration / E2E Tests:

- `photo-dedup.spec.ts`: warning pokazuje Open/Cancel, brak „Wgraj mimo to"; fikcyjny test usunięty

### Manual Testing Steps:

1. Upload duplikatu → warning bez „Wgraj mimo to" (tylko Open/Cancel)
2. „Otwórz istniejące" → `/photos/<id>`; „Anuluj" → drop-zone

## Migration Notes

Brak migracji. Polityka `shelf_photos_delete_own` (0005) już istnieje.

## References

- Frame brief: `context/changes/dedup-force-upload/frame.md`
- `src/components/PhotoUploader.tsx:150-191, 237-251, 398-404`
- `src/pages/api/photos/index.ts:53-72`
- `supabase/migrations/0013_photo_file_hash.sql:7-9`, `0005_storage_shelf_photos.sql:41-46`
- `tests/e2e/photo-dedup.spec.ts:106-139`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Usuń niespójną afordancję „Wgraj mimo to"

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck`
- [x] 1.2 Lint: `npm run lint`
- [x] 1.3 Unit zielony (PhotoUploader.test.tsx): `npm run test`
- [x] 1.4 E2E zielony bez fikcyjnego testu: `npm run test:e2e`

#### Manual

- [x] 1.5 Warning duplikatu pokazuje tylko Otwórz istniejące + Anuluj (brak „Wgraj mimo to")
- [x] 1.6 Otwórz istniejące → /photos/<id>; Anuluj → drop-zone

### Phase 2: Server-side cleanup sieroty przy kolizji hash (test-first)

#### Automated

- [ ] 2.1 Nowy test pada przed implementacją, przechodzi po: `npm run test`
- [ ] 2.2 Istniejące index.test.ts zielone: `npm run test`
- [ ] 2.3 Typecheck: `npm run typecheck`
- [ ] 2.4 Lint: `npm run lint`

#### Manual

- [ ] 2.5 (opcjonalnie) race nie zostawia sieroty — pokryte testem jednostkowym
