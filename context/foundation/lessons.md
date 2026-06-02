# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Load-bearing convention detail wymusza kod, nie prozę w CLAUDE.md

- **Context**: API endpoints w `src/pages/api/` — każdy nowy endpoint zwracający JSON (M1: auth flow / shelves CRUD; M2: matching / library API; każdy kolejny później). Szerzej: każda konwencja stylistyczna lub security-header-tier, której naruszenie nie powoduje hard-failu kompilacji / lint'u.
- **Problem**: Empiryczny test N=3 (2026-05-20) pokazał, że mimo wpisanej w `CLAUDE.md > Konwencje > API endpoints` reguły o stabilnym error shape `{ error: { code, message } }`, `code` w SCREAMING_SNAKE_CASE, `Cache-Control: private, no-store` dla per-user data, oraz 404 dla zniekształconego UUID (privacy guardrail FR-NFR z PRD), agenci zacisnęli tylko 1 z 5 dywergencji vs baseline N=3 bez reguły. Jeden agent eksplicytnie **odrzucił regułę 404-dla-bad-UUID** jako mniej REST-ortodoxową. Sama proza w pliku reguł jest niewystarczającym enforcement'em dla load-bearing convention detail (enum casing, security header'y, response envelope shape) — agent czyta CLAUDE.md skanowaniem, nie weryfikuje sekcji "API endpoints" przed każdym endpoint'em.
- **Rule**: Dla load-bearing convention detail buduj enforcement-by-code **zanim** wpiszesz prozę: typed union (`type ApiErrorCode = "UNAUTHORIZED" | ...`) + response-builder helper (`apiResponse({ data })` / `apiError({ code, status, message })`) z security header'ami w defaultach. Wadliwa odpowiedź powinna **nie skompilować się**, nie "powinna się nie skompilować bo w CLAUDE.md tak napisaliśmy". Proza w CLAUDE.md zostaje jako 4-eyes principle przy code review, nie jako primary enforcement. Konkretny plan dla BookShelf już w `docs/plan-implementacji.md` M1 DoD: `src/lib/http/response.ts`.
- **Applies to**: plan, implement, impl-review

## Generowane artefakty pod ścieżką lintowaną → eslint ignore od razu

