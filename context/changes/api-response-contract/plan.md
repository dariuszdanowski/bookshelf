# F-02: Kontrakt odpowiedzi API + middleware auth-guard (api-response-contract) — Implementation Plan

## Overview

Drugie foundation z roadmapy (F-02). Dostarcza dwa load-bearing prerekwizyty dla wszystkich slice'ów `/api/*` (S-01–S-08): (1) typowany response envelope + helpery z security headers w defaultach (`src/lib/http/response.ts`), (2) middleware auth-guard wpisujący sesję usera + Supabase client do `Astro.locals` (`src/middleware.ts` + `src/env.d.ts`). To pierwsze realne wykorzystanie F-01 substrate (`createServerSupabaseClient`) i enforcement-by-code dla konwencji z [CLAUDE.md § API endpoints](../../../CLAUDE.md) (lesson 2026-05-20 udowodnił że proza zaciska 1/5 dywergencji).

## Current State Analysis

- **API jest clean slate**: `src/pages/api/` pusty — żadnych endpointów do migracji, kontrakt ustanawiamy od zera.
- **Substrate F-02 absent**: `src/lib/http/` brak, `src/middleware.ts` brak, `src/env.d.ts` brak.
- **F-01 substrate gotowy**: `createServerSupabaseClient(context)` z [src/lib/db/supabase.server.ts](../../../src/lib/db/supabase.server.ts) — kontrakt `SupabaseServerContext = { request: Request; cookies: APIContext['cookies'] }`, zwraca `SupabaseClient<Database>` z anon key + cookie-bound JWT.
- **Konwencje wyspecyfikowane prozą** w [CLAUDE.md § API endpoints](../../../CLAUDE.md): response shape `{ data }` / `{ error: { code, message, details? } }`, `code` w SCREAMING_SNAKE_CASE, 404-privacy dla cudzych zasobów + zniekształconego UUID, 401 przed resource fetch, `Cache-Control: private, no-store`, `export const prerender = false`.
- **Lesson „load-bearing convention detail"** ([lessons.md:5](../../foundation/lessons.md)): test N=3 z 2026-05-20 pokazał konwergencję 1/5 dywergencji vs baseline — sama proza nie wystarcza, helper + typed union potrzebne ZANIM wpisujemy regułę.
- **PRD § Guardrails**: prywatność (404-jednoznaczny brak dla cudzego zasobu) + privacy-first caching (no shared edge cache dla JWT-scoped content).
- **Brak istniejących endpointów konsumujących helper** w F-02 — pierwszy konsument przyjdzie w S-01 (`/api/auth/login`, `/api/auth/signup`, `/api/auth/logout`). `parseUuidParam` pierwszy konsument w S-02 (`/api/shelves/:id`).

## Desired End State

Po wykonaniu planu:
- `src/lib/http/response.ts` eksportuje typowany `ApiErrorCode` union + `apiResponse`, `apiError`, `parseUuidParam` z security headers w defaultach. Brak `any`.
- `src/env.d.ts` deklaruje `App.Locals { supabase: SupabaseClient<Database>; user: AuthUser | null }` (`AuthUser` z `@supabase/supabase-js`).
- `src/middleware.ts` (Astro middleware) tworzy `createServerSupabaseClient` per request, wpisuje user + supabase do `locals`, redirectuje niezalogowanych z chronionych stron do `/login` (302), zwraca 401 envelope dla chronionych `/api/*`, przepuszcza whitelisted public paths.
- Unit testy (Vitest, default offline run): pokrycie envelope shape + headers, `parseUuidParam` edge cases, middleware decision tree (public/protected × authenticated/anon × auth error).
- [CLAUDE.md § API endpoints](../../../CLAUDE.md) wskazuje `src/lib/http/response.ts` jako single source of truth (proza jako quick-reference, helper jako autorytatywna definicja).

