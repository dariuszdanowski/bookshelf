<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Move Book Between Shelves + Versioned Location History (S-07)

- **Plan**: context/changes/move-book-and-history/plan.md
- **Scope**: Phase 1 + Phase 2 (all automated done)
- **Date**: 2026-05-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation (fixed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (automated; manual 2.5–2.7 user-only, pending) |

## Grounding / cross-checks
- Trzy niezmienniki potwierdzone: insert-first (move.ts:128-135 → 147-150), brak migracji (stop na 0011), brak rpc/funkcji.
- Bezpieczeństwo: 401 przed selectami; ownership książki i półki docelowej egzekwowane RLS-scoped selectami (404) + backstop RLS `with check` (0009). User nie przeniesie cudzej książki ani na cudzą półkę.
- Logowanie błędów: wyłącznie whitelisted `{name,message,code}`, nigdy raw err (lessons.md) — wszystkie 4 console.error.
- Non-atomic dwa zapisy: zgodne z zaakceptowanym `confirm.ts`; brak utraty danych (insert-first), stan „na dwóch półkach" logowany + naprawialny.
- Automaty: typecheck 0/0, lint clean, unit 435→436, E2E move-book 3/3.

## Findings

### F1 — Brak testu ścieżki „UPDATE pada po INSERT"

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/unit/pages/api/books/move.test.ts
- **Detail**: Udokumentowane okno awarii (INSERT ok, UPDATE-historyczny pada → książka na dwóch półkach, 500 + log) nie miało testu. Harness mocka już wspierał `updateError`.
- **Fix**: Dodano przypadek „returns 500 when historical update fails after insert" (assert 500 + insert wołany + updateEq('id','entry-1')). 12/12 zielone.
- **Decision**: FIXED (auto-apply, fast-track) — 2026-05-30.