- **Context**: `src/lib/db/database.types.ts` (output `supabase gen types`) i ogólnie pliki generowane (np. `worker-configuration.d.ts` z `wrangler types`) leżące pod ścieżkami objętymi `npm run lint` lub kryteriami lint w planach.
- **Problem**: Generowany plik trafia pod ścieżkę lintowaną (np. kryterium „lint zielony na `src/lib/db/**`"); reguły ESLint mogą go oblać, mimo że nikt go nie edytuje ręcznie. Kryterium lint pada na nieedytowalnym kodzie, a „naprawa" oznaczałaby ręczną edycję pliku nadpisywanego przy każdej regeneracji.
- **Rule**: Generowane artefakty (typy z `supabase gen types`, `wrangler types`, itp.) dodawaj do `ignores` w `eslint.config.mjs` od razu przy ich wprowadzeniu — tak jak już zrobiono dla `worker-configuration.d.ts`. Kryteria lint pokrywają kod pisany ręcznie, nie generowany.
- **Applies to**: plan, implement, impl-review

## Server-side error logging: nigdy raw err object, zawsze err.message

- **Context**: `src/lib/middleware/handler.ts:42` (oryginalnie); ogólnie wszystkie server-side handlers logujące błędy z external boundaries (Supabase calls, fetch, file I/O, parser libraries) gdzie `err` może zawierać sensitive data z stack/error message.
- **Problem**: `console.error('[middleware] auth.getUser failed', { path, err })` logował cały `err` object. Jeśli zewnętrzny SDK (np. przyszła wersja `@supabase/supabase-js`, fetch errors z Supabase) embeduje JWT fragmenty, cookie strings, request body lub inne sensitive context w error messages/stack, trafią one do Cloudflare Workers logów (operator widzi). Hipotetyczne ryzyko leak, ale realne dla long-living projektu z rotating deps.
- **Rule**: W server-side error logging ZAWSZE używaj `err instanceof Error ? err.message : String(err)` zamiast całego err object. Nigdy `console.error('...', { err })`. Jeśli potrzebujesz więcej kontekstu, explicit field extraction po whitelist (np. `err.code`, `err.status`, `err.name`).
- **Applies to**: implement, impl-review

## Cloudflare Workers env reading — server vs browser, runtime vs build-time

- **Context**: Każdy server-side helper czytający env w Astro + Cloudflare Workers projekcie (Supabase clients, vision LLM client w S-03+, dowolny przyszły external API client) plus każdy browser-side moduł czytający `PUBLIC_*`. Astro v6+ z `@astrojs/cloudflare` adapter + Workers deploy.
- **Problem**: `import.meta.env.PUBLIC_*` w Vite to **build-time inlining** — Vite zastępuje wartości statycznie na etapie buildu. W prod CF Workers `import.meta.env` to static object zainline'owany z env wartości obecnych w build env (lub `undefined` gdy build env był pusty). Lokalnie działa przez `@astrojs/cloudflare` dev adapter (parsuje `.dev.vars`). W prod fails — bug 2026-05-26: middleware rzucił `Error: Brak PUBLIC_SUPABASE_URL — uzupełnij .env.local`, każdy request do prod URL zwracał 500, mimo że user miał 4 sekrety jako Worker Dashboard Secrets. Root cause: `supabase.server.ts` czytał `import.meta.env.PUBLIC_*` ale GitHub Actions build step nie pasował env vars, więc Vite zainline'ował `undefined`. Sekrety user'a żyją tylko w runtime (Worker bindings), nie build-time. Plus: oryginalna intuicja "użyj `Astro.locals.runtime.env`" jest myląca — Astro v6 usunęło ten field (cytat z `@astrojs/cloudflare/dist/utils/handler.js:84`: *"Astro.locals.runtime.env has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead."*).
- **Rule**:
  - **Server-side** (Astro v6+): czytaj env z `import { env } from 'cloudflare:workers'` (canonical Astro v6+ pattern; module-level import, nie context-scoped); fallback do `import.meta.env.X` dla dev/test compat (Vitest mock + Astro dev). Konfiguracja prod: Cloudflare Worker Dashboard Secrets (per env, encrypted) — `wrangler secret put NAME` lub UI. W Vitest: virtual module wymaga stub'a — albo globalnego w `vitest.config.ts` (`resolveId` + `load` dla `'cloudflare:workers'`), albo per-test `vi.mock('cloudflare:workers', () => ({ env: {...} }))` przed `import` consumera.
  - **Browser-side**: czytaj env z `import.meta.env.PUBLIC_*` (Vite build-time inline; browser nie ma access do `cloudflare:workers` ani runtime bindings). Konfiguracja: GitHub Actions Repository Secrets + `env:` block w `deploy.yml` build step.
  - **Nigdy** nie inline'uj secrets non-`PUBLIC_*` (np. SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY) do browser bundle — server-only zostaje w Worker Secrets.
  - Typowanie: rozszerzaj `Cloudflare.Env` przez `declare namespace Cloudflare { interface Env { ... } }` w `src/env.d.ts` (wrangler typegen nie zna runtime secrets — manual extension). Single source of truth dla typów `env`.
- **Applies to**: plan, implement, impl-review

## Worker Dashboard Secrets muszą być aktywnie walidowane vs `.dev.vars` przed „deploy done"

- **Context**: Każdy slice używający server-side env z `cloudflare:workers` virtual module (S-01 Supabase anon key, S-03+ ANTHROPIC_API_KEY, dowolny przyszły external API client). Plus każda zmiana env-zależnego kodu w fix-* changes (np. fix-cloudflare-runtime-env). Sekrety server-side żyją w 3 miejscach: Worker Dashboard Secrets (prod runtime), `.dev.vars` (Astro dev lokalnie), GitHub Repository Secrets (browser build-time). Nominalnie te SAME wartości, w 3 niezależnych miejscach.
- **Problem**: 2026-05-26: prod signup zwracało 500 INTERNAL_ERROR. Root cause: Worker Dashboard Secret `PUBLIC_SUPABASE_ANON_KEY` był różny od `.dev.vars` — Supabase odrzucało z 401 „Invalid API key". 1.5h debugu (rich console.error w endpoint + Cloudflare Worker logs real-time stream w Dashboard browser → operator podmienił secret). Deployment workflow (GitHub Actions) skończył się sukcesem ✓; smoke test landing page zwracał 200 ✓ — ale to NIE wykrywało rozjazdu secret bo signup nie był w smoke pathie. Drift możliwy w przyszłości za każdym razem gdy Supabase rotuje klucze, gdy user wkleja z innego źródła, gdy zmienia się scope sekretu (np. publishable vs service_role).
- **Rule**: Po każdym deploy zawierającym zmiany w server-side env handling (lub po `wrangler secret put` / Worker Dashboard secret edit): wykonaj **production smoke test pokrywający WSZYSTKIE env-konsumujące ścieżki**, nie tylko landing page. Dla S-01: `curl POST /api/auth/signup` z fake email — oczekiwany 200 + session cookies (5 sekund testu). Dla S-03+ vision: `curl POST /api/photos/:id/process` (lub równoważna ścieżka) z minimal payload. **Nie traktuj „GitHub Actions Deploy success + landing 200" jako equivalent „prod działa"** gdy slice wprowadza nowy env-konsumer. Walidacja: deploy.yml MOŻE w przyszłości dorzucić automated smoke step (`curl --fail-with-body` po każdej deploy) dla kluczowych endpointów — odsunięte do osobnego slice'a (Stream E micro: „deploy smoke automation").
- **Applies to**: plan, implement, impl-review

## Branch per change workflow (od 2026-05-26) — całe cykle w `change/<change-id>`, PR do main

- **Context**: Każdy slice/foundation/fix w projekcie. Workflow zmieniony 2026-05-26 po doświadczeniach z S-01 + 5 debug deploys do prod pchanych bezpośrednio z main (Worker Secret debugging dla signup 500). Plus S-01 + Stream E przeprowadziły 25+ commitów na main bez PR review gate.
- **Problem**: Praca bezpośrednio na main = każdy push triggers deploy, łącznie z debug/WIP commitami → 5+ niepotrzebnych prod deployów dla pojedynczego debug session. Brak formalnego review gate przed mergem do trunku. Trudniej rollback'ować pojedynczy slice (`git revert` chain) niż usunąć branch. Slice'y muszą stać w kolejce bo każdy zmienia main HEAD → blokuje paralelne prace. Plus zmniejsza demo-quality discipline dla 10xDevs course (każda zmiana powinna być wizualnie identyfikowalna jako jednostka pracy w PR-ach).
- **Rule**: Każdy slice/foundation/fix wykonujemy w branchu `change/<change-id>` (np. `change/shelves-crud-and-purchased`). Cały cykl (plan → implement → impl-review → archive) ląduje w branchu — commit per faza, atomic. Po `/10x-archive` w branchu:
  1. `git push origin change/<change-id>`
  2. `gh pr create --title "<change-id>: <title>" --body "<plan-brief + impl-review summary>"`
  3. User mergeuje PR (z opcjonalnym review w PR comments / GitHub UI)
  4. GitHub Actions deploy.yml deployuje main → prod
  - **Migracje Supabase**: `supabase db push` ZAWSZE po merge do main (irreversible w prod DB; pchnięcie w branchu pozostawia zombi schema gdy PR zostanie odrzucony). Integration testy w branchu używają Vitest mocks (analog F-02 `astro:middleware` mock); real DB integration odroczone do post-merge lokalnie.
    - **Materializacja ryzyka (precedens S-08, PR #14, 2026-05-29)**: skoro DB jest mockowana, **SQL migracji nie jest wykonywany aż do `db push` na prod** — pierwszy kontakt z realnym Postgresem dopiero po merge. 0011 padła na prod (`SQLSTATE 42P17, generation expression is not immutable`): `GENERATED ALWAYS ... STORED` wymaga IMMUTABLE wyrażenia, a `array_to_string()` jest STABLE → odrzucone. Fix = owinąć w IMMUTABLE SQL helper (`books_search_text()`). **Mitygacja na przyszłość**: każdy `db push` po merge traktuj jak gate (atomowa transakcja = rollback bez partial state, więc bezpieczny do retry); migracje z generated columns / triggerami / funkcjami waliduj na lokalnym stacku (`supabase db reset`) zanim zaufasz zielonym unit-testom — Vitest tego nie złapie. Gdy lokalny stack niedostępny (AV-block), `db push` na prod jest jedynym realnym testem (atomowy → akceptowalny).
  - **Wyjątki**: planowanie/roadmapa edits (`/10x-plan`, `/10x-roadmap`) mogą lądować bezpośrednio na main jako standalone `docs(...)` commits, gdy nie są związane z aktywnym implementation cycle.
- **Applies to**: implement, impl-review, archive (skille pozostają bez zmian — commitują do current branch; różnica tylko w startowym `git checkout -b`)

## Adaptacje literalne wewnątrz fazy → accept + flag, nie wracaj do `/10x-plan`

- **Context**: Cykle `/10x-implement` w fazach gdzie literalny szczegół z planu (szkic kontraktu, sugerowana nazwa API biblioteki, defaultowa ścieżka pliku env, format komendy CLI) okazuje się niezgodny z realnym stanem repo lub bieżącą wersją zewnętrznego API.
- **Problem**: M2L2 mówi „jeśli faza odkryje fakt zmieniający kontrakt planu, zatrzymaj implementację i wróć do planu — nie 'naprawiaj' kodu promptami". Ale nie każdy odkryty fakt zmienia **kontrakt** — często to literalny szczegół, którego planista nie mógł znać bez czytania kodu. Trzy potwierdzone precedensy w samym F-01: (1) cookie-adapter — plan szkic `context.cookies.getAll()`, realność `parseCookieHeader(headers.get('Cookie'))` bo `AstroCookies` nie ma `getAll()`; (2) env source — plan `.env.local`, realność `.dev.vars` (Cloudflare convention) z fallbackiem do obu; (3) post-archive — Outcome F-01 w roadmapie mówił „server service-role" mimo że implementacja zaadaptowała się do RLS-respecting. Zatrzymanie i replan dla każdej takiej drobnostki = nieuzasadniony overhead; ślepe ignorowanie = drift między planem/roadmapą a kodem.
- **Rule**: Rozróżnij **adaptację literalną** od **zmiany kontraktu**:
  - **Literalna** (intent kontraktu zachowany, zmienia się szczegół implementacyjny): zaaplikuj inline; oflaguj w komentarzu kodu (`// adaptacja vs plan: <co> — <dlaczego>`) i w commit message ostatniej fazy lub osobnym `docs:` commitcie. Polish dokumentów (szkic w planie, Outcome w roadmapie po `/10x-archive`) zrób raz, krótkim `docs(<slice>): align ...` commitem; **nie wracaj do `/10x-plan`**.
  - **Kontraktowa** (shape API, zakres slice'a, DoD, success criteria, decyzja architektoniczna): **stop & replan** — wróć do `/10x-plan` zgodnie z M2L2.
- **Applies to**: implement, impl-review, archive

## Generated artifacts w CI: explicit Generate step PRZED konsumującym

- **Context**: CI pipelines (.github/workflows/ci.yml i analogiczne) z krokami typecheck/lint/test które konsumują generated files trzymane jako .gitignored artifacts (worker-configuration.d.ts z wrangler, src/lib/db/database.types.ts z 'supabase gen types', itp.).
- **Problem**: Fresh CI runner robi 'npm ci' + step który konsumuje generated file → SQLSTATE 2307 'Cannot find module'. Recurring w sesji 2026-05-26: 4 agenci Stream E + agent S-02 + CI fail PR #1 → wszyscy flagowali worker-configuration.d.ts missing. Deploy.yml działał przez side-effect 'npm run build' regenerującego plik; CI typecheck bez build → padał.
- **Rule**: Każdy generated artifact konsumowany przez typecheck/lint/test w CI musi mieć explicit Generate step PRZED krokiem konsumującym. Dla worker-configuration.d.ts: 'npx wrangler types'. Dla database.types.ts: 'npx supabase gen types typescript --linked --schema public > ...'. Nie polegaj na side-effect 'npm run build' — CI może wcale nie budować.
- **Applies to**: implement, impl-review

## Każda nowa user-facing strona → navigation entry point jako planowany follow-up micro-slice

- **Context**: Slice'y dostarczające nową user-facing stronę (login/signup w S-01, /shelves w S-02, przyszłe S-03 /upload, S-05 /library, S-06 /add-purchase). Slice'y mają scope discipline = CRUD + dedykowana page, ale bez navigation entry points (linki w header'ze, CTA z landing, breadcrumbs).
- **Problem**: Pattern powtórzony 2x w sesji 2026-05-26/27: (1) S-01 dostarczył /login + /signup ale brak CTA na / → S-09 musiało to naprawić; (2) S-02 dostarczył /shelves ale brak linka nigdzie → S-13 musiało to naprawić. User za każdym razem zauważał gap dopiero przy real UI smoke i wymagał follow-up slice'a. Late-discovery feedback loop — wartość out-of-scope discipline OK, ale gap pozostaje do user'a do zgłoszenia post-merge.
- **Rule**: Po /10x-plan slice'a dostarczającego nową user-facing page, rejestruj navigation entry point (link w header'ze, CTA na landing, breadcrumbs) jako planowany follow-up micro-slice w roadmapie (Stream E bucket, status proposed) JESZCZE przed /10x-implement slice'a głównego. Nie dorzucaj do scope slice'a głównego (scope discipline), ale rejestruj jako todo. Po nazbieraniu 3-4 micro-slice'ów → Stream E parallel experiment.
- **Applies to**: plan, plan-review

## JSX attribute z polish typographic quotes → curly-brace expression form

- **Context**: TSX components w polish-language projektach używające typograficznych quotes (`„` U+201E, `"` U+201D) w treści UI (placeholder'y, labels, message'y) wewnątrz JSX attribute string literals.
- **Problem**: JSX parser interpretuje typograficzne `"` (U+201D) jako closing delimiter attribute value. Wykryte w S-02 ShelfForm: `placeholder="Nazwa (np. „Belletrystyka")"` → 8 typecheck errors + 1 lint parsing error. Parser zinterpretował unicode quote jako koniec atrybutu i posypał się na reszcie tag'a.
- **Rule**: W JSX attribute zawierającym polish typographic quotes używaj curly-brace expression form: `placeholder={'tekst „X"'}` (string literal w JS expression), nie attribute literal `placeholder="tekst „X""`. Alternatywnie: HTML entities `&bdquo;` / `&rdquo;`. JSX attribute delimiter MUSI być standardowy `"` (U+0022); typograficzne quotes TYLKO w treści wewnątrz JS expression.
- **Applies to**: implement, impl-review

## RLS na join-tabeli: waliduj OBA FK, nie tylko jeden

- **Context**: Polityki RLS na tabelach łączących (`shelf_entries`: book_id + shelf_id; `book_candidates`: detection_id; przyszłe junction tables). `supabase/migrations/0002_rls_policies.sql`.
- **Problem**: `shelf_entries_insert_own` sprawdza tylko `exists(books where id=book_id and user_id=auth.uid())` — NIE waliduje `shelf_id`. User mógłby wstawić własną książkę na CUDZĄ półkę (shelf_id z innego usera). S-05 tego nie eksponuje, bo `confirm.ts`/`correct.ts`/`confirm-batch.ts` derywują `shelf_id` z `photo.shelf_id` (server-side, RLS-scoped, nigdy z request body). Ale luka jest latentna dla każdego przyszłego endpointu przyjmującego `shelf_id` z klienta (S-07 move-book „Przenieś na półkę X"). Wykryte w impl-review S-05 (F5).
- **Rule**: Polityka RLS INSERT/UPDATE na join-tabeli musi walidować ownership KAŻDEGO FK wskazującego na zasób per-user, nie tylko jednego. Dla `shelf_entries` dociśnij o `exists(shelves where id=shelf_id and user_id=auth.uid())` ZANIM zjawi się endpoint przyjmujący `shelf_id` z klienta. Reguła ogólna: gdy endpoint derywuje powiązany klucz server-side, RLS jednego FK wystarcza do czasu; gdy klient może podać drugi klucz, RLS musi go pokrywać — nie polegać na tym, że „endpoint i tak waliduje".
- **Applies to**: plan, plan-review, implement, impl-review

## Nowa funkcja/rpc Postgres nie przejdzie typecheck w branchu — typ `Database.Functions` nieregenerowalny bez DB

- **Context**: Slice planujący atomowość przez funkcję Postgres wołaną `supabase.rpc('nazwa', …)` (np. S-07 move-book chciał `move_book_to_shelf` dla atomowego INSERT+UPDATE historii). Ogólnie: każdy plan zakładający wywołanie nowej funkcji DB z kodu typowanym klientem `SupabaseClient<Database>`.
- **Problem**: `src/lib/db/database.types.ts` ma `Functions: { [_ in never]: never }` (puste — projekt nie ma jeszcze żadnych rpc). `supabase-js` ogranicza nazwę rpc do `keyof Database['public']['Functions']` = `never`, więc `supabase.rpc('move_book_to_shelf', …)` **nie kompiluje się** pod `astro/tsconfigs/strict` (no `any`). `database.types.ts` regeneruje się tylko z **żywej** DB (`supabase gen types --linked`), a w branch-per-change migracja idzie na prod dopiero **po merge** (lessons.md § Branch per change) i lokalny stack bywa AV-blocked (memory). Chicken-and-egg: typecheck musi być zielony w branchu/CI ZANIM funkcja istnieje w jakiejkolwiek DB. Wykryte w S-07 plan-review (F1) — wywróciło całe podejście rpc.
- **Rule**: Dla operacji wielokrokowej w slice domyślnie wybieraj **app-level dwa typowane zapisy** (`.insert()` + `.update()` przez istniejący typed client) zamiast funkcji/rpc — kolejność insert-first gwarantuje brak utraty danych, non-atomic jest już zaakceptowany w repo (`confirm.ts`). Funkcję/trigger DB wprowadzaj tylko gdy atomowość jest twardym wymogiem kontraktu I masz jak zregenerować `database.types.ts` (lokalny stack żywy) ALBO świadomie typujesz wywołanie rpc ręcznie i flagujesz to. Plan-review MUSI sprawdzić `database.types.ts` `Functions` zanim zatwierdzi plan opierający się na rpc.
- **Applies to**: plan, plan-review, implement

## Onboarding docs (CLAUDE.md + AGENTS.md) dryfują niezależnie → rule-review na OBA

- **Context**: Projekt utrzymuje dwa pliki onboardingowe dla agentów: `CLAUDE.md` (pełny rule set, czytany przez Claude Code) i root `AGENTS.md` (zwięzły cross-tool onboarding, czytany przez Cursor/Copilot/inne narzędzia). Oba opisują ten sam stan repo (stack, CI/CD, konwencje Supabase/API). Każda zmiana infrastruktury lub konwencji powinna trafić do OBU.
- **Problem**: 2026-05-27 audyt M1L4 puścił `/10x-rule-review` tylko na `CLAUDE.md` (item A1) — `AGENTS.md` nie był re-weryfikowany od wczesnego bootstrapu i zdryfował: (1) „`.github/workflows/` empty (M1L5 work)" gdy CI+Deploy były w pełni wired (+ post-deploy smoke); (2) „service role only in API routes" — **sprzeczne** z RLS-first z CLAUDE.md (service-role NIE jest domyślną ścieżką danych, server client jest RLS-respecting); (3) `wrangler-action@v3` gdy deploy.yml jest na `@v4`. Linia (2) jest **security-adjacent**: agent czytający AGENTS.md jako primary mógłby napisać dostęp do danych omijający RLS. Drift był niewidoczny, bo żaden krok nie weryfikuje AGENTS.md vs realny stan, a rule-review domyślnie celuje w CLAUDE.md.
- **Rule**: Traktuj `CLAUDE.md` i `AGENTS.md` jako parę dryfującą niezależnie. (1) `/10x-rule-review` puszczaj na OBA pliki, nie tylko root CLAUDE.md. (2) Każda zmiana stanu infrastruktury/konwencji (CI/CD wired, wersje GitHub Actions, deploy flow, domyślna ścieżka dostępu do danych) → aktualizuj OBA w tym samym commicie, albo świadomie ustal który jest source-of-truth a który thin-pointer. (3) Przy regen `health-check.md` „AGENTS.md present" to za mało — sprawdź też czy treść nie jest stale (status CI, wersje, konwencje security).
- **Applies to**: plan-review, impl-review (+ rule-review, health-check)

## Przed migracją sprawdź max numer na main

- **Context**: Każda faza/slice dodająca plik w `supabase/migrations/`
- **Problem**: Dwa branche wybierają ten sam numer (np. `0012_`); po merge obu `supabase start` pada z `23505` (duplicate key w `schema_migrations`) — CI łamie się na kroku E2E.
- **Rule**: Przed stworzeniem pliku migracji sprawdź najwyższy istniejący numer na `main` (`git ls-tree origin/main supabase/migrations/ | sort`), nie na branchu roboczym — dwa równoległe branche mogą niezależnie wybrać ten sam numer.
- **Applies to**: implement, impl-review, plan-review
