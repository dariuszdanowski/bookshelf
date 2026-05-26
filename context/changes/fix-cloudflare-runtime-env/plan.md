# fix-cloudflare-runtime-env: Server reads runtime.env, browser reads build-time — Implementation Plan

## Overview

Production blocker fix: `src/lib/db/supabase.server.ts` czyta sekrety przez `import.meta.env.PUBLIC_*` (Vite build-time inlining), a w produkcji CF Workers `import.meta.env` jest puste (Vite nie zainlinował bo build w GitHub Actions nie miał env vars). Sekrety user'a żyją w Cloudflare Worker Dashboard jako **runtime bindings** dostępne przez `Astro.locals.runtime.env.*`. Plan: server reads runtime-first z fallback do build-time (dev/test compat); browser pozostaje na build-time inlining ALE z GitHub Actions Secrets + `env:` w `deploy.yml` żeby działało w prod bundle. Plus typowanie `interface Env` w `env.d.ts` (manual, bo wrangler typegen nie zna runtime secrets), pełen rewrite CLAUDE.md § Cloudflare adapter, lesson do lessons.md.

## Current State Analysis

- **Production error** (Cloudflare Workers logs, 2026-05-26): `Error: Brak PUBLIC_SUPABASE_URL lub PUBLIC_SUPABASE_ANON_KEY w środowisku` z `createServerSupabaseClient (virtual_astro_middleware.mjs:6:11)` — każde żądanie do `bookshelf.dariusz-danowski-559.workers.dev/` zwraca 500.
- **Bug root cause**: [src/lib/db/supabase.server.ts:28-29](../../../src/lib/db/supabase.server.ts) używa `import.meta.env.PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`. Vite inline'uje tylko to co jest w build env. Build w GitHub Actions ([.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml)) NIE pasuje żadnych env vars do `npm run build` step → Vite zainlinował `undefined`.
- **Secrets state**: user ma 4 sekrety w Cloudflare Worker Dashboard (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY) jako encrypted Worker bindings — dostępne w **runtime** (per request) przez `Astro.locals.runtime.env.*`, NIE przez build-time `import.meta.env`.
- **Lokalnie działa**: `@astrojs/cloudflare` dev adapter loaduje `.dev.vars` i wystawia do `import.meta.env` przez Vite plugin — dlatego `npm run dev` nie failuje.
- **Browser client** [src/lib/db/supabase.browser.ts:14-15](../../../src/lib/db/supabase.browser.ts) ma ten sam pattern (`import.meta.env.PUBLIC_*`), ale: browser nie ma `runtime.env` (to tylko server-side binding). Browser MUSI dostać env przez build-time inlining, co wymaga GitHub Actions Secrets + `env:` block w `deploy.yml`. Aktualnie browser też zfailowany w prod bundle, ale **bez konsumenta** w main (F-02 phase 2 dodał browser substrate per F2 fix [`browser client scaffolduje się tu jako substrat per roadmap F-01`](../../../context/changes/api-response-contract/plan.md)) — pierwszy realny konsument w S-01 React island.
- **Wrangler typegen** ([worker-configuration.d.ts:4-10](../../../worker-configuration.d.ts)): generuje `interface Env extends __BaseEnv_Env { ASSETS: Fetcher }` — tylko `ASSETS` binding. Worker Secrets NIE są w generated types (wrangler typegen nie zna runtime secrets — musimy ręcznie rozszerzyć `interface Env` w `env.d.ts` przez module augmentation).
- **Aktualne env.d.ts** ([src/env.d.ts](../../../src/env.d.ts)) deklaruje `App.Locals { supabase, user }` ale **NIE** zawiera `runtime` field — `Astro.locals.runtime` w runtime istnieje (z @astrojs/cloudflare), ale TypeScript widzi `unknown`. Trzeba `interface Locals extends Runtime<Env>` żeby `locals.runtime.env.PUBLIC_*` było typowane.
- **F-01 integration test** ([tests/integration/rls.test.ts:21-23](../../../tests/integration/rls.test.ts)) używa `process.env.PUBLIC_*` + raw `createClient` z `@supabase/supabase-js` — **NIE** używa `createServerSupabaseClient`. Fix do helpera **nie wpływa** na ten test.
- **F-02 middleware test** ([tests/unit/middleware.test.ts:5-8](../../../tests/unit/middleware.test.ts)) mockuje `createServerSupabaseClient` przez `vi.mock` — bez reading real env, nie zależy od sygnatury internal. Sygnatura `SupabaseServerContext` change może wymagać minimalnej aktualizacji helpera `makeContext()` ale mock zachowuje shape.
- **GitHub Actions secrets** ([deploy.yml:36-37](../../../.github/workflows/deploy.yml)): tylko `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. **Brak `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`** — user musi je dodać jako GitHub Repository Secrets (manual step w Phase 2 manual gate).

## Desired End State

Po wykonaniu planu:
- `https://bookshelf.dariusz-danowski-559.workers.dev/` zwraca 200 (nie 500); brak nowych `[middleware] bootstrap failed` w Cloudflare Worker logs.
- `src/env.d.ts` rozszerza `interface Env` (przez `declare namespace Cloudflare`) o wszystkie 4 secrets, plus `App.Locals extends Runtime<Env>` — `Astro.locals.runtime.env.PUBLIC_*` typowane.
- `src/lib/db/supabase.server.ts` czyta `context.locals.runtime.env.PUBLIC_*` first; fallback do `import.meta.env.PUBLIC_*` (dev / Vitest backward compat); jeśli oba undefined → throw czytelny error wskazujący prod (Worker Secrets) vs dev (.dev.vars / .env.local) source.
- `src/lib/db/supabase.browser.ts` zachowuje `import.meta.env.PUBLIC_*` z dorzuconym komentarzem WHY (browser-side = build-time inlining; nie ma runtime bindings); GitHub Actions secrets `PUBLIC_*` + `env:` block w `deploy.yml` build step zapewniają Vite inlining w prod bundle.
- `tests/unit/lib/db/supabase.server.test.ts` (nowy) pokrywa 3 scenariusze: runtime-populated, fallback do build-time, both-undefined-throw.
- CLAUDE.md § Cloudflare adapter zawiera pełen pattern: server pattern + browser pattern + env wiring (Worker Secrets vs GitHub Secrets) + per-environment matrix (prod / Astro dev / Vitest) + pointer do supabase.server.ts.
- lessons.md ma nowy wpis o runtime.env vs import.meta.env z konkretnym precedensem (ten bug).

