# fix-cloudflare-runtime-env — Plan Brief

> Full plan: `context/changes/fix-cloudflare-runtime-env/plan.md`

## What & Why

Production blocker fix: serwer (Astro middleware) czyta sekrety Supabase z `import.meta.env.PUBLIC_*` (Vite build-time inlining), ale w produkcji CF Workers `import.meta.env` jest puste — Vite nie zainlinował, bo GitHub Actions build step nie pasował env vars. Sekrety user'a żyją w Cloudflare Worker Dashboard jako **runtime bindings** (dostępne przez `Astro.locals.runtime.env.*`). Każde żądanie do prod URL zwraca 500. Plan: server reads runtime-first z fallback do build-time (dev/test compat); browser pozostaje na build-time inlining z dodanymi GitHub Actions Secrets + `env:` w deploy.yml.

## Starting Point

F-01 + F-02 zarchiwizowane: server client (`supabase.server.ts`), middleware (`handler.ts`), env.d.ts (`App.Locals { user, supabase }`) — wszystko działa lokalnie. Production deploy `bookshelf.dariusz-danowski-559.workers.dev` padał z 500 od pierwszego request (Cloudflare Worker logs 2026-05-26: `Error: Brak PUBLIC_SUPABASE_URL — uzupełnij .env.local`). User ma 4 sekrety w Worker Dashboard, brak w GitHub Actions Secrets.

## Desired End State

Prod URL zwraca 200. `Astro.locals.runtime.env.PUBLIC_*` typowane (manual `Cloudflare.Env` extension w env.d.ts + `App.Locals extends Runtime<Env>`). Server client czyta runtime-first z fallback do build-time. Browser client zachowuje build-time inlining z `PUBLIC_*` dostępnymi w GitHub Actions build env. CLAUDE.md § Cloudflare adapter ma pełen pattern (server + browser + env wiring + per-environment matrix). lessons.md ma entry o runtime.env vs import.meta.env z precedensem.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Pattern czytania env (server) | `import { env } from 'cloudflare:workers'` + fallback do `import.meta.env` | Astro v6 usunęło `Astro.locals.runtime.env` — canonical jest `cloudflare:workers` virtual module; działa w 3 środowiskach (prod / Astro dev / Vitest z `vi.mock`) | Plan |
| Browser client fix scope | Fix teraz razem z server (kompletny substrate) | Jeden change = jedna deploy iteracja; substrate complete; S-01 React island od razu działa | Plan |
| Env typing depth | Pełen extension `Cloudflare.Env` o wszystkie 4 secrets | Single source of truth typing; enforcement-by-code (lesson 2026-05-20); kolejne slice'y (S-01 admin, S-03 vision) bez lokalnego cast | Plan |
| Deploy verify scope | Manual: curl + Worker logs przez 5 min | Real production smoke; eyeball z prawdziwym contextem; szybki (~2 min) | Plan |
| Test coverage server fallback | Unit test 3 scenariuszy (runtime / fallback / both-undefined) | Load-bearing fallback logic deserve deterministic coverage; ~30 linii testu | Plan |
| CLAUDE.md scope | Pełen rewrite § Cloudflare adapter | Aktualna sekcja wprowadziła w błąd (mówiła "PUBLIC_* inlinowane na build-time" co dla prod CF Workers wymagało env: w deploy); kolejny slice używa wzorzec | Plan |
| `wrangler.jsonc vars` section | NIE (zostaje bez) | Plain text vars w wrangler config — nieadekwatne dla secrets; spójność z Worker Dashboard Secrets jako single source | Plan |

## Scope

**In scope:** `src/env.d.ts` (rozszerz `Cloudflare.Env` o 4 secrets + `App.Locals extends Runtime<Env>`); `src/lib/db/supabase.server.ts` (runtime-first + fallback + multi-context error message); `src/lib/db/supabase.browser.ts` (top-of-file komentarz wyjaśniający); `tests/unit/lib/db/supabase.server.test.ts` (3 scenariusze); `.github/workflows/deploy.yml` (env: block dla build step); CLAUDE.md § Cloudflare adapter (pełen rewrite z matrix); lessons.md (nowy entry).

**Out of scope:** wrangler.jsonc vars section (secrets nie idą do plain text config); update worker-configuration.d.ts (generated, nie edytuj); CI smoke test po deploy (scope-creep); refactor F-01 integration test (używa raw createClient, nie zależy); strict runtime-only mode (zabija dev/test compat); SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY w GitHub Secrets (server-only runtime, nigdy do browser bundle).

## Architecture / Approach

Dwie fazy w kolejności zależności: (1) source change (kod + types + tests + docs — wszystko verifiable lokalnie przez typecheck/lint/test), (2) deploy infra (deploy.yml edit) + manual production verify (curl + Worker logs). Phase 1 atomic — sygnatura `SupabaseServerContext` **BEZ zmian** (`env` z `cloudflare:workers` jest module-level, nie context-scoped, więc istniejący wywoływacz w handler.ts działa bez modyfikacji). Phase 2 zależy od Phase 1 deploy'u — bez fixu kodu deploy.yml env change sam nic nie naprawia.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Code + types + tests + docs | Server client runtime-first; env typing pełen; 3 unit testy; CLAUDE.md/lessons rewrite | `vi.stubGlobal('import.meta.env')` w Vitest może wymagać uwagi przy implementacji (Vite injection finicky) |
| 2. Deploy infra + production verify | deploy.yml env: block; manual GitHub Secrets + curl + Worker logs | User musi dodać 2 GitHub Repository Secrets (manual step); deploy może padnąć z innego powodu (nie tego co fix'ujemy) |

**Prerequisites:** F-01 + F-02 zarchiwizowane (commits `0e28cc9`, `aa25437`); user ma write access do GitHub repo Settings (dla Repository Secrets); user ma access do Cloudflare Worker Dashboard (dla logs check).
**Estimated effort:** ~1-2 sesje, 2 fazy.

## Open Risks & Assumptions

- Zakładamy że `@astrojs/cloudflare` adapter populuje `context.locals.runtime` w prod CF Workers per documentation; zweryfikowane częściowo przez recon `@astrojs/cloudflare/dist/utils/handler.d.ts` (export `Runtime` type), ale faktyczne behavior w prod runtime testujemy dopiero przez deploy + curl smoke.
- GitHub Repository Secrets `PUBLIC_*` raz dodane przez user'a — assume że identyczne wartości co Worker Dashboard secrets. Drift możliwy w przyszłości (user zmieni Worker secret nie aktualizując GitHub) → manual ownership.
- Worker Dashboard secrets nazewnictwo: assume `PUBLIC_SUPABASE_URL` (exact match) — user potwierdził w wiadomości że wszystkie 4 są ustawione poprawnie.

## Success Criteria (Summary)

- Prod URL `https://bookshelf.dariusz-danowski-559.workers.dev/` zwraca 200, brak nowych `[middleware] bootstrap failed` przez 5 min po deploy.
- `npm run typecheck` + `npm run lint` + `npm run test` zielone z 3 nowymi unit testami pokrywającymi fallback logic.
- CLAUDE.md zawiera explicit per-environment matrix; następny slice (S-01) ma jasny wzorzec env reading.
