<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-32 — BYOK: klucze API własne użytkownika

- **Plan**: context/changes/byok-api-keys/plan.md
- **Mode**: Deep (two passes — Sonnet initial, Opus 4.8 deep)
- **Date**: 2026-06-04
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 4 warnings, 5 observations (across both passes)

## Verdicts (Opus pass, post-fix)

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (was WARNING) |
| Plan Completeness | PASS (was WARNING) |

## Grounding (Opus pass)

6/6 paths ✓, 4/4 symbols ✓, brief↔plan ✓. Verified: `database.types.ts` committed (not gitignored); max migration on origin/main = 0015 (0016 free); CI has no `supabase gen types` step (uses committed types, E2E job runs `supabase start` for runtime table); ESLint `no-explicit-any: error` but no type-aware `no-unsafe-*` rules → inferred `any` from `from('user_api_keys')` compiles + lints clean.

---

## Pass 1 (Sonnet) findings — all FIXED

### F1s — account.spec.ts:36 breaks when placeholder removed
- **Severity**: ⚠️ WARNING · **Dimension**: Blind Spots · **Decision**: FIXED (Phase 2 #2 added).

### F2s — database.types.ts regeneration not planned
- **Severity**: ⚠️ WARNING · **Dimension**: Blind Spots · **Decision**: FIXED (Phase 1 #9 added; superseded/refined by Opus F1 below).

### F3s — No unit test for [id]/test.ts
- **Severity**: ⚠️ WARNING · **Dimension**: Plan Completeness · **Decision**: FIXED (Phase 1 #14 added).

### F4s — No unit test for crypto.ts
- **Severity**: OBSERVATION · **Dimension**: Plan Completeness · **Decision**: FIXED (Phase 1 #11 added).

### F5s — model/base_url immutability not in scope
- **Severity**: OBSERVATION · **Dimension**: Plan Completeness · **Decision**: FIXED (What We're NOT Doing bullet).

---

## Pass 2 (Opus 4.8) findings

### F1 — Step #9 type regeneration can't run pre-merge (no live DB)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Change #9 + Progress 1.4
- **Detail**: `gen types --local` blocked (AV-blocked local stack, memory), `--linked` lacks the table until post-merge db push. Chicken-and-egg per lessons.md ("Nowa funkcja/rpc Postgres…"). `from()` compiles to `any` + lints clean (verified), so CI stays green but new-table queries are silently untyped.
- **Fix A ⭐ Recommended**: Hand-extend database.types.ts for user_api_keys (Row/Insert/Update), flagged with a comment; post-merge `--linked` regen overwrites cleanly.
  - Strength: Full type safety; matches lesson "świadomie typujesz i flagujesz"; committed file correct for CI.
  - Tradeoff: Manual edit to a generated file; must mirror migration exactly.
  - Confidence: HIGH — database.types.ts committed (verified); Tables shape mechanical.
- **Fix B**: Accept untyped `any` + regenerate post-merge.
  - Strength: Zero pre-merge friction; compiles + lints clean.
  - Tradeoff: No type safety for the whole slice; bugs surface only at runtime/E2E.
- **Decision**: FIXED via Fix A — Phase 1 #9 rewritten to hand-extend; Progress 1.4 no longer requires local stack.

### F2 — CreateKeyInput type used but never exported

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #4 / Phase 2 #1
- **Detail**: `useState<CreateKeyInput>` referenced but schema #4 only exported CreateKeySchema + ApiKeyDTO type.
- **Fix**: Export `CreateKeyInput` (and `UpdateKeyInput`) from schema #4.
- **Decision**: FIXED.

### F3 — Server-side fetch to user-controlled base_url (SSRF surface)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 #8 (test.ts) + #5 (probe.ts)
- **Detail**: `openai_compatible` probe fetches user-supplied base_url server-side. Small blast radius (CF Workers public egress, RLS self-scope), acceptable for MVP but should be conscious.
- **Fix**: Add "What We're NOT Doing" bullet; optional `https://` guard.
- **Decision**: FIXED (scope bullet added).

### F4 — First/only key never auto-activated (is_active default false)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 #1 + Desired End State
- **Detail**: New keys insert is_active=false; a user with one key and no "Aktywuj" click has zero active keys → S-33 finds nothing. Defensible; latent handoff gap.
- **Fix**: Note in "What We're NOT Doing" that auto-activating the first key is deferred to S-33.
- **Decision**: FIXED (scope bullet added).