**Weryfikacja**: `npm run typecheck` + `npm run lint` + `npm run test` + (po deploy) `curl -i https://bookshelf.dariusz-danowski-559.workers.dev/` zwraca 200, Worker logs przez 5 min po deploy nie pokazują nowych `[middleware] bootstrap failed`.

### Key Discoveries:

- **Astro v6 usunęło `Astro.locals.runtime.env`** — bezpośredni cytat z `node_modules/@astrojs/cloudflare/dist/utils/handler.js:84`: *"Astro.locals.runtime.env has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead."* Plus `Runtime` typ z `@astrojs/cloudflare/utils/handler.d.ts:1-3` ma shape `{ cfContext: ExecutionContext }` (nie `{ env: Env }`).
- **`cloudflare:workers` virtual module to canonical sposób** — deklarowany w [worker-configuration.d.ts:12230](../../../worker-configuration.d.ts) (`declare module 'cloudflare:workers' { export = CloudflareWorkersModule }`), eksportuje `env: Cloudflare.Env`. @astrojs/cloudflare sam tego używa wewnętrznie (`utils/handler.js`, image endpoints). Top-level `import { env } from 'cloudflare:workers'` — bez context, bez request-scoped lookups.
- **`Cloudflare` namespace augmentation** to canonical pattern dla rozszerzenia `Env` o nasze secrets — `declare namespace Cloudflare { interface Env { PUBLIC_SUPABASE_URL: string; ... } }` w `env.d.ts`. TypeScript merge'uje interface declarations across files; rozszerzenie współgra z auto-generated `worker-configuration.d.ts` (`Cloudflare.Env extends __BaseEnv_Env`).
- **`@astrojs/cloudflare` dev adapter parsuje `.dev.vars`** ([node_modules/@astrojs/cloudflare/dist/index.js](../../../node_modules/@astrojs/cloudflare/dist/index.js)) i wstrzykuje do Vite `define` → dostępne przez `import.meta.env` w dev. Plus `cloudflare:workers` `env` powinno też działać w dev (przez @cloudflare/vite-plugin), ale fallback dla certainty.
- **`import.meta.env` w prod CF Worker bundle = static object** — Vite zastępuje statycznie wszystkie `import.meta.env.X` na value-z-build-time (lub `undefined` gdy nie było). Runtime nie ma access do procesowych env vars (nie ma `process.env` w Workers per default).
- **Browser client nie ma runtime bindings** — Workers Secrets to server-side. Browser bundle musi mieć env zainline'owane na build-time. GitHub Actions Secrets to standardowy mechanizm. `cloudflare:workers` virtual module to **tylko server-side** (workerd runtime).
- **`cloudflare:workers` w Vitest** — virtual module unavailable bez explicit mock. Wymagane `vi.mock('cloudflare:workers', () => ({ env: {} }))` w teście, analogicznie do F-02 `astro:middleware` pattern (lesson "Adaptacje literalne").

