---
project: bookshelf
checked_at: 2026-05-27T13:40:00Z
health_status: healthy
context_type: brownfield
language_family: js
stack_assessment_available: false
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 0
  moderate: 5
  low: 0
test_runner_detected: true
ci_provider: github_actions
recommended_fixes: 3
---

## Dependency Health

### Lockfile

```
Status: present (package-lock.json)
Package manager: npm
```

### Security Audit

```
Tool: npm audit --json
Summary: 0 CRITICAL, 0 HIGH, 5 MODERATE, 0 LOW
Direct vs transitive: 1 direct (MODERATE: @astrojs/check), 4 transitive (MODERATE)
```

Zero CRITICAL / HIGH. Wszystkie 5 MODERATE należą do **jednej** dev-time toolingowej chainy (`@astrojs/check` → language-server → yaml). Bez ekspozycji w runtime production bundle.

> **Delta od ostatniego raportu (2026-05-27, commit `52d2e42`)**: audit **9 → 5 MODERATE**. Sweep zależności (`change/dependency-update-pre-s03`, PR #5) bumpnął `wrangler` 4.93 → 4.95, co podciągnęło transitive `ws ≥ 8.20.1` — cała **Cloudflare runtime chain** (`wrangler`/`@cloudflare/vite-plugin` → `miniflare` → `ws`, GHSA-58qx-3vcg-4xpx) zniknęła. Zostaje wyłącznie Astro language-server chain.

#### MODERATE findings — szczegóły

Jedna utrzymująca się chaina (`yaml 2.0.0–2.8.2` GHSA-48c2-rrv3-qjmp, CVSS 4.3, Stack Overflow via deeply nested YAML):

- `@astrojs/check` (direct dev) → `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`
- Dev-only tooling (`astro check` w lokalnym dev + CI typecheck step). **Nie ships** do prod bundle.
- `fixAvailable: { @astrojs/check@0.9.2, isSemVerMajor: true }` — major downgrade, **nie wykonujemy** (zdegradowałby kompatybilność z Astro 6).

Status: „wait on upstream". Nie podejmować `npm audit fix --force`.

### Outdated Dependencies

```
Packages with available updates: 2 (oba deliberate major pins)
Major version gaps (deliberate pins): 2 (eslint, @eslint/js)
Patch/minor updates available: 0
```

Po sweepie (PR #5) wszystkie patch/minor podciągnięte — `npm outdated` zwraca już **tylko** dwa świadomie zapięte majory:

- `eslint` 9.39.4 → 10.4.0 (major) — pin na v9, bo `eslint-plugin-react@7.x` deklaruje `peer eslint: <=^9`. Czekamy na `eslint-plugin-react@8` (v10 peer) albo migrację na `@eslint-react/eslint-plugin`.
- `@eslint/js` 9.39.4 → 10.0.1 (major) — ten sam pin co `eslint`.

Zbumpane w tej sesji (PR #5, commit `d91ada2`): `astro` 6.3.5→6.3.8, `wrangler` 4.93→4.95, `@supabase/supabase-js` 2.106.0→2.106.2, `vitest` + `@vitest/coverage-v8` 4.1.6→4.1.7, `typescript-eslint` 8.59.4→8.60.0, `@astrojs/cloudflare` 13.5.2→13.5.5, oraz explicit `@anthropic-ai/sdk` 0.95.2→**0.99.0** (caret na 0.x blokował minor w `npm update`; nie importowany w `src/` → zero ryzyka, prep pod S-03 vision API).

## Test Suite

```
Test runner: Vitest 4.1.7 + Playwright 1.60.0
Tests found: 97 (14 unit test files)
Test execution: passing (97/97 zielone na main HEAD)
```

Konfiguracja:

```
vitest.config.ts        — jsdom env, setup at tests/unit/setup.ts, v8 coverage
playwright.config.ts    — chromium project, webServer wires `npm run dev` on :4321
tests/unit/setup.ts     — imports @testing-library/jest-dom/vitest
```

Kategorie unit testów (bez zmian od ostatniego raportu — sweep depów był non-breaking):

- `tests/unit/lib/shelves/schema.test.ts` (13) — Zod schema F-01/S-02
- `tests/unit/pages/api/shelves/{index,id}.test.ts` (21) — CRUD endpointy + F-02 envelope + Postgres SQLSTATE mapping
- `tests/unit/pages/api/auth/{login,signup,logout}.test.ts` — S-01 auth flow
- `tests/unit/pages/api/health.test.ts` (2) — health probe
- `tests/unit/components/LogoutButton.test.tsx` (2) — React island
- pozostałe: middleware, response helpers, auth schema

**E2E w CI** (PR #15, 2026-05-29): job `e2e` w `ci.yml` — efemeryczna lokalna Supabase (`supabase start` = migracje+seed, darmowy gate walidacji migracji) + chromium + `playwright test`; ostatni run **29 passed / 2 skipped** (mock vision browser-side, bez ANTHROPIC, zero kosztu LLM). **Lokalne** binarki Playwright (`npx playwright install --with-deps`) pozostają opcjonalne dla dev loop — CI instaluje własne.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml + .github/workflows/deploy.yml
```

### CI (.github/workflows/ci.yml)

Stages: `npm ci → wrangler types → lint → typecheck → test → build`

| Stage | Status | Notes |
|---|---|---|
| Lint | ✓ | `npm run lint` (ESLint v9 flat config) |
| Test | ✓ | `npm run test` (Vitest — match z detected runnerem) |
| Build | ✓ | `npm run build` (astro build) |
| Type check | ✓ | `npm run typecheck` (`astro check`), poprzedzony `npx wrangler types` |
| Security | ✗ | brak kroku scanowania (npm audit / Dependabot / CodeQL) — patrz Category A #3 |

`Generate Cloudflare Worker types` step regeneruje gitignored `worker-configuration.d.ts` przed `astro check` — eliminuje class incydentów „CI sees `import 'cloudflare:workers'` jako missing module".

### Deploy (.github/workflows/deploy.yml)

Stages: `npm ci → build (z PUBLIC_* env z GitHub Secrets) → wrangler deploy (cloudflare/wrangler-action@v4) → smoke test`

| Stage | Status | Notes |
|---|---|---|
| Build | ✓ | PUBLIC_* z GitHub Secrets (Vite inlining dla browser bundle) |
| Deploy | ✓ | `cloudflare/wrangler-action@v4`, command `deploy` |
| **Post-deploy smoke** | ✓ **NOWE** | `curl --fail-with-body $deployment-url/api/health` + walidacja body `"status":"ok"` |

> **Delta**: post-deploy smoke step dodany (D1, PR #4, commit `2991f77`) — **zamyka** wieloraportową lukę Category B „Brak post-deploy smoke step". URL z `wrangler-action` output `deployment-url`. Pojedynczy probe na `/api/health` (świadoma adaptacja vs health+auth-login: login zwraca generic 401 dla creds i dla anon-key drift → nie odróżnia wired/drifted; health ćwiczy konstrukcję klienta Supabase przez middleware, więc łapie brakujące sekrety jako 500). Pełny zielony/czerwony przebieg zweryfikuje się przy najbliższym deploy run.

PUBLIC_* secrets → build-time env; SERVICE_ROLE_KEY + ANTHROPIC_API_KEY server-only runtime (Worker Dashboard Secrets) — zgodne z CLAUDE.md env-wiring matrix.

## Configuration

### High severity

(none — TypeScript `strict` enforced via `extends: astro/tsconfigs/strict`, `.gitignore` present.)

### Medium severity

(none — ESLint configured via `eslint.config.mjs` flat config; Prettier configured via `.prettierrc.json` + `.prettierignore`.)

### Low severity

(none — `.editorconfig` (188 B), `.env.example` (426 B) dokumentuje cztery wymagane sekrety, oba present.)

Wszystkie Category A configuration gaps z poprzednich raportów zamknięte. Pełny inwentarz present: `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `tsconfig.json` (strict), `vitest.config.ts`, `playwright.config.ts`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`.

## Agent infrastructure

Stan komponentów agent-workflow (delta od `52d2e42` zaznaczona):

- `CLAUDE.md` — 23.4 KB (~200 non-blank linii). **Delta**: +2 bullety w § Workflow agenta — „Plan-review obligatoryjny" (B4, commit `52e2384`) i „Model per faza" (E2, `1c548af`). Soft length-watch: przy A1 rule-review (2026-05-27) długość była już WARN (198 linii); kolejne reguły domenowe (S-03 vision) lepiej kierować do per-area `AGENTS.md` — patrz Category A #2.
- `.claude/settings.json` — 40 allow / 17 ask / 17 deny + `enabledMcpjsonServers: [cloudflare, exa, context7]` (commit `cb4fe31`). Hard-blocks destructive ops.
- `.mcp.json` — **3 MCP servers** (cloudflare/exa/context7), wszystkie `✓ Connected` (`claude mcp list`; Cloudflare po jednorazowym OAuth). **Delta**: poprzedni raport notował „MCP servers: 0 configured (gap)" — **luka zamknięta** (A4/A5/A6, commit `7fa3b21`). Context7 użyty realnie w tej sesji (weryfikacja `wrangler-action` output).
- `context/foundation/lessons.md` — 12 captured recurring rules.
- `context/archive/` — 8 archived changes. (D1 + dependency sweep szły jako micro-slice'y bez `/10x-archive`.)
- `context/foundation/roadmap.md` — 7 done / 6 proposed.
- `AGENTS.md` — present (3.3 KB).

## Stack Assessment Cross-Reference

No `context/foundation/stack-assessment.md` found. Run `/10x-stack-assess` jeśli potrzeba written quality-gate analysis. Nie blokujące — stack to `10x-astro-starter` recommended-default zaliczający wszystkie 4 quality gates per registry.

## Recommended Fixes

### Fix before agent work (Category A)

Brak blockerów. Wszystkie pozycje z poprzednich raportów zamknięte (lockfile present, 0 HIGH/CRITICAL, test runner + 97 tests green, TypeScript strict, ESLint + Prettier configured, CI/CD wired + post-deploy smoke, .editorconfig + .env.example present, MCP servers configured). Pozostałe to nice-to-have:

#### 1. Manual: install Playwright browsers (jednorazowe)

**Impact**: medium — bez binarek golden-path E2E (`tests/e2e/upload-flow.spec.ts`) nie poleci ani lokalnie, ani w CI; agent nie ma end-to-end feedback loop na flow upload→detect→confirm.
**Severity**: low
**Effort**: quick (<5 min na połączeniu które przejdzie do `cdn.playwright.dev`, ~600 MB)
**Fix**:

```powershell
npx playwright install --with-deps
```

#### 2. Per-area `AGENTS.md` przed S-03 (`src/lib/vision/`)

**Impact**: medium — `CLAUDE.md` (~200 linii) jest na progu U-shaped-attention. Reguły domenowe vision (prompt convention, retry-with-thinking policy, cost tracking) lepiej żyją obok kodu niż w rozrastającym się root rules file.
**Severity**: low
**Effort**: moderate (15–30 min, naturalnie przy `/10x-plan` S-03)
**Fix**: wynieść vision-specific reguły do `src/lib/vision/AGENTS.md` (item C3 w `m1m2-lessons-audit-plan.md`). Skill `/10x-plan` może to zarejestrować jako changes required.

#### 3. (opcjonalne) Automated dependency scanning w CI

**Impact**: low — obecnie audit jest manualny (przez ten health-check). Dependabot / `npm audit` step w CI dałby ciągły sygnał o nowych CVE bez czekania na regen raportu.
**Severity**: low
**Effort**: quick (<5 min)
**Fix**: dodać `.github/dependabot.yml` (weekly npm ecosystem) albo `npm audit --audit-level=high` step w `ci.yml` (non-blocking dla MODERATE, fail na HIGH+).

#### Deliberate pins (no action)

- `eslint` / `@eslint/js` v9 → v10 — zapięte do czasu `eslint-plugin-react@8` lub migracji pluginu. Nie odpalać `npm i eslint@latest` bez planu zamiany pluginu.

### Addressed in upcoming lessons (Category B)

Brak otwartych Category B. Dwie historyczne pozycje zamknięte w tej sesji:

- ~~Post-deploy smoke test~~ → **DONE** (D1, PR #4) — smoke step `curl /api/health` w `deploy.yml`.
- ~~MCP servers (Cloudflare/Exa/Context7)~~ → **DONE** (A4/A5/A6) — `.mcp.json` z 3 serverami, wszystkie connected.

## Summary

Health status: **healthy**

Wszystkie wskaźniki agent-readiness silnie zielone i poprawione od ostatniego raportu (`52d2e42`): audit **9 → 5 MODERATE** (Cloudflare `ws` chain rozwiązana przez bump wrangler 4.95), dependency tree świeży (tylko 2 deliberate eslint piny zostają), post-deploy smoke test wprowadzony do `deploy.yml`, 3 MCP servers podłączone. Test suite 97/97 zielona, CI pipeline kompletny (lint+typecheck+test+build), deploy z weryfikacją liveness. Pozostałe 5 MODERATE to dev-only Astro language-server chain czekająca na upstream — bez ekspozycji w prod bundle.

Mocne strony specyficzne dla projektu:

1. **Agent feedback loop kompletny + zweryfikowany w prod** — lint+typecheck+test+build zielone, dev cycle <15s, plus post-deploy smoke wykrywa zombie-deploy / secret drift w ~30s.
2. **Dependency hygiene** — sweep pre-S-03 wyczyścił wszystkie patch/minor; `@anthropic-ai/sdk` na 0.99 gotowy pod vision API; audit zredukowany o połowę.
3. **MCP research/docs/ops tooling** operacyjne — Context7 (live docs), Exa (research), Cloudflare (Worker logs/secrets) eliminują memory-hallucination i „nie widzę Worker logs" class.
4. **Defense-in-depth invariants + F-01/F-02 substrate** stabilne — kolejne slice'y konsumują bez friction.

Next step: nic blokującego. Projekt jest agent-ready dla S-03 vision detection. Naturalna ścieżka prep: `npx playwright install` (E2E loop) → B1 `/10x-research shelf-photo-vision-detection` + B2 Context7 fetch `@anthropic-ai/sdk` 0.99 → `/10x-plan` (Opus) → B4 `/10x-plan-review` → `/10x-implement` (Sonnet). Przy S-03 wydzielić `src/lib/vision/AGENTS.md` (Category A #2).
