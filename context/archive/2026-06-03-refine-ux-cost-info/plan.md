# Refine UX — spójny label + info o koszcie (S-35) Implementation Plan

## Overview

Przyciski refine w `DetectionReview.tsx` mają **trzy różne labele** dla tej samej akcji (`POST /api/detections/[id]/refine`): „Spróbuj OCR"/„Doprecyzuj odczyt" (karty), „⚠ OCR"/„Refine" (lista/kafelki), „Refine" (trzeci widok, bez sygnału weak-crop). Sugeruje to dwie/trzy różne funkcje, ukrywa ostrzeżenie o słabym cropie w kolorze i **nie informuje, że refine to dodatkowe płatne wywołanie AI**. Plan ujednolica do jednego komponentu z jednym labelem, czytelnym sygnałem weak-crop i widoczną informacją o koszcie.

## Current State Analysis

- 3 instancje `data-testid="refine-button"` w `DetectionReview.tsx`:
  - `:778-792` (karty) — `classifyCropQuality` → `⚠ Spróbuj OCR` (amber) / `Doprecyzuj odczyt` (indigo) + tooltip
  - `:1027-1041` (lista/kafelki) — `⚠ OCR` / `Refine` + krótszy tooltip
  - `:1230-1238` (trzeci widok) — zawsze `Refine` (ang.), **brak** sygnału weak-crop
- `classifyCropQuality(bbox)` (`fallbackPolicy.ts:67`) → `uncertain_localization` = słaby crop. Logika zduplikowana 2× inline.
- Refine = płatne wywołanie vision (limity `REFINE_BUDGET_LIMITS`); koszt widoczny dopiero po fakcie w `CostPanel`.
- Precedens „info o koszcie przed płatną akcją": rerun-match confirm (`:1556` `rerunConfirmMessage` z `formatCostEstimate`). Dla refine brak czystego per-crop estymatu → użyjemy statycznego hintu „płatne".
- E2E: `tests/e2e/force-refine.spec.ts` (sprawdzić asercje na label).

## Desired End State

Wszystkie 3 przyciski refine: jeden label **„Doprecyzuj odczyt"**; przy słabym cropie (`uncertain_localization`) — ⚠ ikona + amber + tooltip wyjaśniający; obok każdego — drobna widoczna informacja **„dodatkowa analiza AI — płatne"**. Zero zmian API/zachowania (ta sama `handleRefine`).

Weryfikacja: `npm run lint && npm run typecheck && npm run test && npm run test:e2e` zielone; manualnie — review pokazuje spójny label + hint kosztu we wszystkich trybach.

### Key Discoveries:

- `data-testid="refine-button"` zostaje → selektory testów po testid przeżyją; tylko asercje na **tekst** wymagają update.
- Sygnał weak-crop wizualny (⚠+amber) zostaje — zmienia się tylko tekst labela na spójny.
- DRY: ekstrakcja jednego `RefineButton` likwiduje 3 rozjeżdżające się kopie u źródła.

## What We're NOT Doing

- Zmiana API / zachowania refine (`handleRefine`, endpoint, budżety) — bez zmian.
- Dialog potwierdzenia przy słabym cropie — pomijamy (⚠+tooltip+hint = świadoma zgoda; veto-able).
- Realny estymat kosztu per-refine (brak czystego źródła; statyczny hint zamiast fałszywej precyzji).
- Zmiana `classifyCropQuality` / progów.

## Implementation Approach

Ekstrakcja współdzielonego komponentu `RefineButton` (label + sygnał weak-crop + hint kosztu), zastąpienie 3 inline instancji. Jeden phase — zmiana mała, atomowa.

## Phase 1: Ujednolicenie przycisków refine + info o koszcie

### Changes Required:

#### 1. Komponent `RefineButton`

**File**: `src/components/DetectionReview.tsx` (sub-komponent w tym pliku, blisko innych helperów)

**Intent**: Jeden komponent renderujący spójny przycisk refine: label „Doprecyzuj odczyt", sygnał weak-crop (⚠ + amber gdy `classifyCropQuality(bbox)==='uncertain_localization'`), tooltip wyjaśniający, oraz przylegający drobny hint „dodatkowa analiza AI — płatne". Likwiduje 3 zduplikowane bloki.

**Contract**: `RefineButton({ bbox, busy, onClick, size?, className? })` — 3 instancje mają **3 różne** rozmiary (`px-3 py-1.5` / `px-2.5 py-1` / `px-2 py-1`), więc `size` ma 3 warianty (`'lg'|'md'|'sm'`) **lub** `className` passthrough dla parytetu (F2). `data-testid="refine-button"` zachowany.