## What We're NOT Doing

- **Dodanie `vars` section do `wrangler.jsonc`** — `vars` to plain text (committed to repo via wrangler config), nie nadaje się dla secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` to MUST-secret). Plus PUBLIC_* też lepiej mieć w Worker Dashboard secrets (consistent location) niż split (vars vs secrets).
- **Update `worker-configuration.d.ts`** — to wrangler-generated file (`.gitignore`? sprawdzić — może committed jako artifact), nie edytuj manualnie. Naszą extension `interface Env` robimy w `env.d.ts` przez module augmentation.
- **CI smoke test po deploy** — automatyczny curl check w deploy.yml. Scope-creep dla fix change'u; lepiej w osobnym `deploy-verify-automation` change.
- **Refactor F-01 integration test** — używa `process.env` + raw `createClient`, nie zależy od `createServerSupabaseClient`. Bez zmian.
- **Strict runtime-only mode** (Q1 alternative odrzucone) — fallback do `import.meta.env` jest krytyczny dla Astro dev + Vitest backward compat.
- **Browser fix bez GitHub Secrets** — niemożliwe technicznie (browser nie ma runtime.env). Phase 2 wymaga user'a dodać 2 GitHub Repository Secrets ręcznie.
- **`SUPABASE_SERVICE_ROLE_KEY` i `ANTHROPIC_API_KEY` w GitHub Secrets dla build** — te są server-only runtime, nigdy nie powinny być inlinowane w browser bundle. Tylko PUBLIC_* idą do GitHub Actions build env.

## Implementation Approach

Dwie fazy w kolejności zależności: (1) source change (kod + types + tests + docs — wszystko commitowalne i weryfikowalne lokalnie), (2) deploy infrastructure + production verify (deploy.yml edit wymaga GitHub Secrets manual setup; production deploy + curl smoke + Worker logs check). Phase 1 jest atomic — kod nie zmienia public API helpera (sygnatura `SupabaseServerContext` rozszerzona o optional field, backward compat dla F-02 middleware). Phase 2 zależy od Phase 1 deploy'u — bez fixu kodu, deploy.yml env change sam nic nie naprawia.

## Critical Implementation Details

- **`Cloudflare.Env` namespace augmentation jest istotny**: jeśli zrobimy `declare interface Env { ... }` w env.d.ts BEZ `namespace Cloudflare`, kolizja z generated `worker-configuration.d.ts` (oba deklarują `interface Env` w global scope). TypeScript scali, ALE wrangler regenerate może zoverwrite'ować — lepiej augmentować przez `Cloudflare.Env` namespace (stable, intended extension point per Cloudflare docs). `cloudflare:workers` virtual module eksportuje `env: Cloudflare.Env` (ten sam typ).
- **Reading order w `createServerSupabaseClient`**: top-level `import { env } from 'cloudflare:workers'` — `env` dostępne globalnie w module (Cloudflare Workers runtime + dev przez @cloudflare/vite-plugin). Reading: `env?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL` (optional chaining bo Vitest mock może zwrócić `{}`; fallback do build-time gdy virtual module pusty). Sygnatura `SupabaseServerContext` BEZ ZMIAN (nie potrzeba context.locals lookup). Error gdy oba undefined musi rozróżniać contexts (Worker Secrets vs .dev.vars / .env.local / Vitest mock).
- **Vitest mock `cloudflare:workers`**: top-level `import { env }` failuje w Vitest gdy virtual module unavailable — analogiczny problem co F-02 `astro:middleware` (split module workaround). Tu prostszy fix: `vi.mock('cloudflare:workers', () => ({ env: {} }))` na początku test pliku (przed `import` server.ts). Lekcja "Adaptacje literalne" — accept + flag.

## Phase 1: Code + types + tests + docs (atomic source change)

### Overview

Wszystkie zmiany w source (kod, typy, testy, docs) — verifiable lokalnie przez typecheck + lint + test bez touchania deploy. Atomic commit.

### Changes Required:

#### 1. Env typing extension

**File**: `src/env.d.ts` (edit)

**Intent**: Rozszerzyć `Cloudflare.Env` (przez `declare namespace Cloudflare`) o wszystkie 4 secrets z Worker Dashboard, żeby `env.PUBLIC_*` (z `cloudflare:workers` virtual module) było typowane. `App.Locals` **BEZ zmian** (Astro v6 usunęło `locals.runtime.env`, więc nie ma czego rozszerzać tam).

**Contract**: dodać u góry pliku:
- `declare namespace Cloudflare { interface Env { PUBLIC_SUPABASE_URL: string; PUBLIC_SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string; ANTHROPIC_API_KEY: string; } }` (module augmentation z generated `worker-configuration.d.ts:8`). Po augmentation, `env` z `cloudflare:workers` ma typowane wszystkie 4 secrets.
- `App.Locals` zostaje jak dziś: `{ supabase: SupabaseClient<Database>; user: AuthUser | null }`. **Nie dodawaj** `extends Runtime<Env>` ani `runtime` field — Astro v6 ich nie udostępnia (zob. Key Discovery #1).
- Komentarz wyjaśniający WHY (Worker Secrets nie są w wrangler typegen → manual extension; `cloudflare:workers` jest canonical source dla server reads w Astro v6+).

#### 2. Server client runtime-first reading

**File**: `src/lib/db/supabase.server.ts` (edit)

**Intent**: `createServerSupabaseClient` czyta `env` z `cloudflare:workers` virtual module first (canonical Astro v6+ pattern), fallback do `import.meta.env` (Vitest compat — virtual module unavailable bez mock), throw z czytelnym multi-context error gdy oba undefined.

**Contract**:
- Top-level: `import { env } from 'cloudflare:workers'` (na samej górze pliku, po importach z `@supabase/ssr` i types).
- Sygnatura `SupabaseServerContext` **BEZ zmian** (`{ request, cookies }` — `env` jest module-level, nie context-scoped). To znaczy że istniejący `createServerSupabaseClient(context)` w `handler.ts` działa bez modyfikacji wywołania.
- Reading logic: `const url = env?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL; const anonKey = env?.PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.PUBLIC_SUPABASE_ANON_KEY;` (optional chaining bo Vitest mock może zwrócić `{ env: {} }` — empty object — i wtedy fallback przejmuje).
- Error message gdy oba undefined: rozróżnia 3 środowiska:
  - prod CF Workers: "Brak PUBLIC_SUPABASE_URL/PUBLIC_SUPABASE_ANON_KEY w Worker bindings — dodaj jako Secrets w Cloudflare Dashboard"
  - Astro dev: "...uzupełnij .dev.vars (parsed by @astrojs/cloudflare adapter)"
  - Vitest: "...mock 'cloudflare:workers' (vi.mock z env values) lub set import.meta.env w vi.stubGlobal"
  - Single error message z 3 hint'ami sufficient (caller dostaje czytelny help bez heroics).

#### 3. Browser client — komentarz wyjaśniający

**File**: `src/lib/db/supabase.browser.ts` (edit minimal)

**Intent**: Zostawić `import.meta.env.PUBLIC_*` (browser nie ma runtime bindings — tylko build-time), dodać top-of-file komentarz explicit czemu różni się od server client.

**Contract**: dorzuć JSDoc comment u góry pliku tłumaczący: "Browser client czyta env wyłącznie przez `import.meta.env.PUBLIC_*` (Vite build-time inlining). W przeciwieństwie do server client (który czyta `env` z `'cloudflare:workers'` virtual module — server-only Workers binding), browser bundle nie ma access do runtime bindings — env vars MUSZĄ być inlinowane przez Vite na etapie buildu. Wymaga `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` w GitHub Actions build env (zob. .github/workflows/deploy.yml)."

#### 4. Unit testy server client

**File**: `tests/unit/lib/db/supabase.server.test.ts` (nowy)

**Intent**: Pokrycie 3 scenariuszy fallback logic — load-bearing decyzja deserve deterministyczny coverage.

**Contract**: Pierwsza linia testu (przed jakimkolwiek import): `vi.mock('cloudflare:workers', () => ({ env: {} }))` — virtual module unavailable w Vitest, mock wstawia neutralne `env` (test sterowanie przez `vi.doMock` lub re-mock per test).

Minimum 3 testów:
- **runtime-populated**: re-mock `cloudflare:workers` z `env: { PUBLIC_SUPABASE_URL: 'https://runtime.example', PUBLIC_SUPABASE_ANON_KEY: 'runtime-anon' }` → `createServerSupabaseClient(fakeContext)` returns client; verify konsumuje runtime values (spy na createServerClient call args).
- **fallback to build-time**: default mock `cloudflare:workers` z `env: {}` + `vi.stubGlobal('import.meta', { env: { PUBLIC_SUPABASE_URL: 'https://build.example', PUBLIC_SUPABASE_ANON_KEY: 'build-anon' } })` → konsumuje build-time values.
- **both-undefined-throws**: `cloudflare:workers` env empty + brak import.meta.env values → throw z error message zawierającym hint'y dla 3 środowisk (prod / Astro dev / Vitest).

`vi.mock` musi być przed importem `supabase.server.ts` (Vitest hoist'uje vi.mock przed importami, ale dla czytelności umieść na samym górze pliku). `vi.stubGlobal` dla `import.meta` jest standard Vitest pattern dla Vite env injection mock.

#### 5. Middleware test — verify mock compatibility

**File**: `tests/unit/middleware.test.ts` (potencjalna edycja)

**Intent**: Po zmianie sygnatury `SupabaseServerContext`, sprawdzić czy istniejący mock w F-02 middleware test nadal kompiluje + zielony. Jeśli mock helper `makeContext` używał konkretnego shape który nie ma `locals.runtime.env`, dorzuć minimal stub (najprawdopodobniej zero-change wymagana — mock jest na poziomie `createServerSupabaseClient` jako całość).

**Contract**: re-run `npm run test`; jeśli middleware.test.ts zielony bez zmian — `no-op`. Jeśli fail — minimal update mock shape w `makeContext` żeby zwracało locals z runtime stub lub wystarczy że obecny mock zwraca cokolwiek (cast `as any` w testach jest OK per [eslint.config.mjs:80](../../../eslint.config.mjs)).

#### 6. CLAUDE.md § Cloudflare adapter — pełen rewrite

**File**: `CLAUDE.md` (edit sekcji)

**Intent**: Przepisać sekcję żeby explicit pokazywała: server pattern (runtime.env first + fallback), browser pattern (build-time inlining), env wiring (Worker Secrets dla server runtime + GitHub Secrets dla browser build), per-environment matrix.

**Contract**: sekcja `## Cloudflare adapter — specyfika` zastąpiona nowym blokiem zawierającym (struktura):
- **Server-side env reading**: pointer do `src/lib/db/supabase.server.ts` jako single source of truth; pattern `runtime.env first → fallback import.meta.env → throw`; konfiguracja przez Cloudflare Worker Dashboard Secrets.
- **Browser-side env reading**: `import.meta.env.PUBLIC_*` (Vite build-time inlining); konfiguracja przez GitHub Actions Repository Secrets + `env:` block w `deploy.yml`.
- **Env matrix** (3 rzędy: prod CF Workers / Astro dev / Vitest, kolumny: server source / browser source / setup needed) — tabela.
- **`Cloudflare.Env` namespace augmentation** w `src/env.d.ts` jako wzorzec dla typowania nowych secrets.
- Zachować istniejący punkt o `worker-configuration.d.ts` generated (nie edytuj manualnie).

