<!-- PLAN-REVIEW-REPORT -->
# Plan Review: fix-cloudflare-runtime-env

- **Plan**: context/changes/fix-cloudflare-runtime-env/plan.md
- **Mode**: Deep
- **Date**: 2026-05-26
- **Verdict**: REVISE (po triage: SOUND — F1 rewrite zaaplikowany, F2 + F3 zaadresowane jako consequences)
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | FAIL (przed triage) → PASS (po F1 rewrite na cloudflare:workers pattern) |
| Blind Spots | WARNING (przed triage) → PASS (po triage — Vitest mock pattern udokumentowany) |
| Plan Completeness | FAIL (przed triage) → PASS (po triage — sygnatury + env.d.ts + Critical Details zsynchronizowane z Astro v6 API) |

## Grounding

7/7 paths ✓ (existing F-01/F-02 substrate + planned new files); brief↔plan ✓; blast radius `createServerSupabaseClient` — tylko `handler.ts` (prod) + `middleware.test.ts` (mock) ✓; `vi.stubGlobal` + `vi.mock` istnieją w Vitest ✓; **CRITICAL discovery**: `Runtime` z `@astrojs/cloudflare/utils/handler.d.ts:1-3` ma shape `{ cfContext: ExecutionContext }`, nie `{ env: Env }`; **CRITICAL discovery**: `cloudflare:workers` virtual module declared w `worker-configuration.d.ts:12230` (eksportuje `env: Cloudflare.Env`); **CRITICAL discovery**: Astro v6 usunęło `Astro.locals.runtime.env` (cytat z `@astrojs/cloudflare/dist/utils/handler.js:84`).

## Findings

### F1 — Plan oparty na `Astro.locals.runtime.env` które usunięto w Astro v6

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness + Plan Completeness
- **Location**: Critical Implementation Details, Phase 1 change #1 + #2, env.d.ts contract, lessons.md Rule, plan-brief Key Decisions
- **Detail**: Astro v6 (mamy `astro@^6.3.1`) usunął `Astro.locals.runtime.env`. Bezpośredni cytat z `@astrojs/cloudflare/dist/utils/handler.js:84`: *"Astro.locals.runtime.env has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead."* Plus `Runtime` type z `@astrojs/cloudflare/utils/handler.d.ts:1-3` ma shape `{ cfContext: ExecutionContext }` — NIE `{ runtime: { env: Env } }` jak plan zakładał. Canonical pattern w Astro v6+: `import { env } from 'cloudflare:workers'` (virtual module deklarowany w `worker-configuration.d.ts:12230`, eksportuje `env: Cloudflare.Env`).
- **Fix**: Rewrite Phase 1 zgodnie z Astro v6 + cloudflare:workers pattern. Konkretne edycje: (A) Phase 1 #1 Contract — usuń `App.Locals extends Runtime<Env>` (zachowaj tylko Cloudflare.Env extension); (B) Phase 1 #2 Contract — top-level `import { env } from 'cloudflare:workers'`, sygnatura BEZ zmian; (C) Critical Implementation Details — przepisać bullets; (D) lessons.md Rule — server reads z `cloudflare:workers`, fallback do `import.meta.env`; (E) plan-brief Key Decisions row + Architecture/Approach prose; (F) Phase 1 #3 komentarz — referencyjnie poprawić server pattern; (G) Phase 1 #4 — dorzucić `vi.mock('cloudflare:workers', ...)` jako pierwszy step testu.
- **Decision**: FIXED (Apply rewrite) — 7 edycji w plan.md + plan-brief.md. Plan staje się PROSTSZY (sygnatura `SupabaseServerContext` BEZ zmian, brak optional chaining przez locals, ~10-15 linii kodu zamiast 30-40).

### F2 — Vitest `cloudflare:workers` mocking (consequence F1)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Blind Spots
- **Location**: Phase 1 change #4 (tests/unit/lib/db/supabase.server.test.ts)
- **Detail**: Po F1 fix, supabase.server.ts top-level `import { env } from 'cloudflare:workers'`. W Vitest virtual module unavailable — top-level import zfailuje przed vi.stubGlobal hoist. Analogiczne do F-02 `astro:middleware` problemu.
- **Fix**: `vi.mock('cloudflare:workers', () => ({ env: {} }))` na początku test pliku (przed `import` server.ts). Analogiczne do F-02 lessons.md "Adaptacje literalne" pattern.
- **Decision**: FIXED (Apply rewrite — częścią F1 fix) — Phase 1 #4 Contract zaktualizowany z `vi.mock` instruction jako pierwsza linia testu.

### F3 — Browser client komentarz — niespójność po F1

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 1 change #3 Contract
- **Detail**: Plan dla browser client wciąż correct (build-time inlining przez Vite). Po F1, komentarz musi referencyjnie pokazać "server czyta `import { env } from 'cloudflare:workers'`" (nie deprecated "Astro.locals.runtime.env").
- **Fix**: Update komentarz w Phase 1 #3 Contract na poprawny server pattern reference.
- **Decision**: FIXED (Apply rewrite — częścią F1 fix) — Phase 1 #3 Contract zaktualizowany.
