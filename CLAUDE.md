# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# BookShelf Catalog — kontekst dla agenta

## Czym jest projekt

Aplikacja webowa do katalogowania książek na podstawie zdjęć półek. Użytkownik fotografuje półkę, system rozpoznaje tytuły przez vision-LLM, matchuje je z bazą zewnętrzną (Google Books / OpenLibrary), wykrywa duplikaty względem istniejącego katalogu i proponuje wpisy z lokalizacją (półka, pozycja); użytkownik akceptuje / odrzuca / koryguje, a system rejestruje korekty do telemetrii.

**Projekt zaliczeniowy 10xDevs 3.0** (start kursu 18.05.2026, 1. termin oddania 5.07.2026).

## Logika biznesowa w jednym zdaniu

Vision-detekcja → matching scoring → deduplikacja → ranking propozycji → potwierdzenie użytkownika → telemetria korekt.

Pięć decyzji domenowych: (1) detekcja z obrazu, (2) scoring matchu z bazą zewnętrzną, (3) deduplikacja vs istniejący katalog, (4) ranking propozycji, (5) telemetria akceptacji.

## Stack

| Warstwa | Wybór |
|---|---|
| Meta-framework | Astro 6 (SSR) |
| UI | React 19 (islands) |
| Typy | TypeScript strict |
| Style | Tailwind 4 |
| Backend | Astro endpoints (`src/pages/api/`) |
| Auth | Supabase Auth (email/password + opcjonalnie Google OAuth) |
| DB | Supabase Postgres + RLS |
| Storage | Supabase Storage (bucket `photos/`) |
| Vision LLM | Claude Sonnet 4.6 (multimodal) — bezpośrednio przez Anthropic API |
| Walidacja LLM I/O | Zod schemas |
| Book metadata | Google Books API (primary) + OpenLibrary (fallback) |
| Deployment | Cloudflare Workers (z Workers Assets — `@astrojs/cloudflare` v13 wycofał Pages) |
| Test framework | Vitest (unit) + Playwright (E2E) |
| CI | GitHub Actions |

## Komendy

Wymagania: **Node.js ≥ 22.13.0** (`engines.node` w `package.json`).

| Komenda | Co robi |
|---|---|
| `npm run dev` | Dev server na `http://localhost:4321/` z HMR |
| `npm run build` | Produkcyjny build (`dist/`) pod Cloudflare Workers |
| `npm run preview` | Preview produkcyjnego buildu lokalnie (wrangler) |
| `npm run typecheck` | `astro check` — typy w `.astro` + `.ts/.tsx` (substytut `tsc --noEmit`) |
| `npm run test` | Vitest run (jsdom, `tests/unit/**`) |
| `npm run test:watch` | Vitest w trybie watch |
| `npm run test:coverage` | Vitest run + raport pokrycia v8 (`coverage/`) |
| `npm run test:e2e` | Playwright run (`tests/e2e/**`); wymaga jednorazowego `npx playwright install --with-deps` |
| `npm run lint` | ESLint na całym repo (flat config, ESLint v9) |
| `npm run lint:fix` | ESLint z autofixem |
| `npm run format` | Prettier `--write .` (plugin Astro + Tailwind) |
| `npm run format:check` | Prettier `--check .` |
| `npm run astro -- add <integration>` | Dodanie integracji (np. `mdx`, `sitemap`) |
| `npm run generate-types` | Regeneracja `worker-configuration.d.ts` z bindings Cloudflare (po zmianie `wrangler.jsonc`) |

> **Pojedynczy test (Vitest):** `npx vitest run tests/unit/health.test.ts` (po ścieżce) lub `npx vitest -t "fragment nazwy"` (po nazwie).
> **Pojedynczy spec (Playwright):** `npx playwright test tests/e2e/smoke.spec.ts` lub `npx playwright test -g "fragment"`. Wymaga uprzedniego `npx playwright install --with-deps` (~600 MB binariów przeglądarki — **nie** wciągane przez zwykłe `npm install`).