**Label (F1 — rozróżnialność weak/good po tekście, nie po klasie CSS):**
- dobry crop → **„Doprecyzuj odczyt"** (indigo)
- słaby crop (`uncertain_localization`) → **„⚠ Doprecyzuj odczyt"** (amber + tooltip) — ⚠ prefix zostaje, więc e2e/M3L4 rozróżnia po tekście, nie po kolorze

**Hint kosztu (F3 — forma per widok):** w kartach widoczny tekst „dodatkowa analiza AI — płatne"; w trybach kompaktowych (lista/kafelki) ikona `ⓘ` + tooltip „dodatkowa analiza AI — płatne" (oszczędność miejsca).

#### 2. Zastąpienie 3 inline instancji

**File**: `src/components/DetectionReview.tsx`

**Intent**: Podmienić bloki `:778-792`, `:1027-1041`, `:1230-1238` na `<RefineButton ... />` z odpowiednim `size`. Trzecia instancja (1230) zyskuje sygnał weak-crop, którego dziś nie ma.

**Contract**: Każda instancja przekazuje `bbox={detection.bbox}`, `busy`, `onClick={() => void handleRefine()}`. Usunąć lokalne `classifyCropQuality`/`isWeak` IIFE.

#### 3. Testy

**File**: `tests/unit/components/DetectionReview.test.tsx` (**istnieje**) + `tests/e2e/force-refine.spec.ts`

**Intent**: Zaktualizować asercje pod nowy spójny label; potwierdzić sygnał weak-crop po ⚠ (nie po kolorze) + obecność hintu kosztu.

**Contract** (konkretne, F1): `force-refine.spec.ts` — `:108` good `toHaveText('Doprecyzuj odczyt')` **zostaje** (exact); `:122` weak `toContainText('Spróbuj OCR')` → `toContainText('⚠')` (lub `toHaveText('⚠ Doprecyzuj odczyt')`); nagłówek/komentarze `:6-8` zaktualizować (opis „⚠ Spróbuj OCR" → „⚠ Doprecyzuj odczyt"); pozostałe instancje (detection-card-3, detection-row-2) analogicznie. `DetectionReview.test.tsx` — zaktualizować asercje na label refine + dodać sprawdzenie hintu kosztu. Selektory po `data-testid` zostają.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit: `npm run test`
- E2E: `npm run test:e2e` (force-refine + reszta zielone)

#### Manual Verification:

- Review (karty / lista / kafelki) — przycisk refine ma wszędzie label „Doprecyzuj odczyt"
- Przy słabym cropie: ⚠ + amber + tooltip; przy dobrym: indigo
- Obok każdego przycisku widoczna informacja „dodatkowa analiza AI — płatne"

**Implementation Note**: Po automatach pauza na manualne potwierdzenie usera.

## Testing Strategy

### Unit / Component:

- `RefineButton`: label spójny; weak bbox → ⚠/amber; hint kosztu obecny

### E2E:

- `force-refine.spec.ts`: asercje po testid; label „Doprecyzuj odczyt"

### Manual Testing Steps:

1. Otwórz review zdjęcia z detekcjami w 3 trybach prezentacji → label spójny + hint kosztu
2. Detekcja ze słabym bbox → ⚠ + amber + tooltip

## References

- `src/components/DetectionReview.tsx:778-792, 1027-1041, 1230-1238`
- `src/lib/matching/fallbackPolicy.ts:67` (classifyCropQuality)
- `tests/e2e/force-refine.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Ujednolicenie przycisków refine + info o koszcie

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck` — 9d980c8
- [x] 1.2 Lint: `npm run lint` — 9d980c8
- [x] 1.3 Unit: `npm run test` — 9d980c8
- [x] 1.4 E2E: `npm run test:e2e` (force-refine zielony) — 9d980c8

#### Manual

- [x] 1.5 Label spójny: „Doprecyzuj odczyt" (dobry) / „⚠ Doprecyzuj odczyt" (słaby) we wszystkich 3 trybach — 9d980c8
- [x] 1.6 Słaby crop: ⚠ + amber + tooltip; dobry: indigo — 9d980c8
- [x] 1.7 Widoczny hint „dodatkowa analiza AI — płatne" (tekst w kartach / ⓘ+tooltip w list/kafelki) — 9d980c8
