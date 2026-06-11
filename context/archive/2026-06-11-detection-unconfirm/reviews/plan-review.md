<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cofnięcie akceptacji książki (unconfirm)

- **Plan**: context/changes/detection-unconfirm/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: SOUND (po auto-fixie F1)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, symbole ✓ (confirmDetectionToCatalog, handleUndoReject, RejectedDecidedView, useDetectionDecision), brief↔plan ✓. RLS DELETE policies zweryfikowane: books_delete_own, shelf_entries_delete_own (via books.user_id), corrections_delete_own — wszystkie istnieją (0002_rls_policies.sql).

## Findings

### F1 — Lookup shelf_entries filtruje is_current

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — helper, krok (1)
- **Detail**: Pierwotny lookup `shelf_entries ... AND is_current=true` mógł pominąć entry, gdy S-15 stoggluje `is_current` przy przenoszeniu książki — wtedy orphan-check nie znajdzie entry, książka nie zostanie skasowana, a status mimo to się zresetuje (rozjazd katalog↔detekcja).
- **Fix**: Szukać entry po samym `detection_id` (bez filtra `is_current`).
- **Decision**: FIXED (auto-applied — plan zaktualizowany)

### F2 — Karty potwierdzone hurtowo (bulk) bez „Cofnij"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: `handleBulkConfirm` aktualizuje `decidedIds`/`confirmedIds` na poziomie rodzica, ale wewnętrzny stan pojedynczego `DetectionCard` zostaje pending — bulk-confirmed karty nie wchodzą w widok decided, więc nie pokażą „Cofnij". Spójne z „bulk-undo poza zakresem"; dodatkowo po bulk-confirm efekt redirectu zwykle przenosi usera na półkę. Bez akcji.
- **Decision**: ACCEPTED (out of scope)

### F3 — Kolejność delete a RLS shelf_entries

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — helper
- **Detail**: Polityka `shelf_entries_delete_own` autoryzuje przez `exists(books ...)`. Kolejność „entry przed książką" jest poprawna, ale nie była wyeksplikowana — implementer mógłby „zoptymalizować" kasując książkę pierwszą (cascade), gubiąc orphan-check. Dodano sekcję „Critical Implementation Details".
- **Decision**: FIXED (auto-applied — dodano Critical Implementation Details)