**Weryfikacja**: `npm run typecheck` + `npm run lint` + `npm run test` zielone; code review potwierdza brak `new Response()` ręcznie konstruowanego w `src/middleware.ts`; CLAUDE.md ma pointer do helpera.

### Key Discoveries:

- F-01 cookie-adapter to canonical `parseCookieHeader(request.headers.get('Cookie'))` (zob. [supabase.server.ts:39-46](../../../src/lib/db/supabase.server.ts)), nie `context.cookies.getAll()` — konsument F-02 (middleware) musi dostarczyć `request` + `cookies` zgodnie z typem `SupabaseServerContext`.
- Astro middleware uruchamia się **przed** każdym request handlerem, więc `App.Locals.supabase` można typować jako required (nie optional) — assignment w middleware spełnia kontrakt zanim handler go odczyta.
- `getUser()` weryfikuje JWT przez Supabase Auth (network call, nie tylko decode cookies) — jest source of truth dla "czy user zalogowany". `getSession()` byłby tańszy ale czyta tylko cookies bez weryfikacji — security risk.
- Static assets (`_astro/*`, `/favicon.ico`, `/robots.txt`) NIE przechodzą przez Astro middleware dla SSR routes — obsługa przez Cloudflare Workers Assets handler. Whitelist w middleware pokrywa tylko SSR paths.

## What We're NOT Doing

- **Konkretne endpointy** `/api/auth/login`, `/api/auth/signup`, `/api/auth/logout` — S-01 (`email-password-auth`).
- **Strony `/login`, `/signup`** — S-01 (middleware redirectuje na `/login` zanim ta strona istnieje; middleware test pokrywa redirect URL, integracja E2E w S-01).
- **Rate limiting middleware** — `RATE_LIMITED` code istnieje w union, ale enforcement gdy realnie zajdzie (najwcześniej S-03 vision pipeline).
- **Per-resource error codes** (`SHELF_NOT_FOUND`, `BOOK_NOT_FOUND`) — startujemy z minimal 5 codes; rozszerzanie unii per slice gdy klient potrzebuje dispatch'ować na konkretny resource.
- **Trigger `handle_new_user()`** — S-01/S-02 (FR-008).
- **Integration test middleware z realnym Supabase** — pokryty unit testem mock'owanym + E2E dopiero w S-01 (z prawdziwym login flow). Nie dorabiamy smoke endpointu w scope F-02.
- **OAuth callback (`/api/auth/callback`)** — FR-002 świadomie deferred do post-MVP (zob. [prd.md FR-002](../../foundation/prd.md)).

## Implementation Approach

Trzy fazy w kolejności zależności: (1) helpery (czysty TS, deterministyczne, izolowane od request lifecycle), (2) middleware + locals typing (konsumuje helpery + F-01 substrate, integracja z Astro request lifecycle), (3) CLAUDE.md sync (proza wskazuje na kod jako single source of truth). Każda faza ma automatyczną bramkę (typecheck + lint + unit test), więc regresja łapana przed kolejną fazą.

## Critical Implementation Details

- **Cookie kontrakt F-01 → middleware**: `createServerSupabaseClient(context)` z F-01 oczekuje `{ request: Request; cookies: APIContext['cookies'] }`. Astro middleware context (`APIContext`) ma oba pola natywnie — przekazujemy `context` bezpośrednio. Adapter cookies czyta `context.request.headers.get('Cookie')`, pisze `context.cookies.set(...)`.
- **`getUser()` vs `getSession()`**: middleware MUSI używać `getUser()` (weryfikuje JWT przez Supabase Auth, source of truth). `getSession()` czyta tylko cookies bez weryfikacji i jest security risk dla auth-guard.
- **`App.Locals` jako required**: typowanie deklaruje `supabase: SupabaseClient<Database>` (nie optional), bo middleware ZAWSZE go ustawia przed request handlerem. To eliminuje konieczność `if (!locals.supabase)` w każdym konsumencie.

## Phase 1: Response envelope + helpery + unit test

### Overview

