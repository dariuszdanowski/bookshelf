<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-32 — BYOK: klucze API własne użytkownika

- **Plan**: context/changes/byok-api-keys/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

5/5 paths ✓ (AccountIsland.tsx, env.d.ts, response.ts, account/schema.ts, migration 0015), 3/3 symbols ✓ (parseUuidParam, apiResponse, apiError), brief↔plan ✓. No contract-surfaces.md.

## Findings

### F1 — account.spec.ts:36 breaks when placeholder is removed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Changes Required
- **Detail**: tests/e2e/account.spec.ts:36 asserts `getByTestId('account-keys-placeholder').toBeVisible()`. Phase 2 replaces that section — CI fails the moment the placeholder is gone.
- **Fix**: Added "update tests/e2e/account.spec.ts: remove the toBeVisible() assertion on account-keys-placeholder" to Phase 2 Changes Required.
- **Decision**: FIXED

### F2 — database.types.ts regeneration not planned after migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Changes Required
- **Detail**: Both supabase clients are typed SupabaseClient<Database>. After 0016_user_api_keys.sql, `from('user_api_keys')` silently returns `any` — TypeScript strict does NOT error on unknown table names. Types regeneration step was missing.
- **Fix**: Added "run `npx supabase gen types typescript --local > src/lib/db/database.types.ts`" to Phase 1 Changes Required (item 9).
- **Decision**: FIXED

### F3 — No unit test planned for [id]/test.ts endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Testing Strategy
- **Detail**: Phase 1 listed 3 unit test files but omitted tests for the decrypt → probe → update endpoint (most complex combinatorially).
- **Fix**: Added `tests/unit/pages/api/account/keys/test.test.ts` as item 14 in Phase 1 Changes Required.
- **Decision**: FIXED

### F4 — No unit test planned for crypto.ts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Testing Strategy
- **Detail**: encrypt/decrypt round-trip had no planned automated coverage. crypto.subtle available natively in Node 24 (no polyfill needed).
- **Fix**: Added `tests/unit/lib/keys/crypto.test.ts` as item 11 in Phase 1 Changes Required.
- **Decision**: FIXED

### F5 — model/base_url immutability not documented in scope

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: What We're NOT Doing
- **Detail**: UpdateKeySchema excludes model/base_url — changing these requires delete + re-add. Not mentioned in scope boundaries.
- **Fix**: Added bullet to "What We're NOT Doing".
- **Decision**: FIXED
