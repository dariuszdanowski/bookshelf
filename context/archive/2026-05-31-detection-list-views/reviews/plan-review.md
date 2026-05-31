<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-25 detection-list-views

- **Plan**: context/changes/detection-list-views/plan.md
- **Mode**: Deep
- **Date**: 2026-05-31
- **Verdict**: REVISE → SOUND (po auto-aplikacji fixów)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL → PASS (F1 fixed) |

## Grounding
7/7 paths ✓, 6/6 symbols ✓, DTO ✓, brief↔plan ✓. Blast radius: `DetectionReview` importowany wyłącznie w `src/pages/photos/[id].astro`; subkomponenty inline/nieeksportowane.

## Findings

### F1 — Plan nie używa kanonicznego formatu parsowanego przez /10x-implement

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — fix mechaniczny, zero zmian w designie
- **Dimension**: Plan Completeness
- **Location**: cały plan
- **Detail**: Wszystkie 19 archiwalnych planów używają `## Phase N:` + `### Success Criteria:` + `#### Automated/Manual Verification:` + sekcji `## Progress` z `- [ ] N.M`. Pierwotny plan miał `### Faza N` i prozę — `/10x-implement` nie sparsowałby faz ani progresu.
- **Fix**: Przepisano plan do kanonicznego formatu (wzorzec: photo-detection-overlay), z sekcją `## Progress` mirrorującą fazy.
- **Decision**: FIXED

### F2 — Default trybu przez matchMedia rozwala istniejące testy (jsdom brak matchMedia)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff
- **Dimension**: Blind Spots
- **Location**: Phase 1 — useDetectionViewMode
- **Detail**: `DetectionReview.test.tsx` (14 testów) renderuje w jsdom i asercją `detection-card-1/2` (Karty). jsdom nie ma `window.matchMedia`; jeśli default spadnie do `list`, testy padają.
- **Fix**: Default = `cards` zawsze gdy `window`/`matchMedia` niedostępne (SSR+jsdom); do `list` tylko przy pozytywnym mobile match. Zapisane w D2 + Key Discoveries + success criteria 1.4.
- **Decision**: FIXED

### F3 — Brak walidacji wartości z localStorage

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — fix oczywisty
- **Dimension**: Blind Spots
- **Location**: Phase 1 — useDetectionViewMode
- **Detail**: Śmieciowa/stała wartość w `bookshelf:detection-view-mode` wyrenderuje pustą listę.
- **Fix**: Odczyt walidowany do `'cards'|'list'|'tiles'`, inaczej default (D7 + krok 2 Fazy 1 + test 1.4).
- **Decision**: FIXED

### F4 — Faza 1 łączy pure-refactor z nową infrastrukturą

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Lean Execution
- **Location**: Phase 1
- **Detail**: Ekstrakcja hooka + switcher w jednej fazie — break testu trudniej przypisać.
- **Fix**: Gate w success criteria 1.3 — odpalić istniejące testy PO ekstrakcji hooka, PRZED dodaniem switchera.
- **Decision**: FIXED

### F5 — Nowy e2e a współdzielony storageState + persystencja localStorage

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 4 — e2e
- **Detail**: Playwright chromium default 1280px ≥640 → istniejące e2e zostają w Karty (OK). Ryzyko: wyciek preferencji między specami.
- **Fix**: Nowy spec ustawia `localStorage` jawnie przed nawigacją (krok 1 Fazy 4).
- **Decision**: FIXED