Czysty TS substrate dla wszystkich endpointów `/api/*`. Bez request lifecycle, bez Supabase — deterministyczne helpery testowalne w izolacji.

### Changes Required:

#### 1. Helpery response envelope

**File**: `src/lib/http/response.ts` (nowy)

**Intent**: Dostarczyć typowane helpery konstruujące `Response` z security headers w defaultach, żeby endpointy NIGDY nie konstruowały `new Response()` ręcznie. Plus walidator UUID dla privacy-first 404 z bad path param.

**Contract**: eksportuje:
- `type ApiErrorCode = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR' | 'RATE_LIMITED'` (5 codes, rozszerzanie per slice)
- `apiResponse<T>(opts: { data: T; status?: number; headers?: HeadersInit }): Response` — `Content-Type: application/json` + `Cache-Control: private, no-store` w defaultach, status default 200, JSON body `{ data }`
- `apiError(opts: { code: ApiErrorCode; status: number; message: string; details?: unknown; headers?: HeadersInit }): Response` — te same defaulty headers, JSON body `{ error: { code, message, details } }`
- `parseUuidParam(raw: string | undefined): string | null` — UUID regex (case-insensitive `[0-9a-f]{8}-...{12}`), zwraca lowercase string albo `null` (call-site mapuje null → `apiError({ code: 'NOT_FOUND', status: 404 })`)

Brak `any` w żadnej signaturze; `details` typowane jako `unknown`.

#### 2. Unit testy helper'ów

**File**: `tests/unit/lib/http/response.test.ts` (nowy)

**Intent**: Pokryć envelope shape, headers defaults i edge cases UUID parsowania, żeby load-bearing kontrakt nie cofnął się przy refactorze.

**Contract**: minimum scenariuszy:
- `apiResponse({ data: { x: 1 } })` → status 200, header `Cache-Control: private, no-store`, body `{"data":{"x":1}}`
- `apiResponse({ data: ..., headers: { 'X-Custom': 'y' } })` → custom header obecny, default headers zachowane (merge, nie replace)
- `apiError({ code: 'NOT_FOUND', status: 404, message: 'nope' })` → status 404, body `{"error":{"code":"NOT_FOUND","message":"nope"}}`, `details` nieobecny w body gdy nie przekazany
- `apiError({ ..., details: { field: 'name' } })` → `details` w body
- `parseUuidParam(undefined)` / `parseUuidParam('')` / `parseUuidParam('not-a-uuid')` / `parseUuidParam('zzzzzzzz-...')` → null
- `parseUuidParam('A1B2C3D4-5678-90AB-CDEF-1234567890AB')` → lowercase string

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — 0 błędów, `src/lib/http/response.ts` bez `any`
- `npm run lint` zielony na `src/lib/http/**`
- `npm run test` zielony — minimum 8 testów w `tests/unit/lib/http/response.test.ts`

#### Manual Verification:

- Code review: signatury helperów zgodne z kontraktem powyżej, defaultowe headers obecne, brak `new Response()` z ręcznie ustawianym Cache-Control

**Implementation Note**: Po przejściu automatycznej weryfikacji zatrzymaj się na code-review (sygnatury + headers), zanim ruszysz fazę 2.

---

## Phase 2: Middleware auth-guard + Astro.locals typing

### Overview

Middleware tworzy Supabase client per request, weryfikuje session przez `getUser()` z treat-as-anon error handling, wpisuje user + supabase do `Astro.locals`, egzekwuje whitelist publicznych ścieżek (redirect 302 dla protected stron / 401 envelope dla protected API).

### Changes Required:

#### 1. Typowanie `App.Locals`

**File**: `src/env.d.ts` (nowy)

**Intent**: Zadeklarować shape `Astro.locals` żeby endpointy/strony konsumowały `locals.supabase` / `locals.user` z pełnym typowaniem.

