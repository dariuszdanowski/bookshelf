# S-01: Rejestracja, logowanie i wylogowanie email+hasło — Plan Brief

> Full plan: `context/changes/email-password-auth/plan.md`

## What & Why

Pierwszy user-facing slice (S-01). Implementuje email+hasło auth flow: trigger SQL handle_new_user (po signup tworzy profile + półkę „Zakupione" — FR-008), 3 endpointy `/api/auth/{signup,login,logout}` konsumujące F-02 substrate, 2 strony Astro z React islands (pierwsze realne islands w projekcie), E2E Playwright (pierwszy E2E test). Po S-01 użytkownik może założyć konto, zalogować się, wylogować; niezalogowany na chronionej ścieżce jest redirectowany na `/login` (F-02 middleware już to wymusza); widzi wyłącznie swoje dane (F-01 RLS już to wymusza).

## Starting Point

F-01 + F-02 zarchiwizowane: RLS-respecting Supabase clients gotowe, response envelope + middleware auth-guard działa, `App.Locals.{user, supabase}` typowane. Tabele `profiles` + `shelves` istnieją (migracje 0001+0002) ale **brak trigger'a** `handle_new_user`. `src/pages/api/` i `src/components/` puste — S-01 wprowadza pierwsze endpointy i pierwsze React islands. Layout to prosty shell bez navbar.

## Desired End State

Użytkownik wchodzi na `/signup`, wypełnia email+hasło+display_name, klika submit → auto-login (sesja w cookies) → redirect na `/` → widzi swój email w nagłówku Layout + LogoutButton. Klik LogoutButton → sesja cleared → redirect na `/`. Niezalogowana próba wejścia na chronioną ścieżkę → 302 do `/login` (middleware F-02). Database: każdy signup tworzy automatycznie 1 row w `profiles` + 1 row w `shelves` z `name='Zakupione'` (FR-008). Auto-confirm w Supabase Dashboard (brak verification email).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Email confirmation flow | Auto-confirm (Dashboard toggle off) | Krzyżuje friction; PRD KPI Time-to-first-shelf ≤ 5 min wymaga szybkiego onboardingu; brak SMTP setup | Plan |
| Walidacja hasła | Supabase default (min 6) | PRD nie precyzuje; YAGNI; mniej kodu | Plan |
| Po signup | Auto-login + redirect | Auto-confirm zwraca session; mniej kroków per KPI | Plan |
| Display name | Extra field w signup form | User explicit wybór (override Recommended) | Plan |
| Form architecture | React island + fetch JSON | Pierwsza realna React island ustanawia pattern; spójne z F-02 JSON envelope | Plan |
| Logout HTTP method | POST | REST best practice; CSRF defense przez Same-Site cookies | Plan |
| Redirect po login | Stała `/` (post-MVP zmienia) | `/library` z S-06 jeszcze nie istnieje; YAGNI deep-link | Plan |
| Trigger error handling | Rollback (default Postgres) | Atomic semantics; spójne z PRD guardrail „brak utraty danych" | Plan |
| Testing strategy | Full pyramid (unit + integration + E2E smoke) | DoD M3 wymaga Playwright; trigger test ma unique value; E2E ustanawia pattern dla S-02+ | Plan |

## Scope

**In scope:** migracja 0003 (trigger handle_new_user SECURITY DEFINER + function); `src/lib/auth/schema.ts` (Zod SignupSchema + LoginSchema); 3 endpointy POST w `src/pages/api/auth/`; SignupForm + LoginForm + LogoutButton (React islands z `client:load`); strony `/signup` + `/login`; edit Layout dodający user email + LogoutButton conditional; unit testy schema + endpointów; integration test trigger; E2E Playwright (signup + logout flow).

**Out of scope:** OAuth/SSO (FR-002 post-MVP), password reset, email verification flow, rate limiting na auth, `?next=` deep-link, edycja profile po signup, `/api/auth/me` endpoint, explicit CSRF tokens, Layout navbar z linkami do nieistniejących stron, multi-tab session sync.

## Architecture / Approach

Trzy fazy w kolejności zależności: (1) backend substrate (migracja trigger + Zod schemas — fundament dla endpointów), (2) endpointy auth + integration test (konsumują schema + trigger end-to-end), (3) frontend + E2E (konsumują endpointy). Każda faza ma własną bramkę automatyczną (typecheck/lint/test + dla Phase 1 migration list, dla Phase 3 E2E green). Endpointy używają `Astro.locals.supabase` z F-02 middleware (request-scoped client); error handling przez F-02 `apiError` z `Cache-Control: private, no-store`. React islands `client:load` fetch JSON do endpointów (spójne z envelope contract z F-02).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration 0003 + Zod schemas | Trigger handle_new_user + SignupSchema/LoginSchema + 10+ unit tests | Trigger broken w prod → każdy signup pada (mitigated: rollback per Q8 + integration test wcześnie wyłapie) |
| 2. Endpoints + integration test trigger | 3 endpointy POST + 12+ unit testów + integration test trigger | Mocking `auth.signUp`/`signInWithPassword` w teście może wymagać `vi.mock` finickyness (znany pattern z F-02) |
| 3. Strony + React forms + E2E | 3 React components + 2 strony + Layout edit + E2E smoke (2 testy) | Playwright wymaga `npx playwright install --with-deps` ~600 MB jednorazowo; Layout edit dotyka pliku użytego globalnie |

**Prerequisites:** F-01 zarchiwizowane (`0e28cc9`); F-02 zarchiwizowane (`aa25437`); migracje 0001+0002 applied; Supabase Dashboard Auth → "Confirm email" toggle **OFF** (manual setup, blokujące dla Q1/Q3 contract); Playwright browser binaries zainstalowane (manual: `npx playwright install --with-deps`).
**Estimated effort:** ~1-2 sesje, 3 fazy.

## Open Risks & Assumptions

- Zakładamy że Supabase Dashboard ma „Confirm email" toggle który operator faktycznie wyłączy przed Phase 1 manual gate (1.6). Bez tego signup nie zwraca session → auto-login (Q3) fail → E2E (Phase 3) fail.
- Zakładamy że `signUp` z `options.data = { display_name }` zapisuje do `auth.users.raw_user_meta_data` w sposób accessible dla trigger przez `NEW.raw_user_meta_data->>'display_name'` (standardowy Supabase pattern, ale niezweryfikowany w naszym konkretnym Supabase version).
- E2E z real Supabase: każdy run tworzy usera z unique email (timestamp); cleanup w `afterAll`. Risk: flaky network → orphan user. Mitigated przez `Promise.allSettled` cleanup pattern (F-01 phase 3 fix F1).
- `client:load` na auth forms: hydration cost akceptowalny bo te strony nie są perf-critical (PRD NFR p95 < 1s dotyczy nawigacji po katalogu, nie auth flow).

## Success Criteria (Summary)

- Nowy user może utworzyć konto i być zalogowany w < 30 s (auto-confirm + auto-login + 3 fields w form).
- Trigger gwarantuje że każdy auth.users INSERT skutkuje 1 profile + 1 shelf „Zakupione" (integration test).
- Niezalogowany na `/library` (lub innej protected) → 302 do `/login` (już działa przez F-02 middleware; weryfikowane E2E pośrednio przez redirect po logout).
- Logout button czyści session → po reload user nie ma dostępu do protected paths.
