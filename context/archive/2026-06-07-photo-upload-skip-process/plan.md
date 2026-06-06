# S-36: Upload bez uruchamiania vision — Implementation Plan

## Overview

Checkbox „Analizuj od razu" w PhotoUploader + ścieżka skip (bez `/process`/`/match`,
bez kosztu) z lądowaniem na tabie Zdjęcia. Backend bez zmian.

## Current State Analysis

- `PhotoUploader` ([src/components/PhotoUploader.tsx](src/components/PhotoUploader.tsx)):
  `doUpload` (L164-205) po POST `/api/photos` zapisuje
  `sessionStorage.upload_resume_photo_id` (L199) i ZAWSZE woła `processPhoto`
  (L201) → `runMatch` → redirect `/photos/{id}`. Recovery-effect (L119-161) wznawia
  pipeline dla zapisanego resume id.
- `POST /api/photos` już zapisuje `status='uploaded'` — obie ścieżki startują tak samo.
- Tab Zdjęcia (S-29, `PhotoListIsland`): stage `uploaded` → akcja „Uruchom vision"
  (L405-413) — ręczny trigger już istnieje, z obsługą 403 NO_API_KEY.
- `ShelfTabs.useShelfTab` ([src/components/ShelfTabs.tsx:30-48](src/components/ShelfTabs.tsx)):
  czyta tylko localStorage — brak obsługi `?tab=` w URL.
- Review (`DetectionReview`) dla `status='uploaded'`: branch `notYetProcessed`
  z przyciskiem „Przetwórz zdjęcie" — działa bez zmian.

### Key Discoveries:

- Pitfall z roadmapy potwierdzony: resume-state (L199) wznowiłby pipeline przy
  następnej wizycie na /upload — przy skip NIE wolno go zapisywać.
- „Analizuj teraz" nie wymaga nowego przycisku — „Uruchom vision" w tabie Zdjęcia
  to dokładnie ta akcja (adaptacja literalna, intent zachowany — zob. change.md).

## What We're NOT Doing

- Zmian w API (zero), rename „Uruchom vision", zmian w review, batch-upload.

## Implementation Approach

Jedna faza, pure UI: checkbox z localStorage + warunkowy pipeline + `?tab=` support.

## Phase 1: checkbox skip + tab param + testy

### Changes Required:

#### 1. PhotoUploader — checkbox + ścieżka skip

**File**: `src/components/PhotoUploader.tsx`

**Intent**: kontrola kosztu — user decyduje, czy upload od razu odpala płatny vision.

**Contract**: stan `autoProcess` (default `true`), init z localStorage
`bookshelf:upload-auto-process`, persist przy zmianie; checkbox
`data-testid="auto-process-checkbox"` przy drop zone z labelką „Analizuj od razu
(vision + match, płatne)". W `doUpload`: gdy `autoProcess` — zachowanie obecne
(resume-state + processPhoto); gdy NIE — **bez** `sessionStorage.setItem`,
`window.location.href = /shelves/{selectedShelfId}?tab=photos`.

#### 2. ShelfTabs — param `?tab=`

**File**: `src/components/ShelfTabs.tsx`

**Intent**: deep-link do konkretnej zakładki (lądowanie po skip-upload).

**Contract**: `useShelfTab` na mount: poprawny `?tab=` (books|photos) z
`window.location.search` wygrywa nad localStorage i jest persystowany; śmieci →
fallback do stored. Hydration-safe (odczyt w istniejącym useEffect).

#### 3. Testy unit

**File**: `tests/unit/components/PhotoUploader.test.tsx` + `tests/unit/components/ShelfTabs.test.tsx` (lub istniejący plik tabów)

**Intent**: (a) odznaczony checkbox → zero POST `/process`, zero resume-state,
redirect na `?tab=photos`; (b) zaznaczony → obecny flow; (c) persist localStorage;
(d) `useShelfTab` honoruje `?tab=photos`.

#### 4. E2E

**File**: `tests/e2e/upload-skip-process.spec.ts` (nowy)

**Intent**: golden path ryzyka kosztowego — upload z odznaczonym checkboxem NIE
wywołuje `/process` (asercja: brak requestu), ląduje na tabie Zdjęcia, wiersz
zdjęcia ma akcję „Uruchom vision". Mock Storage/API przez `page.route` (wzorce
z `upload-flow.spec.ts`).

### Success Criteria:

#### Automated Verification:

- Typecheck / Lint / Unit / E2E zielone

#### Manual Verification:

- Skip-upload na realnym zdjęciu: zero kosztu w CostPanel, „Uruchom vision" działa (user-only)

## Testing Strategy

Unit: obie ścieżki + persist + tab param. E2E: skip golden path + asercja braku `/process`.

## References

- Roadmapa S-36 (`context/foundation/roadmap.md:411-421`)
- Wzorzec E2E: `tests/e2e/upload-flow.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>`.

### Phase 1: checkbox skip + tab param + testy

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck` — patrz commit fazy
- [x] 1.2 Lint: `npm run lint` — patrz commit fazy
- [x] 1.3 Unit: `npm run test` — 890/890
- [x] 1.4 E2E: `npm run test:e2e` — 132 passed (lokalnie :4322)

#### Manual

- [ ] 1.5 Skip-upload na realnym zdjęciu — zero kosztu + ręczny vision z taba (user-only)