## Cloudflare adapter — specyfika

- Output `server` z `@astrojs/cloudflare` — endpointy w `src/pages/api/**.ts` działają jak Workers, nie Node. **Brak `process.env`** w runtime.

### Env reading — server vs browser

Dwa różne kanały. Nigdy ich nie miksuj.

- **Server-side** (Astro SSR, middleware, endpointy `src/pages/api/`): czytaj env z `'cloudflare:workers'` virtual module — `import { env } from 'cloudflare:workers'`. Canonical Astro v6+ pattern; `Astro.locals.runtime.env` zostało **usunięte w Astro v6**. Single source of truth: [src/lib/db/supabase.server.ts](src/lib/db/supabase.server.ts) — `env?.X ?? import.meta.env.X` (runtime first, fallback do build-time dla Vitest / dev compat).
- **Browser-side** (React islands, `src/lib/db/supabase.browser.ts`): czytaj env wyłącznie przez `import.meta.env.PUBLIC_*` — Vite inline'uje wartości na build-time. Browser bundle nie ma access do `cloudflare:workers` (to server-only).

### Env wiring — gdzie ustawiać sekrety

| Kanał | Konfiguracja | Co tam idzie |
| --- | --- | --- |
| **Worker Dashboard Secrets** (runtime, server) | `wrangler secret put NAME` lub Cloudflare Dashboard → Worker → Settings → Variables and Secrets | Wszystkie 4 secrets: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` |
| **GitHub Repository Secrets** (build-time, dla browser bundle) | GitHub → Settings → Secrets and variables → Actions; konsumowane w `.github/workflows/deploy.yml` `env:` block w step Build | TYLKO `PUBLIC_*` (PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY). **Nigdy** `SERVICE_ROLE_KEY` ani `ANTHROPIC_API_KEY` — server-only, browser bundle ich nie dostaje |
| **`.dev.vars`** (Astro dev, lokalnie) | Plain `KEY=value` w `.dev.vars` (gitignored); parsowane przez `@astrojs/cloudflare` adapter | Wszystkie sekrety potrzebne lokalnie — automatycznie wstawiane do Vite `import.meta.env` + `cloudflare:workers` `env` |

### Env matrix — gdzie czego się czyta i jak to setup'ujesz

| Środowisko | Server: skąd `env` | Browser: skąd `import.meta.env.PUBLIC_*` | Setup |
| --- | --- | --- | --- |
| **Prod CF Workers** | `'cloudflare:workers'` virtual module (Worker Dashboard Secrets) | Inlined przez Vite z `env:` w `deploy.yml` (GitHub Repository Secrets) | Worker Secrets via `wrangler secret put` + GitHub Repo Secrets |
| **Astro dev (`npm run dev`)** | `'cloudflare:workers'` env (z `.dev.vars` via @cloudflare/vite-plugin) lub fallback `import.meta.env` (z `.dev.vars` via @astrojs/cloudflare adapter) | `import.meta.env` z `.dev.vars` | Tylko `.dev.vars` |
| **Vitest** | `'cloudflare:workers'` stub w `vitest.config.ts` (`env: {}`) → fallback `import.meta.env`; per-test `vi.mock('cloudflare:workers', () => ({ env: {...} }))` | `import.meta.env` z `.env*` / `vi.stubEnv` | Stub w `vitest.config.ts` plus per-test `vi.mock` / `vi.stubEnv` |

### Typowanie secrets

`Cloudflare.Env` augmentowane w [src/env.d.ts](src/env.d.ts) przez `declare namespace Cloudflare { interface Env { ... } }`. Wrangler typegen (`worker-configuration.d.ts`) NIE wie o runtime secrets — generuje tylko `ASSETS: Fetcher`. Nowe sekrety dorzucaj do tej extension (single source of truth dla typów `env` z `'cloudflare:workers'`).

### Inne

- `worker-configuration.d.ts` jest generowany (`npm run generate-types`) — nie edytuj ręcznie i nie commituj zmian wynikających z lokalnego dev runu, jeśli nie zmieniałeś `wrangler.jsonc`.
- Lokalny dev używa Vite (nie miniflare) — niektóre Workers-only API (np. `caches.default`) trzeba testować dopiero przez `npm run preview`.

## Architektura — schemat

```
Browser (React 19 islands) ─→ Astro SSR (Cloudflare Workers + Assets)
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Supabase Auth         Supabase Postgres      Supabase Storage
       (JWT + sesja)         (z RLS na user_id)     (zdjęcia półek)
                                   │
                                   ▼
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       Anthropic API          Google Books API        OpenLibrary API
       (Sonnet 4.6 vision)    (primary metadata)      (fallback)
