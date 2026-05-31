<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-25 detection-list-views

- **Plan**: context/changes/detection-list-views/plan.md
- **Scope**: Full plan (Phases 1–4 of 4)
- **Date**: 2026-05-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (zweryfikowane na świeżo)
- typecheck: 0 errors (2 hints — FormEvent deprecated, pre-istniejące)
- vitest: 472 passed (49 plików)
- e2e: pełny suite 38 passed / 2 skipped; sam spec S-25 6 passed
- lint (touched files): CLEAN
- Wszystkie oryginalne `data-testid` trybu Karty zachowane (drift-agent 7/7 MATCH)

## Findings

### F1 — set-state po unmount w async akcjach decyzji

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix oczywisty, wąski zakres
- **Dimension**: Safety & Quality
- **Location**: src/components/DetectionReview.tsx:243-290 (useDetectionDecision)
- **Detail**: handleConfirm/handleReject robią `await fetch` → setState bez mounted-guard. Pre-istniejący wzorzec z oryginalnego DetectionCard + ShelfBooksIsland/BookCard — refaktor zachował, nie regresja. Fix (AbortController/mounted-guard) = osobny ogólnoprojektowy refaktor, poza S-25.
- **Decision**: SKIPPED (pre-istniejący wzorzec, poza zakresem)

### F2 — modal bez focus-trap

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (A11y)
- **Location**: src/components/DetectionReview.tsx:554-585 (CorrectionModal)
- **Detail**: Modal ma role=dialog, aria-modal, Esc-close, backdrop-close, ale nie pułapkuje focusa ani nie ustawia focusu na otwarcie. Pełen WCAG-AA świadomie Parked w PRD. Poza MVP.
- **Decision**: SKIPPED (WCAG Parked w PRD)

### F3 — nazwane eksporty wewnętrznych symboli dla testów

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/components/DetectionReview.tsx (export hooków/komponentów)
- **Detail**: Reszta wysp ma jeden default export; helpery prywatne. S-25 eksportuje useDetectionViewMode/ViewModeSwitcher/CorrectionModal/DetectionRow/Tile dla testów jednostkowych. Świadomy trade-off testability; split plików rozwiązałby to naturalnie.
- **Decision**: ACCEPTED (świadomy trade-off testability)

### F4 — rozmiar pliku 1066 linii / 11 jednostek

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny dług, ale plan to przewidział
- **Dimension**: Architecture
- **Location**: src/components/DetectionReview.tsx
- **Detail**: Plik urósł z 803 → 1066 linii. Plan §5 jawnie dopuścił split do `src/components/detection-review/` jako OSOBNY commit refaktorowy (nie część slice'a). Dług strukturalny do rozważenia, nie naruszenie.
- **Decision**: DEFERRED (plan §5 — osobny commit refaktorowy post-slice)