#### 7. Lesson do lessons.md

**File**: `context/foundation/lessons.md` (append)

**Intent**: Zapisać klasę „Cloudflare Workers env reading — runtime vs build-time" — precedens (ten bug) + reguła + applies-to.

**Contract**: nowy H2 entry z 4-field format (Context, Problem, Rule, Applies to):
- **Context**: Każdy server-side helper czytający env w Astro + Cloudflare Workers projekcie (Supabase clients, vision LLM client w S-03+, dowolny przyszły external API client).
- **Problem**: `import.meta.env.PUBLIC_*` w Vite to **build-time inlining** — Vite zastępuje wartości statycznie na etapie buildu. W produkcji CF Workers `import.meta.env` to static object zainlinowany na build (lub `undefined` gdy build env nie miał vars). Lokalnie działa przez @astrojs/cloudflare dev adapter (parsuje `.dev.vars` do Vite define). W prod fails — server stack trace `Error: Brak ... — uzupełnij .env.local`. Wykryte 2026-05-26 przez Cloudflare Worker logs po pierwszym realnym request do prod URL.
- **Rule**: **Server-side** (Astro v6+): czytaj env z `import { env } from 'cloudflare:workers'` (canonical Astro v6+ pattern; `Astro.locals.runtime.env` removed); fallback do `import.meta.env.X` dla dev/test compat. Konfiguracja: Cloudflare Worker Dashboard Secrets (per env, encrypted). W Vitest: `vi.mock('cloudflare:workers', () => ({ env: {...} }))` na początku test pliku. **Browser-side**: czytaj env z `import.meta.env.PUBLIC_*` (Vite build-time inline); konfiguracja: GitHub Actions Repository Secrets + `env:` block w `deploy.yml` build step. **Nigdy** nie inline'uj secrets non-PUBLIC do browser bundle.
- **Applies to**: plan, implement, impl-review

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — 0 błędów, `App.Locals extends Runtime<Env>` typowanie działa, server client czyta runtime.env bez `any`
- `npm run lint` zielony na touched files (`src/env.d.ts` ignored per istniejącej konwencji, ale reszta clean)
- `npm run test` zielony — minimum 3 nowych testów w `tests/unit/lib/db/supabase.server.test.ts` + middleware.test.ts pozostaje zielony (regression check)