```

## Model danych (Postgres)

8 tabel z RLS na `user_id = auth.uid()`:

- `profiles` (id FK auth.users, display_name)
- `shelves` (user_id, name, location, position_index)
- `photos` (user_id, shelf_id, storage_path, status, vision_cost_usd, vision_latency_ms)
- `detections` (photo_id, position_index, raw_title, raw_author, vision_confidence, status)
- `book_candidates` (detection_id, source, external_id, title, authors, isbn_*, match_score, rank)
- `books` (user_id, isbn_*, title, authors, source, source_external_id) — confirmed catalog
- `shelf_entries` (book_id, shelf_id, position_index, photo_id, detection_id, is_current)
- `corrections` (user_id, detection_id, original_raw_title, corrected_title, correction_type)

Pełny SQL: [docs/prd.md](docs/prd.md#schemat-danych).

## Struktura katalogów

```
bookshelf/
├── src/
│   ├── pages/              # Astro pages + /api/ endpoints
│   ├── components/         # React islands (PhotoUploader, DetectionReview, BookCard...)
│   ├── lib/
│   │   ├── vision/         # klient Anthropic + prompt + Zod schema
│   │   ├── books/          # Google Books + OpenLibrary klienci + reconcile
│   │   ├── matching/       # score, dedupe, isbn
│   │   ├── db/             # Supabase typed clients (server/browser)
│   │   └── auth/           # middleware guard
│   ├── middleware.ts
│   └── env.d.ts
├── supabase/
│   ├── migrations/         # SQL migrations
│   └── seed.sql
├── tests/
│   ├── unit/               # Vitest
│   ├── integration/
│   └── e2e/                # Playwright (z mock vision-response)
├── .github/workflows/
│   ├── ci.yml              # lint + typecheck + tests
│   └── deploy.yml          # build + deploy CF Workers (cloudflare/wrangler-action@v3)
├── docs/
│   ├── prd.md              # PRD modułu (artefakt M1)
│   └── plan-implementacji.md
├── context/
│   └── foundation/
│       ├── prd.md          # foundation PRD (hand-off /10x-prd → /10x-tech-stack-selector)
│       ├── tech-stack.md   # locked stack pick (hand-off → /10x-bootstrapper, /10x-infra-research)
│       └── health-check.md # raport stanu projektu (re-genowany /10x-health-check)
├── eslint.config.mjs       # ESLint v9 flat config
├── vitest.config.ts        # Vitest config (jsdom + setupFiles)
├── playwright.config.ts    # Playwright config (chromium + webServer)
├── .prettierrc.json
├── .prettierignore
├── .editorconfig
├── CLAUDE.md               # ten plik
└── README.md
```

## Konwencje

### TypeScript
- `strict: true` — nie obniżać
- Brak `any` — używaj `unknown` + narrowing
- Zod schemas dla każdego external I/O (LLM responses, API responses, form inputs)
- Inferowanie typów z Zod: `type Foo = z.infer<typeof FooSchema>`

### Astro / React
- **Server pages** w Astro (`.astro`) — SSR, auth guard, data fetch
- **Interactive views** w React (`.tsx`) — `client:load` / `client:visible` islands
- Granica jasna: jeśli komponent nie ma stanu interakcji, zostaje Astro

### Supabase
- **RLS od pierwszego dnia** — każda tabela ma policy `user_id = auth.uid()`
- Typed clienty (`SupabaseClient<Database>`): `supabase.server.ts` = **RLS-respecting** (`@supabase/ssr` `createServerClient`, anon key + JWT usera z cookies; request-scoped, nowy na każdy render) i `supabase.browser.ts` (anon key, `createBrowserClient`). Service-role **nie** w `src/lib/db/` — wyłącznie w wąskich, wydzielonych ścieżkach privileged, gdy realnie zajdą (nie w F-01); omija RLS, więc nie jest domyślną ścieżką dostępu do danych.
- Migracje wersjonowane w `supabase/migrations/`

### API endpoints (`src/pages/api/`)

**Single source of truth**: `src/lib/http/response.ts` (typowany `ApiErrorCode` union: `UNAUTHENTICATED | NOT_FOUND | VALIDATION_ERROR | INTERNAL_ERROR | RATE_LIMITED` + helpery `apiResponse({ data })` / `apiError({ code, status, message, details? })` z `Cache-Control: private, no-store` w defaultach + `parseUuidParam` dla 404-privacy na bad UUID). Endpointy konsumują wyłącznie te helpery — nie konstruują `new Response()` ręcznie. Rozszerzanie unii per slice gdy realnie potrzebne (per-resource codes typu `SHELF_NOT_FOUND` świadomie odsunięte do momentu gdy klient potrzebuje dispatch'ować na konkretny resource).

Endpoint zwraca jeden ze stabilnych kształtów: sukces `{ data: ... }`, błąd `{ error: { code, message, details? } }`. `code` w `SCREAMING_SNAKE_CASE` (`UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `RATE_LIMITED`). Nigdy `{ error: string }`, nigdy raw `throw` propagujący do response.

