<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-02 Kontrakt odpowiedzi API + middleware

- **Plan**: context/changes/api-response-contract/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-05-26
- **Verdict**: APPROVED (po triage — wszystkie 5 findingów zaadresowane)
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (przed triage) → PASS (po triage) |
| Architecture | PASS |
| Pattern Consistency | WARNING (przed triage) → PASS (po triage) |
| Success Criteria | PASS |

## Grounding

typecheck 0 errors / 0 warnings / 0 hints ✓; lint 0 errors (przed triage 2 warnings z F2 — po triage clean); test 18/18 (przed triage) → 23/23 (po triage z 5 dodatkowymi testami z F1+F3+F4) ✓; CLAUDE.md pointer present ✓; 6/6 planned changes landed (1 accepted literal adaptation: middleware split); 0 "What We're NOT Doing" violations.

## Findings

### F1 — `createServerSupabaseClient` poza try/catch w middleware

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/middleware/handler.ts:33 (przed fixem)
- **Detail**: Bootstrap client poza try/catch — misconfig env w prod → raw 500 bez envelope/Cache-Control, narusza envelope contract i privacy guardrail.
- **Fix**: Wrap createServerSupabaseClient w try/catch na początku handleRequest; catch → apiError 500 dla `/api/*`, re-throw dla stron (Astro default 500 page). Plus 2 dodatkowe testy (bootstrap fail dla API i dla page).
- **Decision**: FIXED (Fix now) — wrap try/catch zaaplikowany (handler.ts:18-33), 2 testy dodane (middleware.test.ts bootstrap failure describe block). Przy okazji naturally zaadresowany F5: `err.message` coercion zaaplikowane w obu catch'ach (bootstrap + getUser).

### F2 — Unused eslint-disable directives w teście middleware

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/middleware.test.ts:42, :65 (przed fixem)
- **Detail**: Dwa `// eslint-disable-next-line @typescript-eslint/no-explicit-any` redundantne, bo eslint.config.mjs:80 wyłącza tę regułę dla tests/**.
- **Fix**: Usuń obie linie disable.
- **Decision**: FIXED (Fix now) — obie linie usunięte, lint warnings clean.

### F3 — Minor coverage gap: protected API × authenticated user

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Adherence (test coverage)
- **Location**: tests/unit/middleware.test.ts (brak scenariusza)
- **Detail**: Decision tree pokryty pośrednio (protected page z auth + protected API bez auth), ale happy-path API + auth nie był asserted explicit.
- **Fix**: Dodaj 1 test `it('lets authenticated user through to protected API path', ...)`.
- **Decision**: FIXED (Fix now) — test dodany (middleware.test.ts, protected paths describe block).

### F4 — JSON.stringify może throw przy circular refs / BigInt

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/http/response.ts:30, :53 (przed fixem)
- **Detail**: `JSON.stringify` nie chronione — circular ref / BigInt w `data`/`details` → throw bubble'uje poza envelope.
- **Fix**: Refactor do `buildResponse` z try/catch + pre-serialized FALLBACK_BODY (module-level constant, safe shape).
- **Decision**: FIXED (Fix now) — apiResponse/apiError refactored przez buildResponse helper (response.ts), FALLBACK_BODY jako module-level constant, 2 testy dodane (response.test.ts buildResponse fallback describe block).

### F5 — console.error loguje raw err object (potential token leak)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Safety & Quality (Security)
- **Location**: src/lib/middleware/handler.ts:42 (przed fixem)
- **Detail**: `console.error('...', { path, err })` logował cały err object — hipotetyczny risk leaku JWT/cookie fragmentów z przyszłych SDK versions.
- **Fix**: Zamień na `err instanceof Error ? err.message : String(err)`.
- **Decision**: FIXED + ACCEPTED-AS-RULE — naturally fixed przy F1 (zaaplikowałem coercion w obu catch'ach jednocześnie), plus zapisany lesson `context/foundation/lessons.md` → `Server-side error logging: nigdy raw err object, zawsze err.message`.
