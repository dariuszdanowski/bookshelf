<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ujednolicone modalne okno książki (S-36)

- **Plan**: context/changes/unified-book-modal/plan.md
- **Scope**: Phase 1–3 (full plan)
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION (4 low warnings, żaden nieblokujący; 2 auto-zaaplikowane)
- **Findings**: 0 critical · 4 warnings · kilka observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria: unit 804/804, E2E 122 passed / 2 skipped, typecheck 0 błędów, lint czysto, build OK. Manual (3.4–3.7) potwierdzony przez usera.

Drift (Agent 1): zero. Wszystkie zmiany Phase 1–3 MATCH; brak martwego kodu; grep `BookDetailModal|ManualAddBook` w src/ czysty; callerzy identify/rematch nietknięci (flaga ISBN-first off); brak migracji.

## Findings

### F1 — Walidacja ISBN tylko po długości w book-less cover-suggestion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/pages/api/books/cover-suggestion.ts:27
- **Detail**: Check `length 10–20` przepuszczał śmieci (np. `9788300000000/../../foo` — slash nie strippowany) do interpolacji w URL OpenLibrary; komunikat kłamał („10 lub 13 cyfr"). Nie ucieka z hosta OL → low risk, ale niespójne ze `schema.ts` regex.
- **Fix**: Normalizuj (strip `-`/spacji, uppercase) + regex `^(\d{13}|\d{9}[\dX])$` jak w schema.ts:174-175.
- **Decision**: FIXED (fast-track auto-apply)

### F4 — parseInt(year) → NaN cicho na null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/BookModal.tsx:88
- **Detail**: `parseInt(f.year, 10)` przy non-numeric (paste/locale) → `NaN` → serializuje do `null`, cicho gubi rok zamiast błędu.
- **Fix**: Guard `Number.isFinite(parseInt(...))`.
- **Decision**: FIXED (fast-track auto-apply)

### F2 — Tylko Google Books rate-limit propagowany

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/lib/matching/findCandidates.ts:38
- **Detail**: `rateLimited:true` tylko gdy GB rate-limited; 429 z OL/BN połykane do pustych wyników. Partial-source outage cicho zwraca mniej kandydatów bez sygnału.
- **Fix**: (deferred) Propaguj rate_limited z OL/BN przy przyszłym hardeningu źródeł.
- **Decision**: SKIPPED — MVP-acceptable (BN/OL keyless/limitless per komentarz); follow-up.

### F3 — CoverThumb bez resetu failed na zmianę url

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/components/BookModal.tsx:97
- **Detail**: Brak `useEffect(() => setFailed(false), [url])` (jest w CoverLarge:129). Teraz OK — klucze listy z indeksem wymuszają remount; bug pojawiłby się tylko przy stabilnych kluczach + reorder.
- **Fix**: (deferred) Dodać effect resetujący failed na zmianę url dla robustności.
- **Decision**: SKIPPED — brak aktualnego buga (defensywne); follow-up.
