---
project: bookshelf
checked_at: 2026-05-27T09:35:00Z
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
  - agent_infrastructure
audit_findings:
  critical: 0
  high: 0
  moderate: 9
  low: 0
test_runner_detected: true
ci_provider: github_actions
recommended_fixes: 2
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
Summary: 0 CRITICAL, 0 HIGH, 9 MODERATE, 0 LOW
Direct vs transitive: 2 direct (MODERATE: @astrojs/check, wrangler), 7 transitive (MODERATE)
```

Zero CRITICAL / HIGH findings. Wszystkie 9 MODERATE są dev-time tooling chains — bez ekspozycji w runtime production bundle.

#### MODERATE findings — szczegóły

Dwa łańcuchy wciąż się utrzymują:

- **Cloudflare runtime chain** (`ws ≥8.0.0 <8.20.1` GHSA-58qx-3vcg-4xpx, CVSS 4.4, uninitialized memory disclosure):
  - `wrangler` (direct) → `miniflare` → `ws`
  - `@cloudflare/vite-plugin` (transitive via wrangler) → `miniflare` → `ws`
  - `fixAvailable: true` ale wymagałby downgrade'u `@astrojs/cloudflare` / `wrangler` na starsze majory (npm audit fix --force ścieżka). Czekamy na transitive bump do `ws ≥ 8.20.1`.

- **Astro language-server chain** (`yaml 2.0.0–2.8.2` GHSA-48c2-rrv3-qjmp, CVSS 4.3, Stack Overflow via deeply nested YAML):
  - `@astrojs/check` (direct) → `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`
  - Dev-only tooling (`astro check` w lokalnym dev + CI typecheck step). Nie ships do prod bundle.
  - `fixAvailable: { @astrojs/check@0.9.2, isSemVerMajor: true }` — major downgrade, nie wykonujemy.

Obie chainy zostają jako „wait on upstream". Nie podejmować `npm audit fix --force` — zdegraduje Cloudflare adapter / Astro check do starszych majorów i zerwie kompatybilność z Astro 6.

### Outdated Dependencies

```
Packages with available updates: 10
Major version gaps (deliberate pins): 2 (eslint, @eslint/js)
Patch/minor updates available: 8
```

Minor/patch updates dostępne (do podjęcia w jednym sweep `npm update`):

- `@anthropic-ai/sdk` 0.95.2 → 0.99.0 (minor) — przed S-03 vision detection warto bump (Context7 fetch zweryfikuje aktualną API surface)
- `@astrojs/cloudflare` 13.5.2 → 13.5.5 (patch)
- `@supabase/supabase-js` 2.106.0 → 2.106.2 (patch)
- `@vitest/coverage-v8` 4.1.6 → 4.1.7 (patch)
- `astro` 6.3.5 → 6.3.8 (patch)
- `typescript-eslint` 8.59.4 → 8.60.0 (patch)
- `vitest` 4.1.6 → 4.1.7 (patch)
- `wrangler` 4.93.0 → 4.95.0 (patch) — możliwe że nowsza wersja podciągnie `ws ≥ 8.20.1` transitive

Deliberate pins (no action):

- `eslint` 9.39.4 → 10.4.0 (major) — pinowany na v9 bo `eslint-plugin-react@7.x` declares `peer eslint: <=^9`. Czekamy na release `eslint-plugin-react@8` z v10 peer support albo migrujemy na `@eslint-react/eslint-plugin`.
- `@eslint/js` 9.39.4 → 10.0.1 (major) — same pin co `eslint`.

## Test Suite

```
Test runner: Vitest 4.1.6 + Playwright 1.60.0
Test files: 14
Tests: 97 passed (97)
Test execution: 10.61s wall clock; pełne uruchomienie zielone
```

Konfiguracja:

```
vitest.config.ts        — jsdom env, setup at tests/unit/setup.ts, v8 coverage
playwright.config.ts    — chromium project, webServer wires `npm run dev` on :4321
tests/unit/setup.ts     — imports @testing-library/jest-dom/vitest
```

Coverage rośnie organicznie (od poprzedniego reportu z 2/2 testów → 97 testów po S-01 + S-02). Kategorie:

- `tests/unit/lib/shelves/schema.test.ts` (13 tests) — Zod schema dla F-01/S-02
- `tests/unit/pages/api/shelves/{index,id}.test.ts` (21 tests) — CRUD endpointy z F-02 envelope + Postgres SQLSTATE mapping
- `tests/unit/pages/api/auth/{login,signup,logout}.test.ts` — S-01 auth flow
- `tests/unit/pages/api/health.test.ts` (2 tests) — initial health probe
- `tests/unit/components/LogoutButton.test.tsx` (2 tests) — first React island test
- pozostałe: middleware, response helpers, auth schema

Outstanding manual step (od poprzedniego reportu, dalej): `npx playwright install --with-deps` (~600 MB browser binaries). Deliberatie skipped z agent fixes — wymaga sieci/firewalla.

## CI/CD

```
Provider: GitHub Actions
Workflows: .github/workflows/ci.yml + .github/workflows/deploy.yml
```

CI/CD w pełni operacyjne — luka z poprzedniego reportu (Category B) zamknięta.

### CI (.github/workflows/ci.yml)

Stages: `npm ci → wrangler types → lint → typecheck → test → build`

- `Generate Cloudflare Worker types` step (commit z PR #2, captured w lesson 10 `lessons.md`) regeneruje gitignored `worker-configuration.d.ts` przed `astro check` — eliminuje class incydentów „CI sees `import 'cloudflare:workers'` jako missing module" z fresh runnera.

### Deploy (.github/workflows/deploy.yml)

Stages: `npm ci → build (z PUBLIC_* env z GitHub Secrets) → wrangler deploy (cloudflare/wrangler-action@v4)`

- PUBLIC_* secrets idą do build-time env (Vite inlining dla browser bundle), SERVICE_ROLE_KEY + ANTHROPIC_API_KEY pozostają server-only runtime (Worker Dashboard Secrets) — zgodne z CLAUDE.md env-wiring matrix.
- Brak post-deploy smoke step (curl /api/health) — Category A (D1 item w m1m2-lessons-audit-plan.md jako mały slice w branch-per-change).

## Configuration

### High severity

(none — TypeScript `strict` enforced via `extends: astro/tsconfigs/strict`, `.gitignore` present.)

### Medium severity

(none — ESLint configured via `eslint.config.mjs` flat config; Prettier configured via `.prettierrc.json` + `.prettierignore`.)

### Low severity

(none — `.editorconfig` dodany (188 bytes, 2026-05-20), `.env.example` (426 bytes) dokumentuje cztery wymagane sekrety.)

Wszystkie Category A configuration gaps z poprzednich raportów zamknięte.

## Agent infrastructure

Stan dodatkowych komponentów wprowadzonych w sesjach M1L4 + M2:

- `CLAUDE.md` — 198 non-blank linii (po reorder z A1 quick win 2026-05-27, commit `2cc7ebe`). Workflow agenta na top, Cloudflare adapter #3, Konwencje #4. Wszystkie reguły load-bearing w górnej połowie pliku.
- `.claude/settings.json` — permission policy z 40 allow + 17 ask + 17 deny rules (commit `71f363b` 2026-05-27 quick win A2). Hard-blocks destructive ops (force-push, --no-verify, --amend, supabase db reset, repo delete).
- `context/foundation/lessons.md` — 12 captured recurring rules (Postgres error mapping, branch-per-change, generated artifacts w CI, polish typographic quotes w JSX, navigation entry point per page itp.).
- `context/archive/` — 8 archived changes (`f-01-data-substrate`, `f-02-api-envelope`, `s-01-*`, `s-02-shelves-crud-and-purchased`, `s-09-13-*`).
- `context/foundation/roadmap.md` — single source of truth dla slice dependencies. 7 done / 6 proposed.
- MCP servers: 0 configured (gap — A4/A5/A6 quick wins planowane do realizacji w tej sesji).

## Stack Assessment Cross-Reference

No `context/foundation/stack-assessment.md` found. Not strictly necessary — stack jest `10x-astro-starter` recommended-default, który zalicza wszystkie 4 quality gates per registry. Run `/10x-stack-assess` jeśli potrzeba written analysis dla dokumentacji.

## Recommended Fixes

### Fix before agent work (Category A)

(brak — wszystkie pozycje z poprzednich raportów zamknięte: lockfile present, no HIGH/CRITICAL audits, test runner installed + 97 tests green, TypeScript strict on, ESLint configured, Prettier configured, CI/CD wired, .editorconfig present)

### Nice-to-have przed S-03 (Category A')

#### 1. `npm update` minor/patch sweep (opcjonalne, ~5 min)

**Impact**: niska — 8 patch/minor updates. `@anthropic-ai/sdk` 0.95 → 0.99 minor jest najistotniejszy bo S-03 będzie konsumować vision API. Bump przed `/10x-research shelf-photo-vision-detection` żeby Context7 query trafił aktualną API surface.

**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: `npm update` w wydzielonym branchu (`change/dependency-update-pre-s03`), zmierzyć czy test suite zielony, PR → merge.

#### 2. Manual: install Playwright browsers (jednorazowe)

Nie lekcja, tylko chore: `npx playwright install --with-deps` gdy jesteś na połączeniu które przejdzie do `cdn.playwright.dev` (~600 MB). Po tym `npm run test:e2e` smoke spec zadziała end-to-end. Aktualnie 0 e2e tests w CI (tylko unit + Playwright config jest gotowy).

### Addressed in upcoming work (Category B)

#### Post-deploy smoke test step w `deploy.yml`

**Trackowane**: D1 w `c:\Projekty\10xDevs\analiza\m1m2-lessons-audit-plan.md`
**What it does**: post-deploy step robi `curl --fail-with-body $PROD_URL/api/health` + body validation — wykrywa Worker Secrets mismatch w prod w 30s zamiast czekać na user incident
**Plan**: mały slice (~30 min) via branch-per-change `change/deploy-smoke-automation`.

#### MCP servers (Cloudflare, Exa, Context7)

**Trackowane**: A4/A5/A6 w lessons audit plan
**What it does**: agent dostaje aktualne docs (Context7), agentic search (Exa), Cloudflare Workers ops (logs, secrets list) bez wychodzenia z sesji
**Plan**: realizacja w obecnej sesji (po A3 health-check).

## Summary

Health status: **healthy**

Wszystkie wskaźniki agent-readiness silnie zielone. Od poprzedniego reportu (`2026-05-25`) zamknięte: CI/CD wired (lint+typecheck+test+build+deploy), `.editorconfig` dodany, test suite urosła z 2 → 97 tests, 12 lessons.md entries captured organicznie, branch-per-change workflow operacyjny (3 PRs zmergowane), CLAUDE.md i `.claude/settings.json` quick win-reorganizowane. Audit dependency tree: 0 CRITICAL / 0 HIGH (utrzymane), 9 MODERATE all dev-time tooling chains czekające na upstream.

Mocne strony specyficzne dla projektu:

1. **Agent feedback loop kompletny** — lint+typecheck+test+build wszystko zielone, dev cycle <15s, CI cycle <2min.
2. **Defense-in-depth invariants** — DB triggery (handle_new_user, prevent_zakupione_*) + Zod refuse + UI guard. Captured jako lessons.
3. **F-01/F-02 substrate** stabilny — typed Supabase clients, F-02 envelope, Postgres SQLSTATE mapping — kolejne slice'y konsumują bez friction.
4. **Branch-per-change workflow** zinternalizowany w CLAUDE.md (top section) + .claude/settings.json (gh pr create ask, gh pr merge ask, supabase db push ask).

Next step: nic blokującego. Quick wins audit plan (A4/A5/A6 MCP setup) i przed S-03 (B1 research + B2 Context7 fetch SDK) to natural prep dla vision detection slice — w trakcie obecnej sesji.
