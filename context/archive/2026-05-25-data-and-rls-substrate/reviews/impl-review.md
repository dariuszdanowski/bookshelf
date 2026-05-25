<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-01 Persystencja + izolacja per-user (data-and-rls-substrate)

- **Plan**: context/changes/data-and-rls-substrate/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-05-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — afterAll cleanup can orphan userB if the first deleteUser throws

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: tests/integration/rls.test.ts:121-125
- **Detail**: afterAll deletes the two synthetic users sequentially with `await`. Robust against a thrown test/beforeAll step (IDs assigned right after createUser; afterAll always runs), but if `deleteUser(userAId)` itself throws, the second delete never runs → userB orphaned in auth.users on the real linked project.
- **Fix**: Run both deletes independently — `Promise.allSettled([...])` filtered by the existing id guards, or per-delete try/catch.
- **Decision**: FIXED — Promise.allSettled over guarded deletes (tests/integration/rls.test.ts:121-126)

### F2 — .dev.vars precedence over .env.local is correct but undocumented

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Correctness)
- **Location**: vitest.integration.config.ts:37
- **Detail**: `{ ...loadEnvFile('.env.local'), ...loadEnvFile('.dev.vars') }` makes .dev.vars win on key collision. Defensible (Cloudflare convention); CI fallback works because Vitest `env` merges over process.env. Edge case: a stale .dev.vars value would silently shadow a corrected process.env value in local dev. No bug, just an uncalled-out precedence choice.
- **Fix**: Document the .dev.vars-wins precedence in a comment (or prefer process.env when all three keys are present).
- **Decision**: FIXED — added precedence comment (vitest.integration.config.ts:35-38)
