<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-01 Email-password auth

- **Plan**: context/changes/email-password-auth/plan.md
- **Mode**: Deep
- **Date**: 2026-05-26
- **Verdict**: SOUND (wszystkie 4 findingi zaadresowane w triage)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (przed/po triage — F2 + F4 to observations) |
| Plan Completeness | WARNING (przed triage) → PASS (po triage F1 + F3) |

## Grounding

7/7 existing paths ✓ (F-01/F-02 substrate + Layout + integration test pattern + 0002 migration); 5/5 new paths absent ✓; `@astrojs/cloudflare` adapter ładuje `.dev.vars` automatycznie w dev mode (`node_modules/@astrojs/cloudflare/dist/index.js`) — webServer dla Playwright dostanie env vars; `signUp` `options.data` typed jako `object` (`@supabase/auth-js/dist/module/lib/types.d.ts:521`) — wspiera user_metadata pattern; brief↔plan ✓.

## Findings

### F1 — Asymetria LoginSchema.password.min(1) vs SignupSchema.password.min(6)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1, change #2 (`src/lib/auth/schema.ts` Contract)
- **Detail**: Plan miał LoginSchema.password.min(1) z uzasadnieniem "legacy userzy" — ale w MVP brak legacy. Asymetria: za-krótkie hasło w login → generic 401, confusing UX + drift risk.
- **Fix**: Zsynchronizuj LoginSchema.password.min(6) z SignupSchema; komentarz inline "Min 6 spójnie z Supabase Auth default — pre-walidacja daje czytelniejszy error niż generic 401".
- **Decision**: FIXED (Fix in plan) — Phase 1 Contract zaktualizowany na min(6), unit test boundary scenario przesunięty z "1 char" na "6 chars".

### F2 — Edge case: zalogowany user wraca na /signup lub /login

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Blind Spots
- **Location**: Phase 3 — pages (signup.astro + login.astro)
- **Detail**: Middleware whitelist'uje /signup, /login → zalogowany user może wejść back-buttonem; renderuje się znowu form, UX dissonance.
- **Fix**: Server-side guard w obu stronach: `if (Astro.locals.user) return Astro.redirect('/')` na górze frontmattera.
- **Decision**: FIXED (Fix in plan) — Phase 3 Contract dla stron signup.astro/login.astro rozszerzony o server-side guard.

### F3 — Phase 2 test pattern referenci F-02 ale endpointy mają inny shape

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 2, change #4 (Contract)
- **Detail**: Plan zaprasza implementera do skopiowania F-02 middleware test patternu (vi.mock na createServerSupabaseClient), ale endpointy auth nie importują tego helpera — używają `locals.supabase`. Test pattern powinien być INNY: builder fake APIContext z locals injected.
- **Fix**: Doprecyzuj Contract: builder `makeContext({ user, supabase })` zwracający fake APIContext z mocked locals, bez vi.mock na module level.
- **Decision**: FIXED (Fix in plan) — Phase 2 change #4 Contract przepisany z explicit builder pattern.

### F4 — Cookie lifecycle w endpointach — implicit, niewyjaśnione

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (brak bullet przed fixem)
- **Detail**: signIn/signUp/signOut set'ują cookies w response, ale `locals.user` w tym samym requestcie pozostaje stary (middleware już zafiksował user state). Efekt widoczny dopiero w następnym requestcie po `window.location.href = redirect`. Plan implicit, nie wyjaśnia.
- **Fix**: Dorzucić bullet do Critical Implementation Details opisujący lifecycle + ostrzeżenie "nie wymuszać manualnego update locals.user".
- **Decision**: FIXED (Fix in plan) — bullet dodany do Critical Implementation Details (po React island state bullet).