**Contract**: `declare namespace App { interface Locals { supabase: SupabaseClient<Database>; user: AuthUser | null; } }`. Import `SupabaseClient` i `AuthUser` z `@supabase/supabase-js` (`AuthUser` to renamed re-export `User` z `@supabase/auth-js` — supabase-js zmienia nazwę, żeby uniknąć kolizji), `Database` z `./lib/db/database.types`. Reference do `astro/client` types na górze. **NIE** dodajemy do `ignores` w eslint.config.mjs — `env.d.ts` jest tam już od dawna ([eslint.config.mjs:19](../../../eslint.config.mjs)).

#### 2. Middleware auth-guard

**File**: `src/middleware.ts` (nowy)

**Intent**: Egzekwować autoryzację per request: utworzyć Supabase client, zweryfikować user przez `getUser()`, wpisać oba do `locals`, przepuścić publiczne / przekierować chronione strony / zwrócić 401 dla chronionych API.

**Contract**: eksportuje `onRequest` (z `defineMiddleware` z `astro:middleware`). Algorytm:
1. `const supabase = createServerSupabaseClient(context)` — request-scoped klient.
2. `let user: AuthUser | null = null; try { const { data } = await supabase.auth.getUser(); user = data.user; } catch (err) { console.error('[middleware] auth.getUser failed', { path: context.url.pathname, err }); }` — treat-as-anon + log.
3. `context.locals.supabase = supabase; context.locals.user = user;` — wpisz oba do locals (zanim cokolwiek decyduje).
4. Sprawdź whitelist: `isPublicPath(context.url.pathname)` — helper porównujący path z `PUBLIC_PREFIXES` (`/`, `/login`, `/signup`, `/api/auth/`). Match dokładny dla `/` i `/login`/`/signup`, prefix dla `/api/auth/`.
5. Jeśli public → `return next()`.
6. Jeśli niepubliczne i `!user`: gdy `pathname.startsWith('/api/')` → zwróć `apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' })`; w innym wypadku → `return context.redirect('/login')` (302 default).
7. W innym wypadku → `return next()`.

`PUBLIC_PREFIXES` jest stałą module-level — nowa publiczna ścieżka wymaga edycji listy (świadomie, default secure).

#### 3. Unit test middleware

**File**: `tests/unit/middleware.test.ts` (nowy)

**Intent**: Pokryć decision tree middleware deterministycznie, bez realnego Supabase.

