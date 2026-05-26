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

## Adaptacje literalne wewnątrz fazy → accept + flag, nie wracaj do `/10x-plan`

- **Context**: Cykle `/10x-implement` w fazach gdzie literalny szczegół z planu (szkic kontraktu, sugerowana nazwa API biblioteki, defaultowa ścieżka pliku env, format komendy CLI) okazuje się niezgodny z realnym stanem repo lub bieżącą wersją zewnętrznego API.
- **Problem**: M2L2 mówi „jeśli faza odkryje fakt zmieniający kontrakt planu, zatrzymaj implementację i wróć do planu — nie 'naprawiaj' kodu promptami". Ale nie każdy odkryty fakt zmienia **kontrakt** — często to literalny szczegół, którego planista nie mógł znać bez czytania kodu. Trzy potwierdzone precedensy w samym F-01: (1) cookie-adapter — plan szkic `context.cookies.getAll()`, realność `parseCookieHeader(headers.get('Cookie'))` bo `AstroCookies` nie ma `getAll()`; (2) env source — plan `.env.local`, realność `.dev.vars` (Cloudflare convention) z fallbackiem do obu; (3) post-archive — Outcome F-01 w roadmapie mówił „server service-role" mimo że implementacja zaadaptowała się do RLS-respecting. Zatrzymanie i replan dla każdej takiej drobnostki = nieuzasadniony overhead; ślepe ignorowanie = drift między planem/roadmapą a kodem.
- **Rule**: Rozróżnij **adaptację literalną** od **zmiany kontraktu**:
  - **Literalna** (intent kontraktu zachowany, zmienia się szczegół implementacyjny): zaaplikuj inline; oflaguj w komentarzu kodu (`// adaptacja vs plan: <co> — <dlaczego>`) i w commit message ostatniej fazy lub osobnym `docs:` commitcie. Polish dokumentów (szkic w planie, Outcome w roadmapie po `/10x-archive`) zrób raz, krótkim `docs(<slice>): align ...` commitem; **nie wracaj do `/10x-plan`**.
  - **Kontraktowa** (shape API, zakres slice'a, DoD, success criteria, decyzja architektoniczna): **stop & replan** — wróć do `/10x-plan` zgodnie z M2L2.
- **Applies to**: implement, impl-review, archive
