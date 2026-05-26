<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: email-password-auth (S-01)

- **Plan**: context/changes/email-password-auth/plan.md
- **Scope**: All phases (3 of 3)
- **Date**: 2026-05-26
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS (2 informational EXTRA, literal adaptations) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (manual smoke coverage) |

## Evidence

- `npm run typecheck` → 0 errors / 0 warnings / 0 hints
- `npm run lint` → clean
- `npm run test` → 8 test files, 55 passed (+ z F-02 baseline: schema 13 + signup 6 + login 7 + logout 3 = 29 nowych dla S-01)
- Production deploy (commit 8ed5a6a) → success
- Real user signup smoke (manual, 26 May 2026):
  - Założenie konta z UI `/signup` → redirect na `/` w stanie zalogowanym ✓
  - Trigger `handle_new_user` utworzył `profiles` + `shelves` „Zakupione" ✓
  - Logout button → cookies sb-* scleared w DevTools ✓
  - Re-login → działa ✓
- `curl POST /api/auth/signup` → 200 + `{data:{redirect:"/"}}` + session cookies ✓
- `npx supabase migration list` → Local 0001/0002/0003 = Remote 0001/0002/0003 ✓

## Git scope

S-01 specific commits (chronologicznie):
- `7e71b66` feat: migracja trigger handle_new_user + Zod schemas (p1)
- `1fbfa6f` feat: endpointy /api/auth/{signup,login,logout} + integration test (p2)
- `8df15f4` feat: strony + React forms + E2E Playwright (p3)
- `3fa77f9` chore: SHA write-back dla Phase 3 progress
- `9ea35f0` feat: merge variant B (eksperyment A/B/C)
- `dda9c19` chore: migration idempotency + login privacy port z A/C
- `05e4ecf` chore: rozszerz error logging w signup endpoint (DEBUG)
- `ced4bd3` chore: expose signup error details w response (TEMP DEBUG)
- `a999146` chore: trigger deploy dla ced4bd3 (empty commit)
- `9d4f42a` ci: probe trigger (empty commit)
- `8ed5a6a` chore: wycofaj debug response-body, zostaw rich logging
- `12732de` docs(roadmap): S-09 outcome obejmuje też logout-redirect

17 plików S-01 (na main); plan-listed wszystkie zaadresowane.

## Findings

### F1 — try/catch + rich console.error w signup.ts (EXTRA vs plan)

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/auth/signup.ts:49-87
- **Detail**: Plan zakładał prosty pattern `const { data, error } = await signUp(...)` + `if (error)` branch. Faktyczna implementacja owinęła signUp w try/catch + dodała rich console.error z `name`/`status`/`code`/`cause`. To dodanie powstało podczas debug session (signup 500 z Worker Secret błędem) i zostało celowo zachowane jako poprawa observability po revert `details:` z response body. Per CLAUDE.md „Adaptacje literalne" — intent kontraktu zachowany (privacy guardrail: response BEZ details), dodanie defensywne flagowane w commit message 8ed5a6a.
- **Fix**: None — adaptacja zaakceptowana + oflagowana per workflow defaults.
- **Decision**: ACCEPTED (literal adaptation, no action)

### F2 — Manual gates 2.4 (integration test) i 3.4 (E2E) markowane N/A

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/email-password-auth/plan.md:377, 391 (Progress rows 2.4, 3.4)
- **Detail**: Progress rows 2.4 (`npm run test:integration`) i 3.4 (`npm run test:e2e`) markowane jako `[x] — N/A (sandbox)` przez agenta B (zgodnie z hard constraints prompt'u eksperymentu A/B/C). Po archive fix-cloudflare-runtime-env i applied migration 0003 te testy MOGLIBY zostać uruchomione. De facto: user wykonał manual smoke (signup → logout → login → cookies cleared w DevTools) pokrywający intent E2E; integration test (trigger creates profile + shelf) zweryfikowany przez query do REST API po direct-supabase signup. Czyli intent gates 2.4+3.4 spełniony przez manual test, ale automated CI nie uruchamia tych testów.
- **Fix**: None now — zostaje jako follow-up (Stream E micro-slice „wire up CI integration + E2E tests"). Manual coverage wystarczający dla APPROVED verdict; long-term lepiej automated regression.
- **Decision**: ACCEPTED (follow-up jako osobny slice w Stream E)

### F3 — Worker Secret PUBLIC_SUPABASE_ANON_KEY drift vs .dev.vars

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: Cloudflare Worker Dashboard (operational, not code)
- **Detail**: Production 500 INTERNAL_ERROR na pierwszym real signup attempt. Root cause: Worker Dashboard Secret `PUBLIC_SUPABASE_ANON_KEY` był różny od `.dev.vars` (Supabase odrzuciło z „Invalid API key" 401). Zerodebug: rich console.error w endpoint + Cloudflare Worker logs real-time stream → operator (user) podmienił secret w Dashboard UI → działa. 1.5 godziny debug. Reguła do zapisania: secrety server-side (Worker bindings) muszą być aktywnie walidowane vs lokalny .dev.vars przed considering „deploy done" — sama deployment success workflow nie pokrywa runtime secret correctness. Smoke test produkcyjny musi być nie tylko „HTTP 200 na landing page" ale też „auth flow przeszedł" gdy auth jest w scope.
- **Fix**: Record as lesson — pattern dla projektu (kolejne env-zależne slice'y, np. S-03 vision z ANTHROPIC_API_KEY, będą cierpieć na ten sam problem jeśli nie wymusimy walidacji).
- **Decision**: RECORDED-AS-LESSON (zapisany w lessons.md jako „Worker Secret validation gate")