**Contract**: Vitest, mock `createServerSupabaseClient` przez `vi.mock('../../src/lib/db/supabase.server', ...)`. Helper builder `makeContext({ path, mockUser })` zwracający fake `APIContext` (z `url`, `request`, `cookies`, `locals: {}`, `redirect: vi.fn()`, plus mock'owany supabase który `auth.getUser` rozwiązuje na `{ data: { user: mockUser }, error: null }` lub rzuca). Minimum scenariuszy:
- Public path (`/`, `/login`, `/api/auth/login`) bez sesji → `next()` zawołane, `locals.user === null`, `locals.supabase` ustawiony
- Public path z sesją → `next()` zawołane, `locals.user` ustawiony
- Protected page (`/library`) bez sesji → `context.redirect('/login')` zawołane, `next()` NIE zawołane
- Protected page z sesją → `next()` zawołane
- Protected API (`/api/shelves`) bez sesji → zwrócony 401 envelope z `code: 'UNAUTHENTICATED'`, `next()` NIE zawołane
- Protected API z sesją → `next()` zawołane
- `getUser()` rzuca → `user = null`, `console.error` zawołane, dalej decyzja jak dla anon (redirect/401)

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — `context.locals.supabase`/`locals.user` typowane z `App.Locals`, brak `any`
- `npm run lint` zielony na `src/middleware.ts` + `src/env.d.ts`
- `npm run test` zielony — minimum 7 testów w `tests/unit/middleware.test.ts` pokrywających każdy scenariusz powyżej

#### Manual Verification:

- Code review: `src/middleware.ts` NIE używa `new Response()` ręcznie (tylko przez `apiError`); `getUser()` (nie `getSession()`); `PUBLIC_PREFIXES` jako module-level constant
- `App.Locals` w `src/env.d.ts` deklaruje `supabase` jako required (nie optional)

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na code-review (`getUser` vs `getSession`, brak ręcznego `new Response`), zanim ruszysz fazę 3.

---

## Phase 3: CLAUDE.md sync — pointer do helpera jako single source of truth

### Overview

Domknięcie cyklu enforcement-by-code (lesson 2026-05-20). Proza w CLAUDE.md zostaje jako quick-reference dla skanowania, ale wskazuje na `src/lib/http/response.ts` jako autorytatywną definicję kontraktu — analogicznie do aktualizacji Supabase server-client w F-01.

### Changes Required:

#### 1. Aktualizacja sekcji § API endpoints

**File**: `CLAUDE.md` (sekcja Konwencje > API endpoints)

**Intent**: Pointer z prozy do helpera, żeby load-bearing kontrakt miał single source of truth. Konwencja z [Workflow agenta](../../../CLAUDE.md) o adaptacjach literalnych: drift między prozą a kodem łapiemy raz, post-implementacja.

**Contract**: dwie precyzyjne edycje w sekcji § API endpoints (CLAUDE.md), pozostała proza bez zmian:

1. **Wstaw nowe zdanie na początku sekcji**, przed istniejącą prozą o response shape: *"**Single source of truth**: `src/lib/http/response.ts` (typowany `ApiErrorCode` union: `UNAUTHENTICATED | NOT_FOUND | VALIDATION_ERROR | INTERNAL_ERROR | RATE_LIMITED` + helpery `apiResponse({ data })` / `apiError({ code, status, message, details? })` z `Cache-Control: private, no-store` w defaultach + `parseUuidParam` dla 404-privacy na bad UUID). Endpointy konsumują wyłącznie te helpery — nie konstruują `new Response()` ręcznie."*

2. **Podmień listę codes w istniejącym akapicie**: fragment `(\`UNAUTHENTICATED\`, \`SHELF_NOT_FOUND\`, \`INTERNAL_ERROR\`)` → `(\`UNAUTHENTICATED\`, \`NOT_FOUND\`, \`VALIDATION_ERROR\`, \`INTERNAL_ERROR\`, \`RATE_LIMITED\`)`. `SHELF_NOT_FOUND` całkowicie usunięty (nie należy do naszego minimal union — był hipotetycznym przykładem; per-resource codes wprowadzamy per slice gdy realnie potrzebne, zob. plan-brief Key Decisions). Reszta akapitu (status codes, headers, prerender) bez zmian.

### Success Criteria:

#### Automated Verification:

- `grep -F 'src/lib/http/response.ts' CLAUDE.md` exit 0 — pointer obecny w pliku

#### Manual Verification:

- CLAUDE.md sekcja § API endpoints na początku pokazuje pointer do `src/lib/http/response.ts` z listą codes z naszego union
- Proza zachowana jako quick-reference (nie usunięta, nie przepisana)
- `SHELF_NOT_FOUND` usunięty z istniejącej prozy (brak referencji do nieistniejących codes jako autoritative)

**Implementation Note**: Phase 3 to pure docs — automated gate to tylko sanity check że pointer trafił do pliku; reszta to manual review spójności CLAUDE.md z faktycznym kontraktem helpera.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/lib/http/response.test.ts` — envelope shape + headers + UUID edge cases (Phase 1)
- `tests/unit/middleware.test.ts` — middleware decision tree z mocked Supabase (Phase 2)

### Integration Tests:

- Brak w F-02. Middleware integration z realnym Supabase Auth przychodzi w S-01 (E2E z prawdziwym login flow); helper response.ts deterministyczny — unit test wystarcza.

### Manual Testing Steps:

1. Po Phase 1: review signatury helperów + headers defaults
2. Po Phase 2: review `getUser` vs `getSession`, brak ręcznego `new Response`, `PUBLIC_PREFIXES` jako constant, `App.Locals` required
3. Po Phase 3: review CLAUDE.md § API endpoints — pointer obecny, lista codes zgodna z union

## Performance Considerations

- Middleware wywołuje `getUser()` per request, co jest network call do Supabase Auth. W kontekście Cloudflare Workers + małej skali MVP (target_scale: small per [prd.md frontmatter](../../foundation/prd.md)) to akceptowalne. Optymalizacja przez session cache to post-MVP (najwcześniej po metrykach z prod). Dla porównania: `getSession()` byłby lokalny ale niepewny (cookies bez weryfikacji JWT) — security risk dla auth-guard.
- `parseUuidParam` regex jest constant-time per call; brak impactu na hot path.

## Migration Notes

Brak — F-02 nie modyfikuje istniejących artefaktów (poza CLAUDE.md docs sync). Pierwsze realne konsumenty (`/api/auth/*`) wejdą dopiero w S-01.

## References

- Roadmap slice: [`context/foundation/roadmap.md` (F-02)](../../foundation/roadmap.md)
- F-01 substrate konsumowany: [`src/lib/db/supabase.server.ts`](../../../src/lib/db/supabase.server.ts) (`createServerSupabaseClient`)
- Konwencje API endpoints: [`CLAUDE.md` § API endpoints](../../../CLAUDE.md)
- Lesson load-bearing convention: [`context/foundation/lessons.md`](../../foundation/lessons.md) (test 2026-05-20)
- Lesson adaptacje literalne: [`context/foundation/lessons.md`](../../foundation/lessons.md) (dla Phase 3 docs sync)
- PRD guardrail prywatności + privacy 404: [`context/foundation/prd.md`](../../foundation/prd.md) (§ Guardrails, FR-003, FR-004, NFR)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Response envelope + helpery + unit test

#### Automated

- [x] 1.1 `npm run typecheck` zielony — 0 błędów, `src/lib/http/response.ts` bez `any` — ebe95b4
- [x] 1.2 `npm run lint` zielony na `src/lib/http/**` — ebe95b4
- [x] 1.3 `npm run test` zielony — minimum 8 testów w `tests/unit/lib/http/response.test.ts` — ebe95b4

#### Manual

- [x] 1.4 Code review: signatury helperów zgodne z kontraktem, defaultowe headers obecne, brak `new Response()` z ręcznie ustawianym Cache-Control — ebe95b4

### Phase 2: Middleware auth-guard + Astro.locals typing

#### Automated

- [ ] 2.1 `npm run typecheck` zielony — `context.locals.supabase`/`locals.user` typowane z `App.Locals`, brak `any`
- [ ] 2.2 `npm run lint` zielony na `src/middleware.ts` + `src/env.d.ts`
- [ ] 2.3 `npm run test` zielony — minimum 7 testów w `tests/unit/middleware.test.ts` pokrywających każdy scenariusz

#### Manual

- [ ] 2.4 Code review: `src/middleware.ts` NIE używa `new Response()` ręcznie (tylko przez `apiError`); `getUser()` (nie `getSession()`); `PUBLIC_PREFIXES` jako module-level constant
- [ ] 2.5 `App.Locals` w `src/env.d.ts` deklaruje `supabase` jako required (nie optional)

### Phase 3: CLAUDE.md sync — pointer do helpera jako single source of truth

#### Automated

- [ ] 3.1 `grep -F 'src/lib/http/response.ts' CLAUDE.md` exit 0 — pointer obecny w pliku

#### Manual

- [ ] 3.2 CLAUDE.md sekcja § API endpoints na początku pokazuje pointer do `src/lib/http/response.ts` z listą codes z naszego union
- [ ] 3.3 Proza zachowana jako quick-reference (nie usunięta, nie przepisana)
- [ ] 3.4 `SHELF_NOT_FOUND` usunięty z istniejącej prozy (brak referencji do nieistniejących codes jako autoritative)