#### Manual Verification:

- Code review: `supabase.server.ts` ma runtime-first ordering w reading; browser.ts ma komentarz wyjaśniający; CLAUDE.md sekcja Cloudflare adapter zawiera 3-środowiskową matrix; lessons.md ma nowy entry o env reading

**Implementation Note**: Po automated verification zatrzymaj się na code review (matrix w CLAUDE.md kompletna, lesson w lessons.md poprawnie sformułowany), zanim ruszysz fazę 2.

---

## Phase 2: Deploy infrastructure + manual production verify

### Overview

Edycja `.github/workflows/deploy.yml` (env: block dla build step) + manual gates (GitHub Secrets setup + production deploy + curl smoke + Worker logs check).

### Changes Required:

#### 1. Deploy workflow — env: block dla build step

**File**: `.github/workflows/deploy.yml` (edit)

**Intent**: Dodać `env:` block do `Build` step żeby `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` z GitHub Repository Secrets były dostępne dla Vite w trakcie `npm run build` (browser bundle inlining).

**Contract**: w step `Build` (linia ~26-27 obecnie), pod `run: npm run build` dorzucić:

```yaml
      - name: Build
        run: npm run build
        env:
          PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}
          PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.PUBLIC_SUPABASE_ANON_KEY }}
```

NIE dodajemy `SUPABASE_SERVICE_ROLE_KEY` ani `ANTHROPIC_API_KEY` — te są server-only runtime (Worker Secrets), nigdy nie idą do browser bundle.