**Status codes (privacy-first, FR-NFR z PRD — nigdy nie ujawniaj istnienia cudzych zasobów):**
- `404` zarówno dla "nie ma rekordu" jak i "rekord należy do innego usera" (RLS już to wymusza; nie kodować osobnej gałęzi 403). Także `404` dla zniekształconego UUID w parametrze ścieżki, żeby nie wyciekać kształtu ID nieuwierzytelnionym.
- `400` zarezerwowane wyłącznie dla walidacji **inputu od zalogowanego usera** (np. body Zod fail).
- `401` check **przed** resource fetch (niezalogowany nie może enumerować).

Header `Cache-Control: private, no-store` na każdej odpowiedzi z danymi per-user — Cloudflare edge cache nie może shared-cache'ować JWT-scoped contentu.

`export const prerender = false` na każdym dynamicznym endpoincie (wymóg `@astrojs/cloudflare` przy `output: 'server'`).

### Vision LLM
- Single source of truth dla promptu: `src/lib/vision/prompt.ts`
- Output **zawsze** walidowany przez Zod (`DetectionSchema`)
- Jeśli output nie przechodzi `DetectionSchema.safeParse()` (`ZodError`) → retry **raz** z `thinking: { type: 'enabled', budget_tokens: ... }`; drugi `safeParse` fail → record w `corrections` z `correction_type: 'parse_failure'` i abort łańcucha dla tego zdjęcia. Eskalacja do Opus tylko w MVP+ (poza M1)
- Każda detekcja persistowana **przed** matchingiem (idempotencja przy retry)

### Matching
- Próg `match_score >= 0.75` = wysoka jakość, pre-zaznaczone w UI
- `0.55 - 0.75` = średnia, user musi potwierdzić
- `< 0.55` = brak matchu, użytkownik wpisuje ręcznie → record w `corrections`

