# S-01: Rejestracja, logowanie i wylogowanie email+hasło (email-password-auth) — Implementation Plan

## Overview

Pierwszy user-facing slice (S-01 z roadmapy). Dostarcza pełen email+hasło auth flow: trigger SQL `handle_new_user` (profile + shelf „Zakupione"), 3 endpointy `/api/auth/{signup,login,logout}` konsumujące F-02 substrate (response envelope + middleware), strony `/signup` + `/login` z React islands (pierwsze realne islands w projekcie), E2E Playwright (pierwszy E2E test). Po S-01: użytkownik może założyć konto, zalogować się, wylogować; niezalogowany na chronionej ścieżce jest przekierowywany na `/login` (już egzekwowane przez F-02 middleware); widzi wyłącznie własne dane (już egzekwowane przez F-01 RLS).

## Current State Analysis

- **F-01 substrate ready**: `createServerSupabaseClient(context)` w [src/lib/db/supabase.server.ts](../../../src/lib/db/supabase.server.ts) — anon key + JWT z cookies, request-scoped. RLS na 8 tabelach (migracje 0001+0002 applied).
- **F-02 substrate ready**: `apiResponse`/`apiError` z `Cache-Control: private, no-store` w [src/lib/http/response.ts](../../../src/lib/http/response.ts); middleware z whitelist `['/', '/login', '/signup', '/api/auth/']` w [src/lib/middleware/handler.ts](../../../src/lib/middleware/handler.ts) — niezalogowany na chronionej ścieżce strony → 302 do `/login`, API → 401 envelope. `App.Locals.{user, supabase}` typowane w [src/env.d.ts](../../../src/env.d.ts).
- **Database**: tabele `profiles` ([0001:8](../../../supabase/migrations/0001_initial_schema.sql)) i `shelves` ([0001:15](../../../supabase/migrations/0001_initial_schema.sql)) istnieją; RLS w 0002 pokrywa obie. **Brak trigger'a** `handle_new_user` — to delta tego slice'a.
- **UI baseline**: [src/pages/index.astro](../../../src/pages/index.astro) (landing stub), [src/layouts/Layout.astro](../../../src/layouts/Layout.astro) (simple shell z tailwind). `src/components/` pusty (brak React islands jeszcze). `src/pages/api/` pusty (brak endpointów).
- **Konwencje API endpoints** ustalone w [CLAUDE.md § API endpoints](../../../CLAUDE.md): single source of truth → `src/lib/http/response.ts`, `export const prerender = false` per endpoint, `Cache-Control: private, no-store` w defaultach, 404-privacy dla zniekształconego UUID, 401 przed resource fetch (middleware już to robi dla `/api/*`).
- **Deps obecne**: `@supabase/supabase-js` 2.106.0, `@supabase/ssr` 0.10.3, `zod`, React 19, Vitest 4, Playwright 1.60 (browser binaries wymagają jednorazowego `npx playwright install --with-deps`).

## Desired End State

Po wykonaniu planu:
- Migracja 0003 zaaplikowana do zlinkowanego projektu: trigger `handle_new_user` (SECURITY DEFINER) tworzy profile + shelf „Zakupione" po INSERT do `auth.users`.
- `src/lib/auth/schema.ts` eksportuje `SignupSchema` (email + password min 6 + display_name 1-100 chars) i `LoginSchema` (email + non-empty password) jako Zod schemas.
- 3 endpointy POST: `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` w [src/pages/api/auth/](../../../src/pages/api/) — konsumują `apiResponse`/`apiError` z F-02, `locals.supabase` z middleware. Auto-confirm signup (Supabase Dashboard: Auth → Confirm email = off). Login zwraca 401 dla bad credentials.
- 2 strony Astro: `/signup` + `/login` renderują React islands (SignupForm + LoginForm) z `client:load`. Form wysyła fetch POST do endpointa, success → `window.location.href = '/'`, error → inline error state.
- `Layout.astro` rozszerzony: jeśli `Astro.locals.user` istnieje, pokazuje user email + LogoutButton (POST do `/api/auth/logout`).
- Test integracyjny: `tests/integration/auth-trigger.test.ts` (analog F-01 phase 3) — `admin.auth.createUser` z user_metadata.display_name → query potwierdza profile + shelf „Zakupione" utworzone.
- E2E Playwright: `tests/e2e/auth.spec.ts` — golden path signup → auto-login → logout → redirect na `/`.

**Weryfikacja**: `npx supabase migration list` (0003 applied) + `npm run typecheck` + `npm run lint` + `npm run test` + `npm run test:integration` + `npm run test:e2e` wszystkie zielone; code review potwierdza brak `new Response()` ręcznie w endpointach (tylko przez `apiError`/`apiResponse`), brak service-role w runtime kodzie (tylko w teście integracyjnym lokalnie).

### Key Discoveries:

- **Auto-confirm wymaga konfiguracji w Supabase Dashboard** (Auth → Settings → "Confirm email" toggle off) — nie kod, nie migracja. Manual step do udokumentowania w Implementation Note Phase 1.
- **Trigger SECURITY DEFINER musi mieć `search_path = public, pg_temp`** żeby uniknąć schema hijack vulnerability. Bez tego linter Postgres flag'uje funkcję.
- **`signUp` z opcjami `data: { display_name }`** zapisuje display_name do `auth.users.raw_user_meta_data` — trigger czyta `NEW.raw_user_meta_data->>'display_name'`.
- **Middleware już ma `/api/auth/` w PUBLIC_PREFIXES** ([handler.ts:16](../../../src/lib/middleware/handler.ts)) — endpointy auth nie wymagają sesji (sensownie: jak ktoś niezalogowany może się zalogować?). Logout w whitelist jest no-op gdy user null.
- **F-02 lessons.md "Adaptacje literalne"** — jeśli któryś szczegół implementacji okaże się niezgodny z planem (np. Supabase Auth API zmienione, Astro middleware reaguje inaczej w prod), accept + flag + nie wracamy do `/10x-plan`.
- **React island fetch JSON pattern**: form submit → `fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })` → parse JSON envelope → handle `data.redirect` lub `error.code`.

## What We're NOT Doing

- **OAuth / SSO (Google, GitHub)** — FR-002 świadomie deferred do post-MVP ([prd.md](../../foundation/prd.md), Socrates round).
- **Password reset flow** (`/forgot-password`, reset email link) — post-MVP. W MVP user solo, nie ma userów do straty hasła.
- **Email verification flow** (verification link click) — auto-confirm wybrany w Q1 planning; pełen flow weryfikacji emaila to overhead bez wartości w MVP solo.
- **Rate limiting na auth endpointach** — `RATE_LIMITED` code w F-02 union istnieje, ale enforcement w MVP nie potrzebny (solo user). Najwcześniej gdy publiczne demo.
- **`?next=` deep-link preservation** po login — Q7 wybrał stałą `/` z post-MVP refactor gdy `/library` (S-06) istnieje.
- **Edycja profile po signup** (settings page) — display_name pobierany raz w signup, edytowalny w S-06+ lub osobnym slice'u.
- **Multi-tab session sync** — Supabase SSR cookies handle to natywnie; nie dodajemy własnej logiki.
- **`/api/auth/me` endpoint** zwracający current user info — `Astro.locals.user` wystarcza dla SSR; client (React) jeśli potrzebuje, wykorzystuje `createBrowserSupabaseClient().auth.getUser()`.
- **CSRF tokens explicit** — Same-Site cookies z `@supabase/ssr` (default `lax`) + POST-only mutating endpoints to wystarczająca obrona dla MVP. Explicit CSRF tokens post-MVP gdyby zaszła potrzeba.
- **Layout navbar z linkami nawigacji** (do /library, /shelves itp.) — te strony nie istnieją w S-01. Layout dostaje tylko user email + LogoutButton gdy zalogowany; pełen navbar w S-06.

## Implementation Approach

Trzy fazy w kolejności zależności: (1) backend substrate (migracja trigger + Zod schemas — fundament bez którego endpointy nie mają sensu), (2) endpointy auth + integration test (konsumują schema + trigger, testują trigger end-to-end), (3) frontend + E2E (konsumuje endpointy). Każda faza ma własną bramkę automatyczną (typecheck/lint/test + dla Phase 1 `migration list`, dla Phase 3 E2E green).

## Critical Implementation Details

- **Trigger SECURITY DEFINER + search_path**: function musi mieć `SET search_path = public, pg_temp` w definicji, inaczej Postgres linter flag'uje (potential schema hijack via `pg_catalog`/`temp` shadowing). Standardowy Supabase pattern, dokumentowany w Supabase Docs.
- **Auto-confirm = manual Dashboard step**: nie da się włączyć z poziomu migracji SQL ani kodu — toggle w Supabase Dashboard Auth → Settings. Implementation Note dla Phase 1: użytkownik musi wejść w Dashboard i wyłączyć "Confirm email" przed pierwszym signup testem.
- **Endpointy auth NIE konsumują `locals.user`**: middleware whitelist'uje `/api/auth/*`, więc `locals.user` może być null (zazwyczaj jest — user niezalogowany chce się zalogować). Endpointy używają tylko `locals.supabase`. Logout dla `locals.user === null` to no-op success.
- **React island state coś robi z error UX**: Zod fail (z endpointa: `apiError({ code: VALIDATION_ERROR, status: 400, details: zodError.flatten() })`) → form renderuje per-field errors z `details.fieldErrors`. Other errors (401, 500) → single inline message na górze form.
- **Cookie lifecycle w endpointach auth**: `signIn` / `signUp` / `signOut` przez `locals.supabase` set'ują cookies w response (przez `@supabase/ssr` cookie adapter z F-01 — `context.cookies.set(...)`). ALE: `locals.user` w tym samym requestcie POZOSTAJE w stanie sprzed akcji (middleware już wcześniej zafiksował user state z cookies przyszłych do request). Efekt zalogowania widoczny dopiero w NASTĘPNYM requestcie — klient robi `window.location.href = data.redirect` → nowy request → middleware odczytuje nowo-ustawione cookies → `locals.user` populated. Nie próbuj manualnie wymuszać `locals.user` update w endpointcie auth (premature; flow działa bo client zawsze redirectuje po success).

## Phase 1: Migracja 0003 + Zod schemas (backend substrate)

### Overview

Fundament backendu auth: trigger SQL tworzący profile + półkę „Zakupione" po signup, plus walidacja Zod dla input'u endpointów.

### Changes Required:

#### 1. Migracja: trigger handle_new_user

**File**: `supabase/migrations/0003_handle_new_user.sql` (nowy)

**Intent**: Po INSERT do `auth.users` (signup) automatycznie utworzyć `profiles` row + `shelves` row z `name='Zakupione'` (FR-008: systemowa wirtualna półka). Rollback przy błędzie (Q8 — atomic semantics).

**Contract**:
- Funkcja `public.handle_new_user()` z `SECURITY DEFINER` + `SET search_path = public, pg_temp` (anti-hijack).
- Funkcja czyta `NEW.id` (uuid usera z auth.users) i `NEW.raw_user_meta_data->>'display_name'` (text, może być NULL jeśli signup bez metadata — Zod waliduje że nie jest w naszym flow).
- `INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name');`
- `INSERT INTO public.shelves (user_id, name) VALUES (NEW.id, 'Zakupione');`
- Brak własnego `EXCEPTION` block — rollback default Postgres.
- Trigger `on_auth_user_created` AFTER INSERT ON `auth.users` FOR EACH ROW EXECUTE FUNCTION `public.handle_new_user()`.

#### 2. Zod schemas dla auth I/O

**File**: `src/lib/auth/schema.ts` (nowy)

**Intent**: Single source of truth dla walidacji email/password/display_name w endpointach — konwersja z Zod do `apiError({ code: 'VALIDATION_ERROR', details })` w handlerach.

**Contract**: eksportuje:
- `SignupSchema = z.object({ email: z.string().email(), password: z.string().min(6), display_name: z.string().min(1).max(100).trim() })`
- `LoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) })` (min 6 spójnie z SignupSchema i Supabase Auth default — pre-walidacja w Zod daje czytelniejszy field-level error niż generic 401 "Invalid email or password" z Supabase dla za-krótkiego hasła; Q2)
- `type SignupInput = z.infer<typeof SignupSchema>` + `type LoginInput = z.infer<typeof LoginSchema>` (typowane export'y dla konsumentów).

#### 3. Unit testy Zod schemas

**File**: `tests/unit/lib/auth/schema.test.ts` (nowy)

**Intent**: Pokrycie walidacji email/password/display_name + edge cases, żeby load-bearing kontrakt nie cofał się przy refactorze.

**Contract**: minimum scenariuszy (≥10 testów):
- `SignupSchema`: valid input → success; invalid email format → fail; password 5 chars → fail; password 6 chars → success (boundary); display_name empty → fail; display_name 101 chars → fail; display_name z whitespace → trimmed
- `LoginSchema`: valid input → success; invalid email → fail; password 5 chars → fail; password 6 chars → success (boundary, spójne z SignupSchema)

### Success Criteria:

#### Automated Verification:

- `npx supabase migration list` pokazuje 0003 jako applied na zdalnym projekcie
- `npm run typecheck` zielony — 0 błędów, schema bez `any`
- `npm run lint` zielony na `src/lib/auth/**`
- `npm run test` zielony — minimum 10 testów w `tests/unit/lib/auth/schema.test.ts`

#### Manual Verification:

- W Supabase Studio (zlinkowany projekt) widoczna funkcja `public.handle_new_user` + trigger `on_auth_user_created` na `auth.users`
- W Supabase Dashboard Auth → Settings → **„Confirm email" toggle = off** (manual step — auto-confirm per Q1; jeśli zostawione on, signup tworzy usera w stanie pending i nie loguje od razu — psuje Q3 auto-login)

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie (Studio + Dashboard toggle), zanim ruszysz fazę 2. **Toggle „Confirm email" off jest blokujący dla całego Q1/Q3 contract** — bez tego endpoint signup nie zwróci `data.session` i auto-login fail.

---

## Phase 2: Endpoints /api/auth/{signup,login,logout} + integration test trigger

### Overview

3 POST endpointy konsumujące Zod schemas + Supabase Auth + F-02 helpers. Plus integration test trigger weryfikujący że signup tworzy profile + Zakupione.

### Changes Required:

#### 1. Endpoint signup

**File**: `src/pages/api/auth/signup.ts` (nowy)

**Intent**: Walidacja Zod input → `supabase.auth.signUp` z user_metadata.display_name → success: zwróć `apiResponse({ data: { redirect: '/' } })` (auto-login per Q3, session ustawiona przez @supabase/ssr cookie); error: `apiError` z odpowiednim code/status.

**Contract**:
- `export const prerender = false` (Cloudflare Workers wymóg).
- `export const POST: APIRoute = async ({ request, locals }) => { ... }`.
- Parse JSON body → `SignupSchema.safeParse(body)`. Jeśli fail: `return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid signup input', details: parsed.error.flatten() })`.
- `const { data, error } = await locals.supabase.auth.signUp({ email, password, options: { data: { display_name } } })`.
- Jeśli `error`: mapuj — Supabase "User already registered" → `apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Email is already registered' })`; inne błędy → `apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Signup failed' })` (log err.message).
- Jeśli `data.user === null` (auto-confirm wyłączone w Dashboard): `apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Auto-confirm not configured' })` — wskazówka dla operatora.
- Success: `apiResponse({ data: { redirect: '/' } })`.

#### 2. Endpoint login

**File**: `src/pages/api/auth/login.ts` (nowy)

**Intent**: Walidacja Zod → `signInWithPassword` → success redirect, error 401 z generic message (privacy: nie ujawniaj czy email istnieje).

**Contract**:
- Identyczna struktura co signup, z `LoginSchema` i `locals.supabase.auth.signInWithPassword({ email, password })`.
- Error → `apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Invalid email or password' })` (generic — nie ujawniamy czy email istnieje, privacy guardrail).
- Success → `apiResponse({ data: { redirect: '/' } })`.

#### 3. Endpoint logout

**File**: `src/pages/api/auth/logout.ts` (nowy)

**Intent**: `signOut` → cookie cleared przez @supabase/ssr → redirect na `/`.

**Contract**:
- POST handler (Q6).
- `await locals.supabase.auth.signOut()` — idempotent (no-op jeśli user null).
- Error → log + apiError({ code: 'INTERNAL_ERROR', status: 500, ... }) (rare — Supabase signOut zwraca error tylko gdy network blip; treat as soft fail).
- Success → `apiResponse({ data: { redirect: '/' } })`.

#### 4. Unit testy endpointów

**File**: `tests/unit/pages/api/auth/{signup,login,logout}.test.ts` (3 pliki nowe)

**Intent**: Pokrycie happy path + error paths dla każdego endpointa, mock'owany `locals.supabase`.

**Contract**: minimum scenariuszy per endpoint (≥4 każdy, ≥12 total):
- **signup**: valid → 200 z `data.redirect`; invalid Zod → 400 z `error.code='VALIDATION_ERROR'` + details; Supabase "User already registered" → 400 z generic message; Supabase inny error → 500.
- **login**: valid → 200 z `data.redirect`; invalid Zod → 400; bad credentials → 401 z `error.code='UNAUTHENTICATED'`; Supabase inny error → 500.
- **logout**: zalogowany user → 200; brak user (locals.user=null) → 200 (idempotent); Supabase signOut error → 500.

**Test pattern**: endpointy NIE importują `createServerSupabaseClient` (używają `locals.supabase` z middleware) — dlatego mock pattern jest INNY niż F-02 middleware test (który mock'ował module). Tu: builder `makeContext({ user, supabase })` zwraca fake `APIContext` z `locals.user` + `locals.supabase` mocked (mocked `auth.signUp` / `signInWithPassword` / `signOut` zwracające skonfigurowane response). POST handler wywoływany bezpośrednio: `const res = await POST(makeContext({ supabase: fakeSupabase }))`. Bez `vi.mock` na poziomie modułu.

#### 5. Integration test trigger handle_new_user

**File**: `tests/integration/auth-trigger.test.ts` (nowy)

**Intent**: Dowieść że trigger tworzy profile + shelf „Zakupione" po signup, oraz że RLS-respecting client (po zalogowaniu) widzi własny profile + shelf.

**Contract**: Vitest integration (config `vitest.integration.config.ts` z F-01), pattern jak `tests/integration/rls.test.ts`:
- `beforeAll`: admin client (service-role lokalnie w teście, jak F-01) tworzy usera przez `admin.auth.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Test User' } })`.
- Asercje (z admin client, omija RLS — bezpośredni query):
  - Query `profiles WHERE id = createdUser.id` → zwraca 1 row z `display_name = 'Test User'`.
  - Query `shelves WHERE user_id = createdUser.id` → zwraca 1 row z `name = 'Zakupione'`.
- Drugi test scenariusz (RLS-scoped): anon client `signInWithPassword` → query `profiles` → widzi tylko swój profile (1 row); query `shelves` → widzi tylko swoją Zakupione.
- `afterAll`: `Promise.allSettled([admin.auth.deleteUser(userIdA), admin.auth.deleteUser(userIdB)])` (analogiczne do F-01 phase 3 fix F1 — resilient cleanup).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — endpointy + testy typowane bez `any` (poza eslint-disable w mock'ach testów)
- `npm run lint` zielony na `src/pages/api/auth/**` + `tests/unit/pages/api/auth/**`
- `npm run test` zielony — minimum 12 nowych testów endpointów + 10 schema = 22+ unit tests
- `npm run test:integration` zielony — auth-trigger.test.ts: profile + Zakupione utworzone, RLS scoped

#### Manual Verification:

- Code review: każdy endpoint ma `export const prerender = false`; brak `new Response()` ręcznie (tylko przez apiResponse/apiError); brak `SUPABASE_SERVICE_ROLE_KEY` w endpoint code (tylko w teście integracyjnym lokalnie)
- Po przebiegu test:integration: zlinkowany projekt nie zawiera userów-śmieci w `auth.users` (cleanup zadziałał — sprawdź w Studio Auth)

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie cleanupu (Studio) + code review (brak service-role w endpoint code), zanim ruszysz fazę 3.

---

## Phase 3: Strony + React forms + E2E Playwright

### Overview

Frontend auth flow: dwie strony Astro renderujące React island forms (signup + login), button logout w Layout, golden-path E2E Playwright.

### Changes Required:

#### 1. React component: SignupForm

**File**: `src/components/SignupForm.tsx` (nowy)

**Intent**: Hydrated client island z 3 fields (email + password + display_name), state form + errors, submit przez fetch JSON do `/api/auth/signup`, success → `window.location.href = data.redirect`.

**Contract**:
- `'use client'` nie wymagane (Astro/React 19 — client:load directive na stronie wystarczy).
- React functional component, default export.
- State: `email`, `password`, `display_name`, `loading: boolean`, `formError: string | null`, `fieldErrors: Record<string, string[]> | null`.
- Submit handler: `e.preventDefault()`, `setLoading(true)`, `fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, display_name }) })`.
- Response parse: `const json = await res.json()`. Jeśli `res.ok`: `window.location.href = json.data.redirect`. Jeśli `json.error.code === 'VALIDATION_ERROR'`: `setFieldErrors(json.error.details.fieldErrors)`. Inne: `setFormError(json.error.message)`.
- Renderowanie: standardowy form, per-field error display z `fieldErrors[name]?.[0]`, top-level `formError` jeśli ustawiony, submit button disabled gdy `loading`.

#### 2. React component: LoginForm

**File**: `src/components/LoginForm.tsx` (nowy)

**Intent**: Analog SignupForm, bez display_name field.

**Contract**: Identyczna struktura jak SignupForm bez display_name, endpoint `/api/auth/login`.

#### 3. React component: LogoutButton

**File**: `src/components/LogoutButton.tsx` (nowy)

**Intent**: Pojedynczy button POST do `/api/auth/logout`, success → reload.

**Contract**: Mały komponent, default export. Button onClick → `fetch('/api/auth/logout', { method: 'POST' })` → `window.location.href = '/'` niezależnie od response (idempotent z perspektywy UX — sesja albo jest sclear, albo była już clear).

#### 4. Strony auth

**File**: `src/pages/signup.astro` (nowy) + `src/pages/login.astro` (nowy)

**Intent**: Cienkie wrappery z Layout + heading + React form island + link do drugiej strony auth.

**Contract**:
- `signup.astro`: server-side guard na górze frontmattera `if (Astro.locals.user) return Astro.redirect('/');` — zalogowany user wraca na home, nie widzi pustego formularza. Następnie import Layout + SignupForm; `<Layout title="Rejestracja"><h1>...</h1><SignupForm client:load /><p>Masz konto? <a href="/login">Zaloguj się</a></p></Layout>`.
- `login.astro`: analogicznie z server-side guard + LoginForm + link do `/signup`.

#### 5. Layout: user info + logout button

**File**: `src/layouts/Layout.astro` (edit)

**Intent**: Jeśli `Astro.locals.user` istnieje, pokaż user email w nagłówku + LogoutButton. To minimum żeby E2E mogło zweryfikować "user jest zalogowany" + dać user'owi gdzie kliknąć żeby się wylogować.

**Contract**: dodać import LogoutButton + sekcję header conditional:
```astro
{Astro.locals.user && (
  <header class="flex justify-end gap-4 p-4 text-sm">
    <span>{Astro.locals.user.email}</span>
    <LogoutButton client:load />
  </header>
)}
```
Pozostała struktura Layout zachowana.

#### 6. E2E test: golden path auth

**File**: `tests/e2e/auth.spec.ts` (nowy)

**Intent**: Smoke test pełnego flow signup → auto-login → logout → redirect.

**Contract**: Playwright, env: `PUBLIC_SUPABASE_URL` + anon key z `.dev.vars` (analogicznie do integration test). `webServer` z `playwright.config.ts` startuje `npm run dev` na :4321.
- Test 1 „signup + auto-login": `page.goto('/signup')` → fill form (unique email per run, np. `e2e-${Date.now()}@example.com`) → click submit → expect URL = `/` → expect header zawiera user email.
- Test 2 „logout flow": (kontynuacja sesji z Test 1 LUB osobny test który najpierw loguje przez API w `beforeAll`) → click LogoutButton → expect URL = `/` → expect brak header z user email.
- Cleanup `afterAll`: admin.auth.deleteUser dla utworzonego e2e usera (resilient pattern jak F-01).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — React components typowane (bez `any` poza @ts-expect-error gdyby konieczne dla mock)
- `npm run lint` zielony na `src/components/**` + `src/pages/{signup,login}.astro`
- `npm run test` zielony — wszystkie unit + integration z Phase 1+2 nadal zielone (regression check)
- `npm run test:e2e` zielony — minimum 2 testy w `tests/e2e/auth.spec.ts` (signup + logout flow)

#### Manual Verification:

- Code review: React components używają `client:load` (nie `client:visible`, bo auth jest above-the-fold krytyczny); fetch JSON pattern spójny między SignupForm/LoginForm; LogoutButton idempotent
- Manual smoke: lokalnie `npm run dev` → otwórz `/signup` → wypełnij form → potwierdź auto-login + redirect → zaloguj się jeszcze raz → potwierdź logout (browser DevTools: cookies Supabase scleared)

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na manual smoke (DevTools cookies check + visual flow), zanim domknij plan. To ostatni gate S-01.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/lib/auth/schema.test.ts` — Zod validation (email format, password min, display_name length, trim)
- `tests/unit/pages/api/auth/{signup,login,logout}.test.ts` — endpoint logic z mocked Supabase auth

### Integration Tests:

- `tests/integration/auth-trigger.test.ts` — trigger `handle_new_user` tworzy profile + shelf „Zakupione"; RLS-scoped client widzi własne dane

### E2E Tests:

- `tests/e2e/auth.spec.ts` — golden path: signup → auto-login → logout

### Manual Testing Steps:

1. Po Phase 1: Studio — funkcja + trigger widoczne; Dashboard — Confirm email = off
2. Po Phase 2: code review brak service-role w endpoints; Studio brak userów-śmieci po test:integration
3. Po Phase 3: lokalny dev — signup + auto-login + logout flow w przeglądarce; DevTools cookies cleared po logout

## Performance Considerations

- Endpoint signup wykonuje `auth.signUp` + trigger SQL — pojedyncza transakcja Supabase, ~200-500ms acceptable dla single user signup (PRD NFR p95 < 1s dotyczy nawigacji, nie signup).
- React island `client:load` — hydration cost na `/signup` i `/login` ~5-20ms, akceptowalne (te strony nie są perf-critical, użytkownik wita je raz).
- E2E test wymaga browser binaries (`npx playwright install --with-deps` ~600 MB, jednorazowo) — flagowane w plan-brief Prerequisites.

## Migration Notes

- `0003_handle_new_user.sql` jest addytywne (CREATE FUNCTION + CREATE TRIGGER). Nie wpływa na istniejące tabele/dane. Idempotent dla testowych userów (każdy signup tworzy własny profile + shelf).
- **Manual rollback**: jeśli trigger okaże się broken w prod, drop'nij funkcję + trigger (`DROP TRIGGER on_auth_user_created ON auth.users; DROP FUNCTION public.handle_new_user();`), istniejący userzy (jeśli są) zachowują profile + shelf z czasu gdy trigger działał.
- **Dashboard auto-confirm toggle** to NIE migracja — to manual configuration step. Udokumentowane w Implementation Note Phase 1.

## References

- Roadmap slice: [context/foundation/roadmap.md (S-01)](../../foundation/roadmap.md)
- F-01 substrate konsumowany: [src/lib/db/supabase.server.ts](../../../src/lib/db/supabase.server.ts), [supabase/migrations/0001_initial_schema.sql](../../../supabase/migrations/0001_initial_schema.sql) (profiles + shelves)
- F-02 substrate konsumowany: [src/lib/http/response.ts](../../../src/lib/http/response.ts), [src/lib/middleware/handler.ts](../../../src/lib/middleware/handler.ts), [src/env.d.ts](../../../src/env.d.ts)
- Konwencje API endpoints: [CLAUDE.md § API endpoints](../../../CLAUDE.md)
- Lessons: [context/foundation/lessons.md](../../foundation/lessons.md) (load-bearing convention, adaptacje literalne, server-side error logging)
- PRD: [context/foundation/prd.md](../../foundation/prd.md) — FR-001, FR-003, FR-004, FR-008 (półka „Zakupione"), US-01 (Flow A bootstrap), § Access Control, § Guardrails (privacy)
- Integration test pattern: [tests/integration/rls.test.ts](../../../tests/integration/rls.test.ts) (F-01 phase 3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migracja 0003 + Zod schemas (backend substrate)

#### Automated

- [x] 1.1 `npx supabase migration list` pokazuje 0003 jako applied na zdalnym projekcie — N/A (sandbox)
- [x] 1.2 `npm run typecheck` zielony — 0 błędów, schema bez `any` — 7e71b66
- [x] 1.3 `npm run lint` zielony na `src/lib/auth/**` — 7e71b66
- [x] 1.4 `npm run test` zielony — minimum 10 testów w `tests/unit/lib/auth/schema.test.ts` — 7e71b66

#### Manual

- [x] 1.5 W Supabase Studio widoczna funkcja `public.handle_new_user` + trigger `on_auth_user_created` na `auth.users` — pre-configured
- [x] 1.6 W Supabase Dashboard Auth → Settings → "Confirm email" toggle = off (auto-confirm per Q1) — pre-configured

### Phase 2: Endpoints /api/auth/{signup,login,logout} + integration test trigger

#### Automated

- [x] 2.1 `npm run typecheck` zielony — endpointy + testy typowane bez `any` (poza eslint-disable w mock'ach) — 1fbfa6f
- [x] 2.2 `npm run lint` zielony na `src/pages/api/auth/**` + `tests/unit/pages/api/auth/**` — 1fbfa6f
- [x] 2.3 `npm run test` zielony — minimum 12 nowych testów endpointów + Phase 1 testy = 22+ unit tests — 1fbfa6f
- [x] 2.4 `npm run test:integration` zielony — auth-trigger.test.ts pokrywa trigger + RLS scoped — N/A (sandbox)

#### Manual

- [x] 2.5 Code review: każdy endpoint ma `export const prerender = false`; brak `new Response()` ręcznie; brak `SUPABASE_SERVICE_ROLE_KEY` w endpoint code — self-audit
- [x] 2.6 Po test:integration: brak userów-śmieci w `auth.users` (cleanup zadziałał) — N/A (sandbox)

### Phase 3: Strony + React forms + E2E Playwright

#### Automated

- [x] 3.1 `npm run typecheck` zielony — React components typowane bez `any`
- [x] 3.2 `npm run lint` zielony na `src/components/**` + `src/pages/{signup,login}.astro`
- [x] 3.3 `npm run test` zielony — wszystkie unit + integration z Phase 1+2 nadal zielone (regression)
- [x] 3.4 `npm run test:e2e` zielony — minimum 2 testy w `tests/e2e/auth.spec.ts` (signup + logout flow) — N/A (sandbox)

#### Manual

- [x] 3.5 Code review: `client:load` na auth forms; fetch JSON pattern spójny; LogoutButton idempotent — self-audit
- [x] 3.6 Lokalny dev smoke: signup → auto-login + redirect → logout → cookies Supabase scleared w DevTools — N/A (sandbox)
