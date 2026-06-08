# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# BookShelf Catalog — kontekst dla agenta

Operacyjne reguły pracy z agentem AI dla tego repo. Szybki opis projektu, stack, komendy, architektura → [README.md](README.md). Ten plik koncentruje się na **regułach pracy** (workflow agenta, konwencje konsumpcji stacku, decyzje świadomie odsunięte).

> **Tryb pracy**: branch-per-change + PR → main; atomic commit per faza implementacji; manual verification zawsze user-only.

## Workflow agenta

Defaults zwijające powtarzalne decyzje w pętli M2L2/L3 (`/10x-plan` → `/10x-implement` → `/10x-impl-review` → `/10x-archive`). Skille czytają tę sekcję jako instructions — nie pytaj o te decyzje per slice.

- **Fast track — domyślny tryb autonomii** (od 2026-05-29, decyzja usera „95% mojej akcji to potwierdzanie defaultu"): agent realizuje cykl **samodzielnie, act-then-report zamiast ask-first**. Konkretnie:
  - **`/10x-plan`**: NIE zadawaj rundy 12 pytań projektowych. Podejmij wywołane decyzje (recommended call na każdym forku), zaprezentuj **zwięzłą tabelę „Decyzje — zawetuj wyjątki"** i kontynuuj do plan-review. Pytaj (AskUserQuestion) WYŁĄCZNIE o: prawdziwe forki bez jasnego zwycięzcy, zmiany kontraktu/scope/DoD, **nowe wymagania** zgłoszone przez usera. Complexity-assessment i phase-structure → ustal sam, podaj w tabeli.
  - **Plan-review + impl-review triage**: auto-apply każdego findingu z jasnym ⭐ Recommended o impactcie LOW/MEDIUM; raportuj zbiorczo co zaaplikowano. Interactive menu TYLKO dla HIGH-impact lub genialnych 2-option tradeoffów. Critical → stop & replan.
  - **Model**: `opusplan` (auto Opus→plan/review-reasoning, Sonnet→implement) zamiast ręcznego `/model`+`/clean` na granicach faz. Agent nie przełącza ręcznie, polega na opusplan; przypomina o `/model opusplan` raz na starcie sesji jeśli aktywny model inny.
  - **Implement**: bounded slice (jasny kontrakt, automated-only verification) → wolno użyć `/goal` na całą fazę/slice do zielonych automatów bez per-step potwierdzeń.
  - **Granica nienaruszalna**: manual verification user-only zostaje (Studio/przeglądarka/oko); finalny PR review zostaje u usera. Fast track przenosi ludzką uwagę z klikania defaultów na decyzje kontraktowe + finalny przegląd, NIE usuwa gatów jakości (analiza plan-review/impl-review zostaje pełna).
- **Plan-review obligatoryjny**: po `/10x-plan` ZAWSZE `/10x-plan-review <change-id>` przed `/10x-implement` — gate wykrywający gaps (fazy nie-atomic, success criteria niesprawdzalne, open questions blokujące) które w `/10x-impl-review` byłyby dużo droższe. Triage findings jak w impl-review: observation+evident-fix → inline, Warning+ → menu, Critical → stop & replan. Reguła: `m1m2-lessons-audit-plan.md → B4` (zob. § Kontekst zewnętrzny).
- **Commit strategy**: atomic commit per faza implementacji (touched-set only); SHA write-back jako osobny follow-up commit; cleanup artefaktów sesyjnych spoza zakresu fazy w osobnych commitach. Wiadomości po polsku, prefix `feat(<change-id>):` dla kodu fazy, `chore(<change-id>):` dla SHA write-back / review fixes, `docs:` dla foundation/roadmap/lessons.
- **Triage findings (`/10x-impl-review` + `/10x-plan-review`)**: pod Fast track (zob. wyżej) auto-apply każdego findingu z jasnym ⭐ Recommended o impactcie **LOW/MEDIUM** (nie tylko observation-level) bez interactive menu; raport zbiorczy w summary / commit message. Interactive menu tylko dla HIGH-impact lub 2-option tradeoffów bez jasnego zwycięzcy. Critical → stop & replan.
- **Adaptacje literalne** (szczegół implementacyjny niezgodny z planem, ale intent kontraktu zachowany — przykłady: nazwa API biblioteki, ścieżka pliku env, format komendy CLI): zaaplikuj inline, oflaguj w komentarzu kodu + commit message, polish dokumentów raz przy `/10x-archive` lub osobnym `docs(<slice>): align ...` commitcie post-archive. **Nie** wracaj do `/10x-plan`. Reguła i precedensy: [lessons.md → „Adaptacje literalne wewnątrz fazy"](context/foundation/lessons.md). Stop & replan tylko dla zmian **kontraktu** (shape API, scope, DoD, decyzja architektoniczna).
- **Manual verification**: zawsze user-only — Supabase Studio, przeglądarka, oko ludzkie. Agent nie symuluje („I checked Studio" jest niedozwolone).
- **`.claude/` w repo**: skille kursowe i `.10x-cli-manifest.json` commitowane do repo jako część workflow (świadoma decyzja dla projektu zaliczeniowego 10xDevs — skille są load-bearing artefaktem, nie tylko tooling). Aktualizacje rzadko, traktować jak deps; osobny commit `chore: install/update 10x skill pack`.
- **Roadmap Outcome drift po archive**: `/10x-archive` kopiuje Outcome verbatim do `## Done`. Jeśli implementacja zaadaptowała literalny szczegół (np. service-role → RLS-respecting), Outcome może być nieaktualny. Korekta = 2-linijkowy commit `docs(roadmap): align <slice-id> Outcome with actual implementation`.
- **Branch per change** (od 2026-05-26): każdy slice/foundation/fix wykonujemy w branchu `change/<change-id>`, NIE bezpośrednio na main. Cały cykl (plan → implement → impl-review → archive) ląduje w branchu. Po `/10x-archive` w branchu: `git push origin change/<change-id>` + `gh pr create --title "<change-id>: <title>" --body "<auto-gen z plan-brief + impl-review summary>"`. User mergeuje PR (z opcjonalnym review w PR comments); GitHub Actions deploy.yml deployuje main → prod. **Migracje Supabase**: `supabase db push` uruchamiany **automatycznie** przez `deploy.yml` po merge do main (krok migrate-first PRZED `wrangler deploy`; idempotentny — aplikuje tylko nowe migracje; walidowany pre-merge przez job `e2e` w `ci.yml` `supabase start`). Wymaga sekretów `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` (GitHub env `production`); bez nich krok pomija się z warningiem (miękki guard, nie psuje deployu). Nadal **nie pchać w branchu** ręcznie (odrzucony PR zostawiłby zombi schema); ręczny `npx supabase db push` tylko jako fallback/hotfix. Integration testy w branchu używają Vitest mocks; real DB integration odraczamy do po-merge. Wyjątki od reguły branch-only: planowanie/roadmapa edits (`/10x-plan`, `/10x-roadmap`) mogą lądować bezpośrednio na main jako standalone docs commits, gdy nie są związane z aktywnym implementation cycle. Reguła i precedens: [lessons.md → „Branch per change workflow"](context/foundation/lessons.md).
- **Model per faza** (cost/quality split, M2L2 „opusplan"): **Opus** do `/10x-plan` i `/10x-impl-review` (reasoning-dense, niski wolumen tokenów — decyzje kontraktowe + wykrycie driftu); **Sonnet** do `/10x-implement` (gros tokenów: kontekst + edycje + iteracje; Opus ≈5× droższy per token). Model jest **stanem sesji, nie atrybutem skilla** — agent NIE przełącza go sam (`/model` to user-action). Na granicy fazy, gdy aktywny model nie pasuje: agent **przypomina** userowi `/model opus` (przed plan/review) lub `/model sonnet` (przed implement) ZANIM ruszy, i czeka na przełączenie. Przełączać na **czystej granicy kontekstu** (nowy kontekst per faza — M2L5), bo zmiana modelu unieważnia prompt cache. Alternatywa `opusplan` automatyzuje plan→Opus / implement→Sonnet, ale `/10x-impl-review` w trybie normalnym poleci Sonnet — wtedy i tak ręczny `/model opus`. Pełna ekonomia tokenów: `m1m2-lessons-audit-plan.md → E2` (zob. § Kontekst zewnętrzny).

## Cloudflare adapter — specyfika

- Output `server` z `@astrojs/cloudflare` — endpointy w `src/pages/api/**.ts` działają jak Workers, nie Node. **Brak `process.env`** w runtime.
- **Env (reguła repo-wide)**: server-side czyta z `'cloudflare:workers'` (`import { env } from 'cloudflare:workers'`; `Astro.locals.runtime.env` usunięte w Astro v6), browser-side wyłącznie `import.meta.env.PUBLIC_*` (Vite inline build-time). Single source of truth: [src/lib/db/supabase.server.ts](src/lib/db/supabase.server.ts) (`env?.X ?? import.meta.env.X`). Nigdy nie miksuj kanałów.
- Pełny wiring sekretów (Worker / GitHub / `.dev.vars`), env-matrix per środowisko, typowanie `Cloudflare.Env` → **[src/lib/db/AGENTS.md](src/lib/db/AGENTS.md)**.

## Lokalna Supabase dev

Migracje testujemy na lokalnym stacku (WSL2 + Docker) zanim trafią do PR; `db push` na prod tylko po merge (automat w `deploy.yml`). Pełny runbook (bootstrap, networking WSL, cykl per migracja, profile `.dev.vars`, komendy) → **[supabase/AGENTS.md](supabase/AGENTS.md)**.

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
- Potwierdzenia/alerty w UI realizuj jako modal React (in-app dialog). Nie używaj natywnych okien przeglądarki (`window.confirm`, `window.alert`, `window.prompt`).

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
- **Playwright** dla E2E: golden paths w `tests/e2e/` (auth, shelves, upload-flow, shelf-photo-pipeline-ui, smoke) z **mock** vision/match/external przez `page.route`. Config: `playwright.config.ts` (chromium + projekty `setup`/`cleanup`; współdzielona sesja przez storageState = 1 signup/run; `webServer` startuje `npm run dev` na :4321).
- **E2E = pełnoprawna część pętli weryfikacji**: przy każdej realizacji/weryfikacji zmiany uruchamiaj Playwright na równi z `vitest`/`typecheck`/`lint` — NIE pomijaj. Wyjątek tylko gdy zmiana ewidentnie nie dotyka warstwy UI/flow (odnotuj to świadomie).
- **E2E przed każdym PR — twarda reguła** (od 2026-06-08, oszczędność minut Actions): job `e2e` w CI biega **WYŁĄCZNIE ręcznie** (`workflow_dispatch` — Actions → „Run workflow" lub `gh workflow run ci.yml --ref <branch>`), NIE na każdym PR. Dlatego **ZAWSZE odpalaj pełny E2E ZANIM wrzucisz zmianę do PR** — lokalnie (`npm run test:e2e`) i/lub ręcznym runem `e2e`. PR domyślnie przepuszcza tylko `verify` (lint/typecheck/unit/build); E2E + integracje RLS + bramka migracji żyją w manualnym jobie `e2e`. Przed oddaniem certyfikacyjnym odpal `e2e` ręcznie też na main.
- **Koszt = twardy guardrail**: NIGDY nie wywołuj realnego vision/LLM w automatach (Anthropic API = fizyczne pieniądze). E2E zawsze mockuje vision/match/external (`page.route`). Realny vision wyłącznie w **manualnym** smoke (user-only), nie w CI (flaky + drogi).
- Browser binaries Playwrighta **nie są** wciągane przez `npm install` — pierwszy `npm run test:e2e` na świeżej maszynie wymaga `npx playwright install --with-deps`.
- **Konwencje kodu E2E** (lokatory `getByRole`, izolacja, `storageState`, 5 antywzorców, granice real-vs-mock) → [tests/e2e/AGENTS.md](tests/e2e/AGENTS.md).

### Lint / format
- **ESLint** w flat config (`eslint.config.mjs`): `@eslint/js` + `typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-astro` + `eslint-config-prettier`.
- **ESLint pinowany na v9** — `eslint-plugin-react@7.x` deklaruje peer `eslint: <=^9`. Bump do v10 dopiero po release'ie `eslint-plugin-react@8` lub po migracji na `@eslint-react/eslint-plugin`. Nie odpalaj `npm i eslint@latest` bez planu zamiany pluginu.
- **Prettier** z `prettier-plugin-astro` + `prettier-plugin-tailwindcss`. Tailwind plugin sortuje klasy automatycznie — nie układaj ich ręcznie.
- `eslint-config-prettier` musi zostać ostatnim wpisem w `eslint.config.mjs` (wyłącza reguły kolidujące z formaterem).

### CI
- GitHub Actions (`ci.yml`): job `verify` (lint + typecheck + vitest + build) na PR (z `paths-ignore` docs/skille); job `e2e` (playwright + integracje RLS + migracje) **ręczny** `workflow_dispatch` — zob. § Testy „E2E przed każdym PR". Deploy CF Workers w `deploy.yml` (`cloudflare/wrangler-action@v4`) na push do main; trigger `push:[main]` w `ci.yml` usunięty (post-merge waliduje deploy.yml + smoke).
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

Konwencja: `src/lib/<domain>/` = Zod `schema.ts` + helpers; server pages w `.astro`, interactive w `.tsx` (islands); endpointy w `src/pages/api/<resource>/`. Pełna mapa katalogów → **[AGENTS.md](AGENTS.md)** (§ Project structure).

## Decyzje świadomie odsunięte (NIE w MVP)

Pełna lista (mobile/PWA/camera, batch upload, ISBN scanner, rekomendacje, dziennik czytania, eksport CSV/JSON, shared shelves, offline, image cropping) → **[docs/prd.md](docs/prd.md)** (§ 12).

## Status i milestone

Aktualny, regenerowalny obraz stanu projektu (audit zależności + test runner + CI + braki configów): [@context/foundation/health-check.md](context/foundation/health-check.md). Regeneracja: `/10x-health-check`.

Aktualny milestone, pełny kalendarz milestonów, ryzyka i definition-of-done: [@docs/plan-implementacji.md](docs/plan-implementacji.md). Schemat danych do migracji: [@docs/prd.md#schemat-danych](docs/prd.md#schemat-danych).

> ⚠ **Firewall korporacyjny** (zob. memory): `github.com/releases` jest blokowany, więc instalacja Supabase CLI z binarki padnie na ETIMEDOUT. Używać tunelu / VPN albo wersji npm.

## Kontekst zewnętrzny

Prywatny meta-kontekst decyzyjny (analiza projektu, wymogi certyfikacji, prework, plan adopcji lekcji) żyje **poza tym repo** — nie commitować go tutaj.