### Success Criteria:

#### Automated Verification:

- (Po push commit z Phase 1 + Phase 2): GitHub Actions deploy job kończy się sukcesem (build + wrangler deploy step zielony)

#### Manual Verification:

- **Manual gate (user)**: dodaj `PUBLIC_SUPABASE_URL` i `PUBLIC_SUPABASE_ANON_KEY` jako GitHub Repository Secrets (Settings → Secrets and variables → Actions → New repository secret). Wartości identyczne z Worker Dashboard secrets.
- **Manual gate (user)**: po deploy → `curl -i https://bookshelf.dariusz-danowski-559.workers.dev/` zwraca **200** (nie 500). Header `Content-Type: text/html`, body zawiera landing page HTML.
- **Manual gate (user)**: Cloudflare Worker Dashboard → Logs → przez 5 minut po deploy brak nowych `[middleware] bootstrap failed` lub `Brak PUBLIC_SUPABASE_URL` errors.

**Implementation Note**: Manual gates wymagają aktywności user'a (GitHub Secrets setup + curl + logs check). Po wszystkich 3 manual gates zielonych — change gotowy do `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/lib/db/supabase.server.test.ts` (Phase 1) — 3 scenariusze fallback logic (runtime / build-time / both-undefined)

### Integration Tests:

- F-01 [tests/integration/rls.test.ts](../../../tests/integration/rls.test.ts) nie zmienia się (używa raw `createClient`, nie `createServerSupabaseClient`) — regression check że nadal zielony

### E2E Tests:

- Brak (E2E w projekcie tylko `tests/e2e/smoke.spec.ts` z bootstrap — nie dotyka auth flow); E2E auth flow przyjdzie w S-01

### Manual Testing Steps:

1. Po Phase 1 verify: code review (matrix CLAUDE.md, lesson lessons.md)
2. Po Phase 2 deploy: curl `https://bookshelf.dariusz-danowski-559.workers.dev/` → 200
3. Po Phase 2 deploy: Worker logs przez 5 min — brak nowych bootstrap errors

## Performance Considerations

Nie dotyczy. Reading optional chaining `context.locals?.runtime?.env?.X` to ~5 nanosekund overhead per request — irrelevantnie.

## Migration Notes

- **GitHub Secrets manual setup**: user musi dodać `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` jako Repository Secrets (osobno od Worker Dashboard Secrets). Te SAME wartości, ale w 2 miejscach (GitHub dla build-time, Cloudflare dla runtime). Trade-off przyjęty świadomie (PUBLIC_* są bezpieczne w obu locations).
- **Rollback**: jeśli deploy padnie po Phase 2 fix, `git revert` commitu (lub `wrangler rollback` w Cloudflare Dashboard) cofa do poprzedniej wersji — która i tak była broken w prod. Realny rollback path: wrócić do hardcoded fallback (nieakceptowalne) lub fix forward.

## References

- Production error logs: Cloudflare Worker Dashboard logs 2026-05-26 (`[middleware] bootstrap failed` × N requests)
- F-01 substrate: [src/lib/db/supabase.server.ts](../../../src/lib/db/supabase.server.ts), [src/lib/db/supabase.browser.ts](../../../src/lib/db/supabase.browser.ts)
- F-02 substrate: [src/lib/middleware/handler.ts](../../../src/lib/middleware/handler.ts), [src/env.d.ts](../../../src/env.d.ts)
- Generated types: [worker-configuration.d.ts](../../../worker-configuration.d.ts) (wrangler typegen)
- Deploy workflow: [.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml)
- Konwencje Cloudflare: [CLAUDE.md § Cloudflare adapter](../../../CLAUDE.md) (do pełnego rewrite w Phase 1)
- Lessons: [context/foundation/lessons.md](../../foundation/lessons.md) (target dla nowego entry w Phase 1)
- `@astrojs/cloudflare` dev adapter parsuje .dev.vars: `node_modules/@astrojs/cloudflare/dist/index.js` (Vite plugin)
- `Runtime` type: `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Code + types + tests + docs

#### Automated

- [x] 1.1 `npm run typecheck` zielony — 0 błędów, `App.Locals extends Runtime<Env>` typowanie działa, server client czyta runtime.env bez `any` — bcfdd19
- [x] 1.2 `npm run lint` zielony na touched files (`src/env.d.ts` ignored per konwencji, reszta clean) — bcfdd19
- [x] 1.3 `npm run test` zielony — minimum 3 nowych testów w `tests/unit/lib/db/supabase.server.test.ts` + middleware.test.ts pozostaje zielony — bcfdd19

#### Manual

- [ ] 1.4 Code review: `supabase.server.ts` ma runtime-first ordering; browser.ts ma komentarz wyjaśniający; CLAUDE.md zawiera 3-środowiskową matrix; lessons.md ma nowy entry

### Phase 2: Deploy infrastructure + manual production verify

#### Automated

- [ ] 2.1 GitHub Actions deploy job (po push Phase 1 + Phase 2 commit) kończy się sukcesem — build step zielony z `PUBLIC_*` env, wrangler deploy step zielony

#### Manual

- [x] 2.2 GitHub Repository Secrets dodane: `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions)
- [ ] 2.3 `curl -i https://bookshelf.dariusz-danowski-559.workers.dev/` zwraca 200 (nie 500); body zawiera landing page HTML
- [ ] 2.4 Cloudflare Worker Dashboard → Logs: brak nowych `[middleware] bootstrap failed` ani `Brak PUBLIC_SUPABASE_URL` przez 5 minut po deploy
