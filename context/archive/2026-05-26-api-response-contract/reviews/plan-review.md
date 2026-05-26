<!-- PLAN-REVIEW-REPORT -->
# Plan Review: F-02 Kontrakt odpowiedzi API + middleware auth-guard

- **Plan**: context/changes/api-response-contract/plan.md
- **Mode**: Deep
- **Date**: 2026-05-26
- **Verdict**: REVISE (po triage: SOUND — wszystkie 3 findingi zaadresowane)
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (przed triage) → PASS (po triage) |
| Plan Completeness | WARNING (przed triage) → PASS (po triage) |

## Grounding

8/8 paths ✓ (3 existing: `src/lib/db/supabase.server.ts`, `database.types.ts`, `eslint.config.mjs`; 5 absent as planned: `src/lib/http/response.ts`, `src/middleware.ts`, `src/env.d.ts`, dwa nowe testy); astro 6.3.1 + @supabase/supabase-js 2.106.0 ✓; `defineMiddleware` eksportowane z `astro:middleware` ✓; vitest glob `tests/unit/**/*.{test,spec}.{ts,tsx}` łapie subdirs ✓; contract-surfaces.md absent (skip surface check); brief↔plan ✓.

## Findings

### F1 — Import `User` z `@supabase/supabase-js` nie istnieje (typecheck blocker)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff (naming w body planu)
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change #1 (`src/env.d.ts` Contract) + Phase 2 — change #2 (algorytm middleware step 2)
- **Detail**: Plan: *„Import `SupabaseClient` i `User` z `@supabase/supabase-js`"*. Weryfikacja typedef supabase-js 2.106.0 (`node_modules/@supabase/supabase-js/dist/index.d.mts`): pakiet eksportuje `type AuthUser` (renamed re-export z `@supabase/auth-js` żeby uniknąć kolizji nazw), NIE `User`. TypeScript compile failuje w Phase 2 z błędem `Module '@supabase/supabase-js' has no exported member 'User'`. Kryterium 2.1 (typecheck zielony) nie przejdzie.
- **Fix**: Zmień import w `env.d.ts` na `import type { AuthUser } from '@supabase/supabase-js'`, oraz `interface Locals { ...; user: AuthUser | null; }`. Algorytm middleware: `let user: AuthUser | null = null`. Nazwa property `locals.user` zachowana (semantyka czytelna).
- **Decision**: FIXED (Fix in plan) — Phase 2 Contract + algorytm middleware + Desired End State + plan-brief Key Decisions zaktualizowane na `AuthUser`.

### F2 — Phase 3 ambiguity: „wymienia się przykład SHELF_NOT_FOUND"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — change #1 (CLAUDE.md edit Contract)
- **Detail**: Plan: *„Lista codes w istniejącej prozie (`SHELF_NOT_FOUND` jako przykład) wymienia się na nasz minimal union"* + *„Pozostała proza zostaje (quick-reference)"*. Niejednoznaczne: implementer może (a) zostawić `SHELF_NOT_FOUND` jako historyczny przykład, (b) usunąć całkowicie. To dokładnie ta klasa drift'u [lesson 2026-05-20], której F-02 ma zapobiegać.
- **Fix**: Doprecyzuj Contract Phase 3: dwie precyzyjne edycje (1) wstaw nowe zdanie z pointer + listą codes; (2) podmień `(\`UNAUTHENTICATED\`, \`SHELF_NOT_FOUND\`, \`INTERNAL_ERROR\`)` → `(\`UNAUTHENTICATED\`, \`NOT_FOUND\`, \`VALIDATION_ERROR\`, \`INTERNAL_ERROR\`, \`RATE_LIMITED\`)`. `SHELF_NOT_FOUND` całkowicie usunięty.
- **Decision**: FIXED (Fix in plan) — Contract Phase 3 przepisany na dwie ponumerowane precyzyjne edycje.

### F3 — Phase 3 ma tylko Manual criteria, brak Automated gate

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria + Progress
- **Detail**: Phase 3 miała tylko 3 manual gates (3.1, 3.2, 3.3), brak Automated. Symetria z Phase 1+2 (oba mieszane) złamana. Pure docs nie wymaga typecheck/lint, ale 1-linijkowy `grep` zapewnia że pointer trafił do pliku.
- **Fix**: Dodano Automated 3.1 (`grep -F 'src/lib/http/response.ts' CLAUDE.md` exit 0); manual renumber do 3.2/3.3/3.4. Implementation Note przepisana („pure docs — automated gate to sanity check pointer; reszta manual review").
- **Decision**: FIXED (Fix in plan) — Success Criteria + Progress section zaktualizowane.
