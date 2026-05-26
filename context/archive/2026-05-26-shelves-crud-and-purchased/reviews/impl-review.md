<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: shelves-crud-and-purchased (S-02)

- **Plan**: context/changes/shelves-crud-and-purchased/plan.md
- **Scope**: All phases (2 of 2)
- **Date**: 2026-05-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (z 2 DEFERRED — integration + E2E wymagają migracji na prod DB) |

## Evidence

- `npm run typecheck` → 0 errors / 0 warnings / 0 hints
- `npm run lint` → clean
- `npm run test` → 14 test files, 97 passed (35 nowych S-02: 14 schema + 10 endpoint index + 11 endpoint id)
- Integration test (`shelves-rls-and-triggers.test.ts`, 5 testów) — napisany z `describe.skip` na brak env, uruchamiany przez user'a po `supabase db push`
- E2E test (`shelves.spec.ts`, 1 golden path) — wymaga zdeploy'owanej migracji 0004; runs by user after merge

## Git scope

Branch: `change/shelves-crud-and-purchased` (workflow „branch per change" od 2026-05-26).

S-02 commits:
- `5e2ab2d` feat: migracja 0004 + Zod + endpointy + testy (p1)
- `576dc9d` feat: strona /shelves + React island + E2E (p2)

13 plików (4 src + 4 unit tests + 1 integration test + 1 E2E + 2 docs):
- supabase/migrations/0004_shelves_constraints.sql (NEW)
- src/lib/shelves/schema.ts (NEW)
- src/pages/api/shelves/index.ts (NEW)
- src/pages/api/shelves/[id].ts (NEW)
- src/pages/shelves.astro (NEW)
- src/components/ShelvesIsland.tsx (NEW)
- src/components/ShelfForm.tsx (NEW)
- src/components/ShelfListItem.tsx (NEW)
- tests/unit/lib/shelves/schema.test.ts (NEW, 14 tests)
- tests/unit/pages/api/shelves/index.test.ts (NEW, 10 tests)
- tests/unit/pages/api/shelves/id.test.ts (NEW, 11 tests)
- tests/integration/shelves-rls-and-triggers.test.ts (NEW, 5 tests, deferred)
- tests/e2e/shelves.spec.ts (NEW, 1 test, deferred)

## Findings

### F1 — FormEvent → SyntheticEvent (React 19 deprecation adaptation)

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ShelfForm.tsx:21, src/components/ShelfListItem.tsx:24
- **Detail**: Plan zakładał `FormEvent<HTMLFormElement>` (analog S-01 oryginalnym planie). React 19 zdeprecował FormEvent — typecheck zwraca ts(6385) warning. Per S-01 B variant precedent + lessons.md „Adaptacje literalne" zastosowałem `SyntheticEvent<HTMLFormElement>` z komentarzem w kodzie + flag w commit message (576dc9d). Intent kontraktu (form submission handler) zachowany — różny tylko literalny typ event'u.
- **Fix**: None — adaptacja accepted + flagged per workflow defaults.
- **Decision**: ACCEPTED (literal adaptation, no action)
