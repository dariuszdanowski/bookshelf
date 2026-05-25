# F-02: Kontrakt odpowiedzi API + middleware auth-guard — Plan Brief

> Full plan: `context/changes/api-response-contract/plan.md`

## What & Why

Drugie foundation F-02: typowany response envelope + helpery (`src/lib/http/response.ts`) i middleware auth-guard (`src/middleware.ts` + `src/env.d.ts`). Po co: enforcement-by-code dla konwencji z CLAUDE.md § API endpoints — lesson 2026-05-20 udowodnił (test N=3), że sama proza zaciska 1 z 5 dywergencji. Wymuszenie kodem raz, na starcie, jest tańsze niż proza przy każdym z 8 kolejnych slice'ów. Drugie load-bearing: middleware redirectuje niezalogowanych z chronionych ścieżek (FR-004) i wpisuje `user` + `supabase` do `Astro.locals` — fundament guardrail prywatności PRD (NFR: 404-jednoznaczny brak dla cudzego zasobu).

## Starting Point

`src/pages/api/` jest pusty (clean slate — zero endpointów do migracji). `src/lib/http/`, `src/middleware.ts`, `src/env.d.ts` — wszystkie absent. F-01 substrate gotowy: `createServerSupabaseClient(context)` z anon key + cookie-bound JWT czeka na pierwszego konsumenta (= middleware F-02). Konwencje response shape, status codes i headers już sformułowane prozą w CLAUDE.md, ale bez enforcement.

## Desired End State

Każdy przyszły endpoint `/api/*` konsumuje `apiResponse({ data })` / `apiError({ code, status, message })` z helpera — z security headers (`Cache-Control: private, no-store`) i typowanym `ApiErrorCode` union w defaultach. Niezalogowany user na chronionej stronie dostaje 302 do `/login`; niezalogowany na chronionym API dostaje 401 envelope. Endpointy mają gotowy `Astro.locals.user` + `Astro.locals.supabase` per request (jeden createClient na request). Zniekształcony UUID w param ścieżki rozwiązuje się przez `parseUuidParam` → 404 envelope bez wycieku kształtu ID.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zakres `ApiErrorCode` na MVP | Minimal 5 codes (`UNAUTHENTICATED \| NOT_FOUND \| VALIDATION_ERROR \| INTERNAL_ERROR \| RATE_LIMITED`) | YAGNI: rozszerzanie unii per slice gdy realnie potrzebne; `details` nośnik kontekstu | Plan |
| Identyfikacja publicznych ścieżek w middleware | Whitelist explicit (`/`, `/login`, `/signup`, `/api/auth/*`) | Default secure zgodnie z PRD § Access Control — nowa ścieżka domyślnie chroniona | Plan |
| Shape `Astro.locals` | `user: AuthUser \| null` + `supabase: SupabaseClient<Database>` (typ `AuthUser` z `@supabase/supabase-js` — renamed re-export `User` z `@supabase/auth-js`) | Jeden createClient per request (canonical @supabase/ssr pattern); endpointy mają gotowe oba | Plan |
| Strategia testowa middleware (bez `/login`) | Unit test mocked session + scenario coverage | Deterministyczne, offline, szybkie; integracja z realnym Supabase Auth przychodzi w S-01 E2E | Plan |
| Auth error handling (`getUser()` rzuca) | Treat-as-anon + log | PRD guardrail "brak utraty danych po awarii"; network blip nie blokuje całej appki; refresh naprawia | Plan |
| Bad UUID enforcement | Helper `parseUuidParam` w F-02 substrate | Enforcement-by-code (lesson 2026-05-20); jeden punkt prawdy regex; konsument za 1 slice (S-02) | Plan |
| `getUser()` vs `getSession()` | `getUser()` | Weryfikuje JWT przez Supabase Auth — source of truth; `getSession()` czyta cookies bez weryfikacji (security risk dla auth-guard) | Plan |

## Scope

**In scope:** `src/lib/http/response.ts` (typowany `ApiErrorCode`, `apiResponse`, `apiError`, `parseUuidParam`, security headers w defaultach); `src/env.d.ts` (typowanie `App.Locals`); `src/middleware.ts` (whitelist public paths, createServerSupabaseClient, `getUser()` z treat-as-anon error handling, redirect/401 dla protected); unit testy obu plików (Vitest, offline); aktualizacja [CLAUDE.md § API endpoints](../../../CLAUDE.md) — pointer do helpera jako single source of truth.

**Out of scope:** konkretne endpointy (`/api/auth/*` → S-01); strony `/login`, `/signup` (S-01); rate limiting (enforcement w S-03 lub później); per-resource error codes (`SHELF_NOT_FOUND`, etc. → per slice gdy potrzeba); trigger `handle_new_user()` (S-01/S-02); integration test middleware z realnym Supabase (S-01 E2E); OAuth callback (FR-002 deferred post-MVP).

## Architecture / Approach

Trzy fazy w kolejności zależności: (1) helpery (czysty TS, deterministyczne, izolowane od request lifecycle); (2) middleware konsumujący helpery + F-01 substrate (integracja z Astro request lifecycle, pierwsze realne użycie `createServerSupabaseClient`); (3) CLAUDE.md sync (proza wskazuje na kod jako single source of truth). Każda faza ma własną bramkę automatyczną (typecheck/lint/test), zanim wchodzi następna.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Response envelope + helpery | `src/lib/http/response.ts` + unit testy (8+ scenariuszy) | Nieoczywiste edge cases UUID regex (jak case-sensitivity, dashy) |
| 2. Middleware + locals typing | `src/middleware.ts` + `src/env.d.ts` + unit testy (7+ scenariuszy) | Mocking `createServerSupabaseClient` w teście może być finicky (Vitest module mock) |
| 3. CLAUDE.md sync | Pointer w § API endpoints | Brak — pure docs |

**Prerequisites:** F-01 zarchiwizowane (gotowe — commit `0e28cc9`); deps obecne (`@supabase/ssr`, `@supabase/supabase-js`, `astro`); `vitest` skonfigurowany.
**Estimated effort:** ~1 sesja, 3 fazy.

## Open Risks & Assumptions

- Zakładamy że Astro middleware `onRequest` z `defineMiddleware` rzeczywiście uruchamia się przed każdym SSR request handlerem (Astro 6 native behavior; potwierdzone przez docs).
- Static assets (`_astro/*`, `/favicon.ico`) NIE przechodzą przez middleware (obsługa Cloudflare Workers Assets) — whitelist pokrywa tylko SSR paths.
- Mocking `createServerSupabaseClient` w unit teście middleware może wymagać `vi.mock` na poziomie modułu z fabryką zwracającą mocked client — standardowy pattern Vitest, ale wart uwagi przy implementacji.

## Success Criteria (Summary)

- `npm run typecheck` + `npm run lint` + `npm run test` zielone po każdej fazie automatic.
- Code review potwierdza: `getUser()` (nie `getSession()`); brak ręcznego `new Response()` w `src/middleware.ts`; `App.Locals.supabase` deklarowane jako required.
- CLAUDE.md § API endpoints po Phase 3 ma pointer do `src/lib/http/response.ts` jako autorytatywną definicję kontraktu (proza zachowana jako quick-reference).