### Testy
- **Vitest** dla unit: matching, dedupe, isbn validation, vision response parsing. Config: `vitest.config.ts` (jsdom env, setup w `tests/unit/setup.ts`, coverage v8).
- **Playwright** dla E2E: jeden golden path (`tests/e2e/upload-flow.spec.ts`) z **mock** vision-response. Config: `playwright.config.ts` (chromium project, `webServer` startuje `npm run dev` na :4321).
- Real vision tylko w manualnym smoke test (nie w CI — flaky + drogi).
- Browser binaries Playwrighta **nie są** wciągane przez `npm install` — pierwszy `npm run test:e2e` na świeżej maszynie wymaga `npx playwright install --with-deps`.

### Lint / format
- **ESLint** w flat config (`eslint.config.mjs`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-astro` + `eslint-config-prettier`.
- **ESLint pinowany na v9** — `eslint-plugin-react@7.x` deklaruje peer `eslint: <=^9`. Bump do v10 dopiero po release'ie `eslint-plugin-react@8` lub po migracji na `@eslint-react/eslint-plugin`. Nie odpalaj `npm i eslint@latest` bez planu zamiany pluginu.
- **Prettier** z `prettier-plugin-astro` + `prettier-plugin-tailwindcss`. Tailwind plugin sortuje klasy automatycznie — nie układaj ich ręcznie.
- `eslint-config-prettier` musi zostać ostatnim wpisem w `eslint.config.mjs` (wyłącza reguły kolidujące z formaterem).

### CI
- GitHub Actions: lint + typecheck + vitest + playwright + deploy CF Workers (`cloudflare/wrangler-action@v3`, **NIE** `cloudflare/pages-action`)
- Sekrety: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN` w GitHub Secrets

### Workflow agenta

Defaults zwijające powtarzalne decyzje w pętli M2L2/L3 (`/10x-plan` → `/10x-implement` → `/10x-impl-review` → `/10x-archive`). Skille czytają tę sekcję jako instructions — nie pytaj o te decyzje per slice.

- **Commit strategy**: atomic commit per faza implementacji (touched-set only); SHA write-back jako osobny follow-up commit; cleanup artefaktów sesyjnych spoza zakresu fazy w osobnych commitach. Wiadomości po polsku, prefix `feat(<change-id>):` dla kodu fazy, `chore(<change-id>):` dla SHA write-back / review fixes, `docs:` dla foundation/roadmap/lessons.
- **Triage findings (`/10x-impl-review`)**: observation-level z evident-and-obvious fix → auto-apply Recommended bez interactive menu, raport w summary commit message. Warning+ zawsze przez menu. Critical → stop.
- **Adaptacje literalne** (szczegół implementacyjny niezgodny z planem, ale intent kontraktu zachowany — przykłady: nazwa API biblioteki, ścieżka pliku env, format komendy CLI): zaaplikuj inline, oflaguj w komentarzu kodu + commit message, polish dokumentów raz przy `/10x-archive` lub osobnym `docs(<slice>): align ...` commitcie post-archive. **Nie** wracaj do `/10x-plan`. Reguła i precedensy: [lessons.md → „Adaptacje literalne wewnątrz fazy"](context/foundation/lessons.md). Stop & replan tylko dla zmian **kontraktu** (shape API, scope, DoD, decyzja architektoniczna).
- **Manual verification**: zawsze user-only — Supabase Studio, przeglądarka, oko ludzkie. Agent nie symuluje („I checked Studio" jest niedozwolone).
- **`.claude/` w repo**: skille kursowe i `.10x-cli-manifest.json` commitowane do repo jako część workflow (świadoma decyzja dla projektu zaliczeniowego 10xDevs — skille są load-bearing artefaktem, nie tylko tooling). Aktualizacje rzadko, traktować jak deps; osobny commit `chore: install/update 10x skill pack`.
- **Roadmap Outcome drift po archive**: `/10x-archive` kopiuje Outcome verbatim do `## Done`. Jeśli implementacja zaadaptowała literalny szczegół (np. service-role → RLS-respecting), Outcome może być nieaktualny. Korekta = 2-linijkowy commit `docs(roadmap): align <slice-id> Outcome with actual implementation`.

## Decyzje świadomie odsunięte (NIE w MVP)

- Mobile app / PWA / camera capture w przeglądarce — desktop upload wystarczy
- Batch upload wielu zdjęć — pętla pojedyncza w MVP
- Skanowanie ISBN czytnikiem kodów kreskowych
- Rekomendacja co przeczytać / podobne książki
- Wypożyczanie / dziennik czytania / oceny
- Eksport CSV/JSON
- Shared shelves między userami
- Integracja z lubimyczytac jako źródło danych (tylko deep-link do strony książki)
- Offline mode / PWA cache
- Image cropping w UI

## Status

Aktualny, regenerowalny obraz stanu projektu (audit zależności + test runner + CI + braki configów): [@context/foundation/health-check.md](context/foundation/health-check.md). Regeneracja: `/10x-health-check`. Sekcja "Struktura katalogów" wyżej opisuje cel, nie obecny stan — wiele podkatalogów `src/lib/`, `supabase/migrations/`, `.github/workflows/` to jeszcze puste foldery.

## Najbliższe kroki

Aktualny milestone: **M1 — schema + upload + vision (deadline 31.05.2026)**. Pełny kalendarz milestonów, ryzyka i definition-of-done: [@docs/plan-implementacji.md](docs/plan-implementacji.md). Schemat danych do migracji: [@docs/prd.md#schemat-danych](docs/prd.md#schemat-danych).

> ⚠ **Firewall korporacyjny** (zob. memory): `github.com/releases` jest blokowany, więc instalacja Supabase CLI z binarki padnie na ETIMEDOUT. Używać tunelu / VPN albo wersji npm.

## Kontekst zewnętrzny

- Pełna analiza projektu (poza tym repo): `c:\Projekty\10xDevs\analiza-projektu-bookshelf.md`
- Wymogi certyfikacji 10xDevs 3.0: `c:\Projekty\10xDevs\analiza-projektu-kursowego.md` sekcja 1
- Prework: `c:\Projekty\10xDevs\prework\`

Te pliki **nie są** częścią projektu kursowego (nie commituj ich tu) — to prywatny meta-kontekst decyzyjny.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 5

Scale the single-change cycle into parallel work with **worktrees, goal-directed delegation, and multi-session orchestration**:

```
worktree per change -> /goal or claude -p -> PR -> review -> merge
```

The lesson focus is safe throughput: isolated contexts, choosing the right execution mode, and capping parallelism at review capacity.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code isolation** | |
| `git worktree add` | You need a separate working directory for a parallel change. One change per worktree, one fresh agent context per worktree. |
| **Complex changes** | |
| `/10x-implement <change-id> phase <n>` | The change has multiple phases, needs manual gates, or benefits from interactive decision-making during execution. |
| **Simple changes** | |
| `/goal` | You have a clear, bounded task and want goal-directed delegation. The agent works autonomously toward the stated goal with a stop condition. |
| `claude -p` | You want headless execution for a well-defined task. The Ralph Wiggum loop (run, check, retry) is the universal autonomous pattern. |
| **Multi-session orchestration** | |
| Superset / Conductor / Antigravity / VS Code Agent View | You are running multiple agent sessions in parallel and need visibility, coordination, or session management across them. |

### Parallel work rules

- One change per worktree or isolated workspace. One fresh agent context per change.
- Choose interactive `/10x-implement` for complex changes, `/goal` or `claude -p` for simple ones.
- Parallelism is capped by review capacity. More agents without review means more unreviewed code, not higher throughput.
- The quality pain from faster shipping is intentional — it bridges into Module 3 testing gates.

### Lesson boundaries

- Do not reteach interactive `/10x-implement` or `/10x-impl-review`; those are Lessons 2 and 3.
- Do not introduce testing strategy here. The quality pain is the motivation for Module 3.
- Worktrees are a mechanism for isolation, not the topic of a full git tutorial.

### Paths used by this lesson

- `context/changes/<change-id>/` - active change folder
- `context/changes/<change-id>/plan.md` - implementation input for any execution mode

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
