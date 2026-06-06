<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-31 — Strona /account (profil użytkownika)

- **Plan**: context/changes/user-account-page/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: REVISE → SOUND (po auto-apply fast track)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓ (4 nowe pliki poprawnie nieobecne), 4/4 symbols ✓ (RLS profiles_update_own,
ApiErrorCode union, display_name schema, createBrowserSupabaseClient), brief↔plan ✓,
Progress↔Phase ✓, brak contract-surfaces.md (skip).

## Findings

### F1 — E2E auth-mock glob too broad, breaks session refresh

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real flake risk; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — e2e credentials test
- **Detail**: Plan mockował `page.route('**/auth/v1/**')`. Współdzielona sesja (auth.setup.ts:34,
  @supabase/ssr cookie storageState) odświeża tokeny przez `/auth/v1/token`; szeroki glob
  przechwyciłby też refresh i rozwaliłby kontekst auth mid-test → flaky. `updateUser` uderza
  tylko w `PUT /auth/v1/user`.
- **Fix**: Zawęzić route do `**/auth/v1/user`.
- **Decision**: FIXED (Fix in plan — Phase 3 success criteria + Key Discoveries)

### F2 — Phase 2 scope of email/password sections vague

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — AccountIsland
- **Detail**: „mogą być widoczne jako read-only/disabled" zostawiało implementerowi zgadywanie.
- **Fix**: Jednoznacznie: Phase 2 = tylko szkielet prezentacyjny sekcji Email/Hasło; Phase 3 wpina formularze.
- **Decision**: FIXED (Fix in plan — Phase 2 AccountIsland intent)

### F3 — Email-change UX assumes Supabase confirmation is ON

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — depends on external project config
- **Dimension**: Blind Spots
- **Location**: Phase 3 — email change / Open Risks
- **Detail**: Baner „sprawdź skrzynkę" zakłada włączone potwierdzanie zmiany emaila; signup
  confirm jest OFF na tym projekcie (auth.setup.ts:29). Jeśli email-change też bez potwierdzenia,
  zmiana jest natychmiastowa i baner myli.
- **Fix**: Dopisać do Key Discoveries / Open Risks; manualna weryfikacja (user-only) potwierdza faktyczny flow.
- **Decision**: FIXED (Fix in plan — Key Discoveries)
