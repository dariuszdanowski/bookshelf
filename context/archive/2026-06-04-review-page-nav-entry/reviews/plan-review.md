<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-15 „Źródłowe zdjęcie" na karcie książki

- **Plan**: context/changes/review-page-nav-entry/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, FK `shelf_entries.photo_id on delete set null` (0001:105) ✓, unit tests istnieją
(`id-books.test.ts`, `search.test.ts`, `BookCard.test.tsx`) ✓, oba islandy przekazują cały `book` do
`BookCard` (brak zmian w islandach) ✓, brief↔plan ✓.

## Findings

### F1 — Blast radius: required photo_id oblewa istniejące testy

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix jest oczywisty i wąski
- **Dimension**: Plan Completeness
- **Location**: Phase 1 (DTO) + Phase 2 (BookCard)
- **Detail**: Plan dodaje wymagane `photo_id: string | null` do `ShelfBookDTO`. Poza dwoma endpointami DTO konsumują też `tests/unit/components/BookCard.test.tsx` (fixture'y), `tests/unit/pages/api/shelves/id-books.test.ts` i `tests/unit/pages/api/books/search.test.ts` (asercje kształtu). Bez ich aktualizacji typecheck/unit padają — niespodzianka zamiast zaplanowanego kroku.
- **Fix**: Dopisać do Phase 1 jawną listę plików testowych do aktualizacji (fixture'y + asercje shape o `photo_id`). Bez zmiany podejścia.
- **Decision**: FIXED (Fast track auto-apply — dopisano blast-radius note do Phase 1 planu)

## Notes

Plan jest wąski, ugruntowany i zgodny z lessons.md („nowa user-facing strona → navigation entry point
jako follow-up micro-slice" — ten slice JEST tym entry pointem dla `/photos/[id]`). Zero migracji, zero
nowych endpointów. Decyzja #1 (ukryj link przy `photo_id=NULL`, bez komunikatu „usunięto") poprawnie
rozstrzyga, że dane nie odróżniają usuniętego zdjęcia od wpisu ręcznego.
