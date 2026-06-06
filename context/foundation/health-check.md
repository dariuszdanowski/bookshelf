---
project: bookshelf
checked_at: 2026-06-06T18:30:00Z
health_status: healthy
context_type: brownfield
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

Zero CRITICAL / HIGH. Stan **identyczny** z poprzednim raportem (2026-05-27 → 2026-06-06, HEAD `998f9d9`): wszystkie 5 MODERATE to ta sama, jedna dev-time chaina `@astrojs/check` → `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml` (GHSA-48c2-rrv3-qjmp, CVSS 4.3, Stack Overflow via deeply nested YAML). Dev-only tooling (`astro check` lokalnie + CI typecheck) — **nie ships** do prod bundle.

`fixAvailable: @astrojs/check@0.9.2 (isSemVerMajor)` — major **downgrade**, nie wykonujemy (zdegradowałby kompatybilność z Astro 6). Status: „wait on upstream". Nie podejmować `npm audit fix --force`.

### Outdated Dependencies

```
Packages with available updates: 17
Major version gaps: 3 (eslint, @eslint/js — deliberate pins; tesseract.js — NOWY gap)
Patch/minor updates available: 14
```

Delta od ostatniego sweepu (PR #5, 2026-05-27) — narosła nowa porcja patch/minor (normalny dryf 10 dni):

- **Minor/patch dostępne**: `astro` 6.3.8→6.4.4, `wrangler` 4.95→4.98, `@astrojs/cloudflare` 13.5.5→13.6.1, `@supabase/supabase-js` 2.106.2→2.107.0, `vitest`+`@vitest/coverage-v8` 4.1.7→4.1.8, `react`/`react-dom` 19.2.6→19.2.7, `@astrojs/react` 5.0.5→5.0.7, `typescript-eslint` 8.60.0→8.60.1, `@types/node`, `@types/react`, `@cf-wasm/photon` 0.3.5→0.3.6, `@anthropic-ai/sdk` 0.99→0.101 (0.x caret nie podciągnie przez `npm update` — explicit bump jak poprzednio).
- **`tesseract.js` 6.0.1 → 7.0.0 (major, NOWY)** — pojawił się w deps od czasu poprzedniego raportu (pipeline refine/OCR). Major bump wymaga przeglądu changeloga przed podjęciem; nieblokujące.
- **Deliberate pins (bez zmian)**: `eslint` 9.39.4 (latest 10.4.1) + `@eslint/js` 9.39.4 — zapięte do `eslint-plugin-react@8` lub migracji na `@eslint-react/eslint-plugin`.

## Test Suite

```
Test runner: Vitest 4.1.7 + Playwright 1.60.0
Tests found: 845 unit (76 plików) + 28 plików E2E + 3 integracyjne (RLS isolation)
Test execution: passing (845/845 zielone lokalnie na main HEAD; CI verify + e2e green)
```

> **Delta od ostatniego raportu (2026-05-27, 97 testów / 14 plików)**: suite urosła **~8.7×** — 845 unit testów w 76 plikach. E2E z 5 → **28 spec'ów** (auth, shelves, upload-flow, photos-crud, photo-dedup, bbox-editor/navigation, overlay-zoom-pan, detection-list-views, account, account-keys, byok-enforcement, cost-panel, manual-rematch, force-refine, book-* itd.). Testy integracyjne RLS (`tests/integration/`, 3 pliki) **uruchamiane automatycznie w CI** na efemerycznej lokalnej Supabase — wcześniej `describe.skip` bez env, walidowane tylko ręcznie.

Konfiguracja:

```
vitest.config.ts               — jsdom env, setup at tests/unit/setup.ts, v8 coverage
vitest.integration.config.ts   — env z .dev.vars, realny Supabase (CI: 127.0.0.1:54321)
playwright.config.ts           — chromium + setup/cleanup projects, storageState, webServer :4321
```

Lokalne binarki Playwright **zainstalowane** (chromium-1223 + headless shell + firefox/webkit) — Category A #1 z poprzedniego raportu **zamknięte**.

Formalna mapa ryzyk: `context/foundation/test-plan.md` (Phase 1 complete, PR #39, 2026-06-04) — item #4 z `m3-integration-plan.md` **zamknięty**.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml + .github/workflows/deploy.yml
Ostatnie runy na main: CI ✓ success, Deploy ✓ success (2026-06-06, PR #50)
```

### CI (.github/workflows/ci.yml)

Dwa joby: `verify` (npm ci → wrangler types → lint → typecheck → unit → build) + `e2e` (efemeryczna lokalna Supabase = darmowy gate walidacji migracji → warm-up auth JWT-iat-skew → **testy integracyjne RLS** → Playwright E2E z mock vision → artifact playwright-report).

| Stage | Status | Notes |
|---|---|---|
| Lint | ✓ | `npm run lint` (ESLint v9 flat config) |
| Typecheck | ✓ | `astro check` poprzedzony `npx wrangler types` |
| Unit tests | ✓ | Vitest, 845 testów |
| Integration (RLS) | ✓ **NOWE** | `npm run test:integration` na lokalnej Supabase w CI — guardrail prywatności #1 z test-plan.md |
| E2E | ✓ **NOWE** (vs raport 05-27) | job `e2e`: Playwright + mock vision browser-side, zero kosztu LLM |
| Build | ✓ | `npm run build` |
| Security | ✗ | nadal brak kroku scanowania (npm audit / Dependabot) — jedyna otwarta rekomendacja |

### Deploy (.github/workflows/deploy.yml)

Stages: build (PUBLIC_* z GitHub Secrets) → **migrate-first** `supabase db push` (miękki guard na brak sekretów) → `wrangler deploy` (wrangler-action@v4) → **post-deploy smoke** (`/api/health` + walidacja body). Concurrency group na deploy. Ostatni run zielony.

## Configuration

### High severity

(none — TypeScript `strict`, `.gitignore` present.)

### Medium severity

(none — ESLint flat config + Prettier present.)

### Low severity

- `tmp-ux-shots/` untracked w working tree — artefakt sesyjny do sprzątnięcia lub dopisania do `.gitignore` (kosmetyka, nie wpływa na werdykt).

Pełny inwentarz present: `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `tsconfig.json` (strict), `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `context/foundation/test-plan.md`.

## Agent infrastructure

- `CLAUDE.md` — rozbudowany (sekcje M3L4 E2E rules dodane); length-watch nadal aktualny, ale reguły domenowe vision wyniesione do per-area pliku.
- `src/lib/vision/AGENTS.md` — **present** (Category A #2 z poprzedniego raportu **zamknięte**).
- `.claude/settings.json` — PostToolUse hook (`.claude/hooks/post-edit-lint.cjs` — ESLint --fix na edytowanym pliku, advisory) — item #1 z m3-integration-plan **done**.
- `context/foundation/lessons.md` — present; `context/archive/` — **33 archived changes** (8 → 33).
- `context/foundation/roadmap.md` — **26 done / 13 proposed** (poprzednio 7/6); north star S-05 + cały Flow A/B + BYOK pipeline (S-31–S-35) done.
- `.mcp.json` — 3 MCP servers (cloudflare/exa/context7).

## Realizacja zaleceń z poprzedniego raportu

| Zalecenie (2026-05-27) | Status |
|---|---|
| #1 `npx playwright install --with-deps` | ✅ **DONE** — binarki obecne, 28 E2E spec'ów biega lokalnie i w CI |
| #2 Per-area `AGENTS.md` dla `src/lib/vision/` przed S-03 | ✅ **DONE** — `src/lib/vision/AGENTS.md` istnieje |
| #3 (opcjonalne) Automated dependency scanning w CI | ❌ **OPEN** — brak `.github/dependabot.yml` i brak `npm audit` step w ci.yml |
| Deliberate eslint pins — no action | ✅ utrzymane zgodnie z planem |

Z `m3-integration-plan.md`: items 1 (PostToolUse hook), 2 (E2E rules w CLAUDE.md), 4 (test-plan.md) **done**; items 5–6 (Lefthook, Stryker) otwarte — oznaczone tam jako „tylko certyfikacja, niski ROI" (nie są twardym wymogiem; zob. niżej).

## Certyfikacja 10xDevs 3.0 — stan wymogów

Sześć twardych wymogów (lekcja 4.2, `analiza-projektu-kursowego.md` §1):

| # | Wymóg | Stan | Dowód |
|---|---|---|---|
| 1 | Kontrola dostępu | ✅ | Supabase Auth (S-01) + RLS `user_id = auth.uid()` na każdej tabeli (F-01) + middleware guard (F-02) + **testy integracyjne RLS w CI** (dowód automatyczny izolacji per-user) |
| 2 | CRUD domenowy | ✅ | Półki (S-02), książki (S-05/S-22/S-34), zdjęcia (S-29 pełny CRUD), klucze BYOK (S-32) — dane wynikają z domeny, nie sztuczne |
| 3 | Logika biznesowa | ✅ | Jednozdaniowa: zdjęcie → vision-detekcja → matching scoring (0.75/0.55) → dedup (ISBN/fuzzy) → ranking → telemetria korekt. Plus BYOK enforcement (S-33), koszt-preservation (S-30) |
| 4 | Artefakty M1–M3 | ✅ | `docs/prd.md`, `docs/plan-implementacji.md`, `context/foundation/{roadmap,test-plan,lessons,health-check}.md`, `CLAUDE.md`, `AGENTS.md`, `src/lib/vision/AGENTS.md`, 33 zarchiwizowane change'e (plan→implement→review→archive) |
| 5 | ≥ 1 test E2E | ✅ | 28 spec'ów Playwright, golden path `upload → detect → confirm → catalog` (`upload-flow`, `proposal-accept-to-catalog`), w CI na każdym PR |
| 6 | CI/CD | ✅ | GitHub Actions: lint+typecheck+unit+integration+E2E+build (ci.yml) + migrate-first deploy CF Workers + post-deploy smoke (deploy.yml); publiczny deployment działa (smoke green) |

**Werdykt certyfikacyjny: wszystkie 6 twardych wymogów spełnione i udowodnione automatami.**

Pozostałe elementy do **złożenia** pracy (nie wymogi techniczne, lecz checklist oddania — M3 DoD z `docs/plan-implementacji.md`):

| Element | Stan | Działanie |
|---|---|---|
| README z screenshotami + quick-start | ✅ done | 6 screenshotów w `docs/screenshots/`, sekcje Stack/Architektura/Szybki start |
| Demo content (3 półki, ~30 książek) | ⚠ user-only | przygotować na koncie demo przed oddaniem (manual) |
| Self-review pod 6 wymogów | ⚠ open | przejść formalnie 6 wierszy tabeli wyżej z linkami do kodu/testów — materiał do zgłoszenia (1. termin: 5.07.2026, bufor 29 dni) |
| (opcjonalnie) Lefthook / Stryker jako dowód adopcji lekcji M3 | ⚠ open, niski ROI | tylko jeśli forma zgłoszenia wymaga pokazania artefaktów per-lekcja; nie jest twardym wymogiem |

## Recommended Fixes

### Fix before agent work (Category A)

Brak blockerów. Nice-to-have:

#### 1. Automated dependency scanning w CI (przeniesione z poprzedniego raportu — jedyne niezrealizowane)

**Impact**: low — audit jest manualny (przez ten health-check); Dependabot dałby ciągły sygnał o nowych CVE.
**Severity**: low · **Effort**: quick (<5 min)
**Fix**: `.github/dependabot.yml` (weekly npm) lub step `npm audit --audit-level=high` w ci.yml (fail tylko na HIGH+).

#### 2. Patch/minor sweep + przegląd `tesseract.js` 7

**Impact**: low-medium — 14 patch/minor zaległych (10 dni dryfu) + nowy major `tesseract.js` 6→7 w ścieżce refine/OCR.
**Severity**: low · **Effort**: moderate (sweep ~15 min + changelog tesseract przed majorem)
**Fix**: osobny branch `change/dependency-sweep`, `npm update` + explicit `@anthropic-ai/sdk@0.101`, tesseract major tylko po przeczytaniu migration notes; pełny CI gate zweryfikuje.

#### 3. Sprzątnięcie `tmp-ux-shots/`

**Impact**: kosmetyka. **Effort**: quick. Usunąć lub dopisać do `.gitignore`.

#### Deliberate pins (no action)

- `eslint` / `@eslint/js` v9 → v10 — bez zmian, czekamy na `eslint-plugin-react@8`.
- 5 MODERATE audit (Astro language-server yaml chain) — wait on upstream.

### Addressed in upcoming lessons (Category B)

Brak otwartych. Wszystkie historyczne pozycje zamknięte (post-deploy smoke, MCP, E2E w CI, test-plan.md, PostToolUse hook, per-area AGENTS.md).

## Summary

Health status: **healthy**

Projekt od poprzedniego raportu (2026-05-27, `52d2e42`) przeszedł z fazy substrate do **funkcjonalnie kompletnego MVP+**: suite testowa 97 → 845 unit + 28 E2E + 3 integracyjne RLS (wszystko w CI), roadmapa 7 → 26 slice'ów done (pełny Flow A/B, BYOK multi-provider, photos CRUD, cost preservation), archiwum 8 → 33 change'ów, CI rozbudowane o job e2e z efemeryczną Supabase i automatyczną walidacją migracji, deploy z migrate-first + smoke. Audit bez zmian (5 MODERATE dev-only, wait-on-upstream), zero CRITICAL/HIGH.

**Zalecenia z poprzedniego audytu: 2/3 zrealizowane** (Playwright binaria, vision AGENTS.md); otwarte tylko opcjonalne dependency scanning w CI.

**Certyfikacja: wszystkie 6 twardych wymogów spełnione.** Do oddania (termin 5.07) zostają wyłącznie czynności submission-level: demo content (user-only), formalny self-review pod 6 wymogów, opcjonalnie artefakty per-lekcja M3 (Lefthook/Stryker — niski ROI). Projekt jest gotowy do zgłoszenia w 1. terminie z dużym buforem.
