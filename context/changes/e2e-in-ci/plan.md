# Wpięcie testów E2E (Playwright) w CI — Implementation Plan

## Overview

Domknięcie wymogu certyfikacji 10xDevs #5 (test E2E) i #6 (CI: lint + typecheck + vitest + **playwright** + deploy). 10 speców Playwright już istnieje w `tests/e2e/`, ale `ci.yml` ich nie uruchamia. Dodajemy osobny job `e2e`, który stawia efemeryczną lokalną Supabose w runnerze, wpina env, instaluje przeglądarkę i odpala `playwright test`.

## Current State Analysis

- **`ci.yml`** — pojedynczy job `verify`: `npm ci → wrangler types → lint → typecheck → test → build`. **Brak kroku playwright.**
- **`tests/e2e/`** — 10 speców (auth, shelves, add-purchase, proposal-accept, catalog-search, shelf-photo-pipeline-ui, upload-flow, smoke) + `auth.setup.ts` (realny signup → storageState) + `auth.teardown.ts` (kasuje usera, best-effort, wymaga service-role).
- **`playwright.config.ts`** — projekty `setup`→`chromium`→`cleanup`; `webServer` startuje `npm run dev` na :4321; `baseURL` localhost:4321; CI: `workers:1`, `retries:2`, reporter `list`+`html`.
- **Mockowanie kosztu**: vision/match/storage mockowane na poziomie **API w przeglądarce** (`page.route('**/api/photos/${id}/process', ...)`) — server-side vision NIE jest wykonywany ⇒ **CI nie potrzebuje `ANTHROPIC_API_KEY`** ani realnego klucza (zero kosztu Anthropic, zgodne z guardrailem CLAUDE.md § Testy).
- **Env flow** (CLAUDE.md matrix): Astro dev czyta env wyłącznie z `.dev.vars` (`KEY=value`), zarówno server (`cloudflare:workers`/fallback) jak i browser (`import.meta.env.PUBLIC_*` inline). `.dev.vars` jest gitignored.
- **`auth.setup.ts`** robi realny `POST /signup`; `supabase/config.toml` ma `enable_confirmations = false` ⇒ signup auto-loguje (zgodne z oczekiwaniem setupu: `waitForURL('/')`).
- **`supabase start`** stosuje migracje + `seed.sql` automatycznie; `seed.sql` jest pusty (placeholder) ⇒ zero konfliktów. `project_id = "bookshelf"`. Na Linuksie (CI) Supabase nasłuchuje na `127.0.0.1:54321` — bez problemu WSL-IP (ten dotyczy tylko Windows dev).
- **Migracja 0011** na tym branchu jest już w wersji IMMUTABLE (po PR #14) ⇒ `supabase start` zaaplikuje ją czysto.

## Desired End State

`ci.yml` ma drugi job `e2e`, który na każdym PR do main i push do main: stawia lokalną Supabose, generuje `.dev.vars`, instaluje chromium, odpala `playwright test` i przechodzi na zielono (10 speców). Przy faili wgrywa `playwright-report/` jako artefakt. Wymóg certyfikacji #5 i #6 zamknięte do pełnego ✅.

### Key Discoveries:

- Vision mockowany browser-side (`tests/e2e/shelf-photo-pipeline-ui.spec.ts:170-204`) ⇒ brak realnego LLM w CI.
- Env wyłącznie przez `.dev.vars` (`scripts/switch-env.mjs`, CLAUDE.md env matrix).
- `supabase start` = darmowy gate walidacji migracji (złapałby klasę bugów 42P17 jak dzisiejszy 0011).
- Lokalne klucze Supabase czytamy runtime z `supabase status` (stabilne, ale nie hardcodujemy — odporne na zmianę formatu kluczy CLI).

## What We're NOT Doing

- **Nie** uruchamiamy realnego vision/LLM w CI (koszt $; mock zostaje).
- **Nie** wpinamy E2E do istniejącego joba `verify` (osobny job — inny setup, nie blokuje feedbacku unit/lint).
- **Nie** zmieniamy speców ani `playwright.config.ts` (chyba że CI wykryje realny gap — wtedy adaptacja literalna).
- **Nie** ruszamy `deploy.yml` (E2E to gate jakości pre-merge, nie deploy).
- **Nie** instalujemy browserów lokalnie u usera (osobny, manualny `npx playwright install` poza zakresem).
- **Nie** dodajemy realnego `ANTHROPIC_API_KEY` do GitHub Secrets (dummy wystarcza).

## Implementation Approach

Jeden nowy job `e2e` w `ci.yml`, równoległy do `verify`, na tych samych triggerach. Sekwencja: checkout → setup Node → `npm ci` → `wrangler types` (dev server typecheck-cleanliness) → setup Supabase CLI → `supabase start` (migracje+seed) → wygeneruj `.dev.vars` z lokalnych kluczy → `playwright install --with-deps chromium` → `playwright test` → (always) upload report artifact. Weryfikacja końcowa = zielony job na PR tego brancha.

## Phase 1: Job `e2e` w CI

### Overview

Dodanie kompletnego, działającego joba E2E do `ci.yml`.

### Changes Required:

#### 1. Nowy job `e2e` w workflow CI

**File**: `.github/workflows/ci.yml`

**Intent**: Dodać drugi job `e2e` (obok `verify`) stawiający efemeryczną Supabose i uruchamiający Playwright. Job ma być samowystarczalny i zielony bez sekretów (poza wbudowanym `GITHUB_TOKEN`).

**Contract**: Job `e2e`, `runs-on: ubuntu-latest`, triggery dziedziczone z `on:` (PR→main, push→main). Kroki w kolejności:
1. `actions/checkout@v5`
2. `actions/setup-node@v5` (node `22.13.0`, `cache: npm`)
3. `npm ci`
4. `npx wrangler types` (regeneracja gitignored `worker-configuration.d.ts` — dev server boot/SSR typuje `cloudflare:workers`; ten sam powód co w `verify`)
5. `supabase/setup-cli@v1` (`version: latest`)
6. `supabase start` (stawia kontenery, aplikuje migracje + seed)
7. Wygenerowanie `.dev.vars` z lokalnych wartości — URL `http://127.0.0.1:54321`, `PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`, `ANTHROPIC_API_KEY=dummy-not-used-in-e2e`. (`-o env` daje stabilne nazwy `ANON_KEY`/`SERVICE_ROLE_KEY`/`API_URL` niezależnie od formatu kluczy.)
8. `npx playwright install --with-deps chromium`
9. `npx playwright test` (env `CI=true` ustawiane automatycznie przez GitHub Actions ⇒ `playwright.config.ts` włącza retries/workers/forbidOnly)
10. `actions/upload-artifact@v4` z `if: ${{ !cancelled() }}`, `path: playwright-report/`, `name: playwright-report`, `retention-days: 7`

**Uwaga (lifecycle)**: `webServer` w `playwright.config.ts` sam startuje `npm run dev` (czyta świeżo zapisany `.dev.vars`) i czeka na :4321 — krok 9 nie wymaga ręcznego startu serwera. `reuseExistingServer:false` w CI ⇒ czysty start.

### Success Criteria:

#### Automated Verification:

- Workflow YAML parsuje się (brak składniowych błędów) — `gh workflow view CI` po pushu lub lokalny lint YAML.
- Job `e2e` kończy się zielono na PR tego brancha — `gh run list --branch change/e2e-in-ci` / `gh run watch`.
- Job `verify` nadal zielony (brak regresji w istniejącym pipeline).
- W logu joba widać `supabase start` aplikujący migracje 0001–0011 bez błędu (potwierdzenie gate'u walidacji migracji).

#### Manual Verification:

- (Opcjonalnie, przy faili) Pobrany artefakt `playwright-report/` otwiera się i pokazuje trace/screenshot nieudanego speca.

**Implementation Note**: Phase 1 weryfikuje się wyłącznie realnym przebiegiem CI (push brancha → GitHub Actions). Po pushu obserwujemy `gh run watch`; iterujemy aż job zielony.

---

## Phase 2: Dokumentacja

### Overview

Odnotowanie, że E2E chodzi w CI — w README, AGENTS.md i health-check.

### Changes Required:

#### 1. README — sekcja CI / testy

**File**: `README.md`

**Intent**: Zaktualizować opis CI, by wymieniał krok E2E (Playwright) obok lint/typecheck/unit/build.

**Contract**: Wzmianka w sekcji o testach/CI, że `ci.yml` uruchamia pełny zestaw: lint + typecheck + vitest + **playwright (E2E na efemerycznej Supabase)** + build; deploy w `deploy.yml`.

#### 2. Health-check — domknięcie luki E2E-w-CI

**File**: `context/foundation/health-check.md`

**Intent**: Zaktualizować Test Suite / CI: E2E już chodzi w CI; zdjąć z „outstanding manual step" / Category-gap status „0 e2e tests odpalanych w CI".

**Contract**: Edycja sekcji Test Suite + CI table (wiersz E2E ✓) + Summary. Bez regeneracji całego raportu — punktowa korekta.

#### 3. (warunkowo) AGENTS.md / wzmianka o E2E-jako-gate

**File**: `AGENTS.md`

**Intent**: Jeśli AGENTS.md opisuje pętlę weryfikacji/CI — dopisać, że E2E jest teraz częścią CI. Jeśli nie dotyczy, pominąć (adaptacja literalna).

**Contract**: Co najwyżej jedna linijka w istniejącej sekcji o testach/CI.

### Success Criteria:

#### Automated Verification:

- `npm run lint` + `npm run typecheck` zielone (zmiany docs nie psują nic; markdown poza lintem TS).

#### Manual Verification:

- README/health-check czytają się spójnie z nowym stanem CI (user-only przegląd).

---

## Testing Strategy

### Unit Tests:

- Bez zmian — ten change nie dotyka kodu aplikacji.

### Integration / E2E Tests:

- Cały change JEST o uruchomieniu istniejącego E2E w CI. Walidacja = zielony job `e2e` na PR.

### Manual Testing Steps:

1. Push brancha → otwórz PR → obserwuj `gh run watch` aż `e2e` zielony.
2. (Przy faili) pobierz artefakt `playwright-report`, zdiagnozuj, iteruj.

## Migration Notes

- Brak migracji DB. `supabase start` w CI aplikuje istniejące migracje na efemerycznej bazie (niszczona z runnerem).

## References

- Change: `context/changes/e2e-in-ci/change.md`
- CI: `.github/workflows/ci.yml`
- Playwright: `playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/auth.teardown.ts`
- Env matrix: `CLAUDE.md` § Cloudflare adapter, `scripts/switch-env.mjs`
- Mock vision: `tests/e2e/shelf-photo-pipeline-ui.spec.ts:170-204`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Job e2e w CI

#### Automated

- [x] 1.1 Workflow YAML parsuje się (gh workflow view / yaml lint)
- [ ] 1.2 Job `e2e` zielony na PR change/e2e-in-ci (gh run watch)
- [ ] 1.3 Job `verify` nadal zielony (brak regresji)
- [ ] 1.4 `supabase start` aplikuje migracje 0001–0011 bez błędu (log)

#### Manual

- [ ] 1.5 (opcjonalnie) artefakt playwright-report otwiera się przy faili

### Phase 2: Dokumentacja

#### Automated

- [ ] 2.1 lint + typecheck zielone po edycjach docs

#### Manual

- [ ] 2.2 README/health-check spójne z nowym stanem CI (user-only)
