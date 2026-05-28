# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# BookShelf Catalog — kontekst dla agenta

Operacyjne reguły pracy z agentem AI dla tego repo. Szybki opis projektu, stack, komendy, architektura → [README.md](README.md). Ten plik koncentruje się na **regułach pracy** (workflow agenta, konwencje konsumpcji stacku, decyzje świadomie odsunięte).

> **Tryb pracy**: branch-per-change + PR → main; atomic commit per faza implementacji; manual verification zawsze user-only.

## Workflow agenta

Defaults zwijające powtarzalne decyzje w pętli M2L2/L3 (`/10x-plan` → `/10x-implement` → `/10x-impl-review` → `/10x-archive`). Skille czytają tę sekcję jako instructions — nie pytaj o te decyzje per slice.

- **Plan-review obligatoryjny**: po `/10x-plan` ZAWSZE `/10x-plan-review <change-id>` przed `/10x-implement` — gate wykrywający gaps (fazy nie-atomic, success criteria niesprawdzalne, open questions blokujące) które w `/10x-impl-review` byłyby dużo droższe. Triage findings jak w impl-review: observation+evident-fix → inline, Warning+ → menu, Critical → stop & replan. Reguła: `m1m2-lessons-audit-plan.md → B4` (zob. § Kontekst zewnętrzny).
- **Commit strategy**: atomic commit per faza implementacji (touched-set only); SHA write-back jako osobny follow-up commit; cleanup artefaktów sesyjnych spoza zakresu fazy w osobnych commitach. Wiadomości po polsku, prefix `feat(<change-id>):` dla kodu fazy, `chore(<change-id>):` dla SHA write-back / review fixes, `docs:` dla foundation/roadmap/lessons.
- **Triage findings (`/10x-impl-review`)**: observation-level z evident-and-obvious fix → auto-apply Recommended bez interactive menu, raport w summary commit message. Warning+ zawsze przez menu. Critical → stop.
- **Adaptacje literalne** (szczegół implementacyjny niezgodny z planem, ale intent kontraktu zachowany — przykłady: nazwa API biblioteki, ścieżka pliku env, format komendy CLI): zaaplikuj inline, oflaguj w komentarzu kodu + commit message, polish dokumentów raz przy `/10x-archive` lub osobnym `docs(<slice>): align ...` commitcie post-archive. **Nie** wracaj do `/10x-plan`. Reguła i precedensy: [lessons.md → „Adaptacje literalne wewnątrz fazy"](context/foundation/lessons.md). Stop & replan tylko dla zmian **kontraktu** (shape API, scope, DoD, decyzja architektoniczna).
- **Manual verification**: zawsze user-only — Supabase Studio, przeglądarka, oko ludzkie. Agent nie symuluje („I checked Studio" jest niedozwolone).
- **`.claude/` w repo**: skille kursowe i `.10x-cli-manifest.json` commitowane do repo jako część workflow (świadoma decyzja dla projektu zaliczeniowego 10xDevs — skille są load-bearing artefaktem, nie tylko tooling). Aktualizacje rzadko, traktować jak deps; osobny commit `chore: install/update 10x skill pack`.
- **Roadmap Outcome drift po archive**: `/10x-archive` kopiuje Outcome verbatim do `## Done`. Jeśli implementacja zaadaptowała literalny szczegół (np. service-role → RLS-respecting), Outcome może być nieaktualny. Korekta = 2-linijkowy commit `docs(roadmap): align <slice-id> Outcome with actual implementation`.
- **Branch per change** (od 2026-05-26): każdy slice/foundation/fix wykonujemy w branchu `change/<change-id>`, NIE bezpośrednio na main. Cały cykl (plan → implement → impl-review → archive) ląduje w branchu. Po `/10x-archive` w branchu: `git push origin change/<change-id>` + `gh pr create --title "<change-id>: <title>" --body "<auto-gen z plan-brief + impl-review summary>"`. User mergeuje PR (z opcjonalnym review w PR comments); GitHub Actions deploy.yml deployuje main → prod. **Migracje Supabase**: `supabase db push` ZAWSZE po merge do main (irreversible w prod DB; nie pchać w branchu — odrzucony PR zostawiłby zombi schema). Integration testy w branchu używają Vitest mocks; real DB integration odraczamy do po-merge. Wyjątki od reguły branch-only: planowanie/roadmapa edits (`/10x-plan`, `/10x-roadmap`) mogą lądować bezpośrednio na main jako standalone docs commits, gdy nie są związane z aktywnym implementation cycle. Reguła i precedens: [lessons.md → „Branch per change workflow"](context/foundation/lessons.md).
- **Model per faza** (cost/quality split, M2L2 „opusplan"): **Opus** do `/10x-plan` i `/10x-impl-review` (reasoning-dense, niski wolumen tokenów — decyzje kontraktowe + wykrycie driftu); **Sonnet** do `/10x-implement` (gros tokenów: kontekst + edycje + iteracje; Opus ≈5× droższy per token). Model jest **stanem sesji, nie atrybutem skilla** — agent NIE przełącza go sam (`/model` to user-action). Na granicy fazy, gdy aktywny model nie pasuje: agent **przypomina** userowi `/model opus` (przed plan/review) lub `/model sonnet` (przed implement) ZANIM ruszy, i czeka na przełączenie. Przełączać na **czystej granicy kontekstu** (nowy kontekst per faza — M2L5), bo zmiana modelu unieważnia prompt cache. Alternatywa `opusplan` automatyzuje plan→Opus / implement→Sonnet, ale `/10x-impl-review` w trybie normalnym poleci Sonnet — wtedy i tak ręczny `/model opus`. Pełna ekonomia tokenów: `m1m2-lessons-audit-plan.md → E2` (zob. § Kontekst zewnętrzny).

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

## Lokalna Supabase dev

Migracje testujemy zawsze na **lokalnym stacku** zanim trafią do PR. Reguła z § Workflow agenta („Migracje Supabase: `db push` po merge do main, nie pchać w branchu") zostaje — `db push` na remote prod wykonujemy tylko po merge. Lokalna baza to brakujący środek: dev cycle dla migracji bez ryzyka zombi schema w prodzie.

**Wymagania**: WSL2 (Ubuntu) + Docker engine zainstalowany **w WSL** (`apt install docker-ce`, user w grupie `docker`). Docker Desktop **nie jest używany**. Sprawdzenie: `wsl -e bash -lc "docker info"`.

**Networking**: Astro dev biegnie w Windows (workerd/Cloudflare runtime nie wspiera SQLite SHM na `/mnt/c` NTFS-9P mount, więc nie da się go uruchomić w WSL bez przeniesienia repo do natywnego WSL fs). WSL2 localhost-forwarding nie działa dla portów Dockera, więc Astro nie dosięga `127.0.0.1:54321`. Workaround: `npm run env:local` dynamicznie wykrywa **WSL IP** (`wsl hostname -I`) i podstawia w generowanym `.dev.vars` — Astro w Windows łączy się do Supabase przez `http://192.168.x.x:54321` przez WSL NAT. WSL IP zmienia się po `wsl --shutdown` → należy odpalić `env:local` ponownie po każdym restarcie WSL. Mirrored networking mode próbowane — koliduje z bind portów Dockera (`address already in use`), nie używamy. **`.dev.vars.local` zostaje wzorcem z `127.0.0.1`** — switch-env podmienia host przy aktywacji; nie commituj zmiany.

**Bootstrap (jednorazowo, ~10 min pull obrazów):**

```powershell
wsl -e bash -lc "cd /mnt/c/Projekty/10xDevs/bookshelf && npx supabase start"
```

Output podaje lokalny API URL (`http://127.0.0.1:54321`), Studio (`http://127.0.0.1:54323`), Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) i lokalne klucze (`sb_publishable_*` / `sb_secret_*`). Klucze są stabilne — nie zmieniają się między `start`/`stop`/`reset`.

**Cykl per zmiana DB:**

1. Utwórz `supabase/migrations/NNNN_<name>.sql`
2. `wsl -e bash -lc "cd /mnt/c/Projekty/10xDevs/bookshelf && npx supabase db reset"` — drop + replay wszystkich migracji + `seed.sql` (idempotentne, świeże dane testowe)
3. Manual test: Studio `:54323` + `npm run dev` (Astro czyta `.dev.vars.local` jeśli aktywne)
4. Commit migracji + kodu → PR → review → **merge do main**
5. **Dopiero po merge**: `npx supabase db push` na remote prod (sekrety remote w `.dev.vars`, nie pomyl z lokalnymi)

**Profile sekretów** — single source of truth dla Astro dev:
- `.dev.vars` (gitignored) — sekrety **remote** (prod Supabase, deploy/wrangler debug)
- `.dev.vars.local` (gitignored) — sekrety **lokalne** (output `supabase start`, ANTHROPIC_API_KEY skopiowane z `.dev.vars`)
- Przełączanie: ręczna zamiana (`Move-Item .dev.vars .dev.vars.remote.bak; Copy-Item .dev.vars.local .dev.vars`). Trzeci plik (`.dev.vars.remote.bak`) też pokryty wzorcem `.dev.vars*` w `.gitignore`. Astro czyta tylko `.dev.vars`.

**MCP supabase** (`mcp__supabase__*`) wskazuje na **remote prod** (`foqpoqdbicgsrbkcuckc.supabase.co`) — używaj świadomie. Do queries na lokalnej DB: `docker exec -i supabase_db_bookshelf psql -U postgres -d postgres < query.sql` (kontener z `npx supabase start`).

**Częste komendy:**

| Komenda | Co robi |
| --- | --- |
| `npx supabase start` | start kontenerów (idempotentne; po restarcie WSL trzeba znowu) |
| `npx supabase stop` | stop bez utraty danych |
| `npx supabase stop --no-backup` | stop + drop danych (świeży reset przy następnym `start`) |
| `npx supabase db reset` | drop schema + replay migracji + seed (dane testowe znikają) |
| `npx supabase migration up` | dograj brakujące migracje bez resetu (zachowuje dane) |
| `npx supabase status` | URLs + keys + stan kontenerów |
| `npx supabase db push` | **push do remote prod** — tylko po merge do main |

VS Code tasks (Ctrl+Shift+P → Tasks: Run Task) zawijają te komendy przez WSL automatycznie. `Dev: full local stack (env + supabase + astro)` to compound wykonujący `env:local` → `supabase start` → `astro dev` jednym uruchomieniem.

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
- Migracje wersjonowane w `supabase/migrations/`. Stan na 2026-05-27: `0001_initial_schema.sql` (8 tabel) + `0002_rls_policies.sql` (per-user policies) + `0003_handle_new_user.sql` (auto-bootstrap profile + półka „Zakupione" przy signup) + `0004_shelves_constraints.sql` (UNIQUE per-user + triggery „Zakupione" hard-lock).
- **DB triggery jako defense-in-depth** dla domain invariantów — pattern: zamiast polegać na walidacji wyłącznie w Zod/UI, dorzucamy `BEFORE INSERT/UPDATE/DELETE` trigger (SECURITY DEFINER + `SET search_path = public, pg_temp`) który rzuca `RAISE EXCEPTION ... USING errcode = 'P0001'` przy naruszeniu inwariantu. Precedensy: `handle_new_user` (S-01, bootstrap), `prevent_zakupione_delete/rename` (S-02, niesuwalna systemowa). Endpoint mapuje `P0001` → 400 `VALIDATION_ERROR` z `error.message` z trigger'a. Triple guard: Zod refuse + UI guard + DB trigger.

### API endpoints (`src/pages/api/`)

**Single source of truth**: `src/lib/http/response.ts` (typowany `ApiErrorCode` union: `UNAUTHENTICATED | NOT_FOUND | VALIDATION_ERROR | INTERNAL_ERROR | RATE_LIMITED` + helpery `apiResponse({ data })` / `apiError({ code, status, message, details? })` z `Cache-Control: private, no-store` w defaultach + `parseUuidParam` dla 404-privacy na bad UUID). Endpointy konsumują wyłącznie te helpery — nie konstruują `new Response()` ręcznie. Rozszerzanie unii per slice gdy realnie potrzebne (per-resource codes typu `SHELF_NOT_FOUND` świadomie odsunięte do momentu gdy klient potrzebuje dispatch'ować na konkretny resource).

Endpoint zwraca jeden ze stabilnych kształtów: sukces `{ data: ... }`, błąd `{ error: { code, message, details? } }`. `code` w `SCREAMING_SNAKE_CASE` (`UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `RATE_LIMITED`). Nigdy `{ error: string }`, nigdy raw `throw` propagujący do response.

**Status codes (privacy-first, FR-NFR z PRD — nigdy nie ujawniaj istnienia cudzych zasobów):**
- `404` zarówno dla "nie ma rekordu" jak i "rekord należy do innego usera" (RLS już to wymusza; nie kodować osobnej gałęzi 403). Także `404` dla zniekształconego UUID w parametrze ścieżki, żeby nie wyciekać kształtu ID nieuwierzytelnionym.
- `400` zarezerwowane wyłącznie dla walidacji **inputu od zalogowanego usera** (np. body Zod fail).
- `401` check **przed** resource fetch (niezalogowany nie może enumerować).

Header `Cache-Control: private, no-store` na każdej odpowiedzi z danymi per-user — Cloudflare edge cache nie może shared-cache'ować JWT-scoped contentu.

`export const prerender = false` na każdym dynamicznym endpoincie (wymóg `@astrojs/cloudflare` przy `output: 'server'`).

**CRUD pattern w endpointach** (od S-02): collection vs item → 2 pliki w `src/pages/api/<resource>/`: `index.ts` (`GET` list + `POST` create) i `[id].ts` (`PATCH` update + `DELETE`). Postgres SQLSTATE → F-02 envelope mapping (single source of truth dla CRUD endpointów konsumujących DB):
- `23505` (unique_violation) → 400 `VALIDATION_ERROR` z domain-specific message (np. „Półka o tej nazwie już istnieje")
- `23503` (foreign_key_violation) → 404 `NOT_FOUND` (parent rekord nie istnieje lub RLS scope)
- `P0001` (RAISE EXCEPTION z naszego DB trigger'a — zob. § Supabase „defense-in-depth") → 400 `VALIDATION_ERROR` z `error.message` z trigger'a verbatim
- `PGRST116` (Supabase REST: no rows z `.single()`) → 404 `NOT_FOUND`
- inne / nieoczekiwane → 500 `INTERNAL_ERROR` + `console.error` z rich payload (`name`, `code`, `status`, ew. `cause`)

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
- GitHub Actions: lint + typecheck + vitest + playwright + deploy CF Workers (`cloudflare/wrangler-action@v4`)
- Sekrety: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_API_TOKEN`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` w GitHub Secrets
- CI typecheck wymaga `npx wrangler types` step PRZED `astro check` (regeneruje gitignored `worker-configuration.d.ts`) — zob. lessons.md § „Generated artifacts w CI"

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
│   ├── lib/                # konwencja: src/lib/<domain>/ = Zod schema.ts + helpers
│   │   ├── auth/           # S-01: schema.ts (LoginSchema, SignupSchema)
│   │   ├── shelves/        # S-02: schema.ts (CreateShelfSchema, UpdateShelfSchema, ShelfDTO)
│   │   ├── http/           # F-02: response.ts (apiResponse/apiError/parseUuidParam)
│   │   ├── middleware/     # F-02: handler.ts (auth guard split z Astro thin wrapper)
│   │   ├── db/             # F-01: supabase.{server,browser}.ts + database.types.ts (generated)
│   │   ├── vision/         # S-03 (planowany): klient Anthropic + prompt + Zod schema
│   │   ├── books/          # S-04 (planowany): Google Books + OpenLibrary klienci + reconcile
│   │   └── matching/       # S-04 (planowany): score, dedupe, isbn
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
│   └── deploy.yml          # build + deploy CF Workers (cloudflare/wrangler-action@v4)
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

## Status i milestone

Aktualny, regenerowalny obraz stanu projektu (audit zależności + test runner + CI + braki configów): [@context/foundation/health-check.md](context/foundation/health-check.md). Regeneracja: `/10x-health-check`.

Aktualny milestone, pełny kalendarz milestonów, ryzyka i definition-of-done: [@docs/plan-implementacji.md](docs/plan-implementacji.md). Schemat danych do migracji: [@docs/prd.md#schemat-danych](docs/prd.md#schemat-danych).

> ⚠ **Firewall korporacyjny** (zob. memory): `github.com/releases` jest blokowany, więc instalacja Supabase CLI z binarki padnie na ETIMEDOUT. Używać tunelu / VPN albo wersji npm.

## Kontekst zewnętrzny

- Pełna analiza projektu (poza tym repo): `c:\Projekty\10xDevs\analiza-projektu-bookshelf.md`
- Wymogi certyfikacji 10xDevs 3.0: `c:\Projekty\10xDevs\analiza-projektu-kursowego.md` sekcja 1
- Prework: `c:\Projekty\10xDevs\prework\`
- Plan adopcji lekcji M1+M2: `c:\Projekty\10xDevs\analiza\m1m2-lessons-audit-plan.md`

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
