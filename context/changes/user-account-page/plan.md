# S-31 — Strona /account (profil użytkownika) Implementation Plan

## Overview

Zbudować stronę `/account` dającą użytkownikowi jeden ekran do zarządzania kontem:
edycja `display_name`, zmiana adresu email i hasła, podgląd zagregowanych kosztów
vision (z S-30), oraz placeholder sekcji kluczy API (którą wypełni S-32 BYOK).
Slice zapala UI nad plumbingiem, który w większości już istnieje — `GET /api/account/stats`
(S-30), tabela `profiles` z RLS `profiles_update_own`, wzorce strona+wyspa+middleware.

## Current State Analysis

Co już jest (zweryfikowane w kodzie):

- **`GET /api/account/stats`** — `src/pages/api/account/stats.ts:1-65`. Auth-guarded
  (401 gdy `!locals.user`). Zwraca envelope `{ data: { total_vision_cost_usd,
  total_refine_cost_usd, vision_run_count, refine_call_count } }` (wszystkie `number`).
  Ma unit test (`tests/unit/pages/api/account/stats.test.ts`). **Wisi bez konsumenta UI** —
  S-31 jest jego pierwszym konsumentem.
- **`profiles`** — `supabase/migrations/0001_initial_schema.sql:7-12` (+ 0014): kolumny
  `id` (PK→auth.users), `display_name text NULL`, `created_at`, `is_admin`, `ai_enabled`.
  RLS UPDATE-own: `profiles_update_own` w `0002_rls_policies.sql:9`
  (`using (id = auth.uid()) with check (id = auth.uid())`).
- **`/api/account/profile`** — **nie istnieje**. Do utworzenia (tylko `stats.ts` w
  `src/pages/api/account/`).
- **Kontrakt API** — `src/lib/http/response.ts`: `apiResponse({data})` / `apiError({code,status,message,details?})`;
  `ApiErrorCode` union zawiera m.in. `UNAUTHENTICATED | NOT_FOUND | VALIDATION_ERROR | INTERNAL_ERROR`.
  Wzorzec PATCH endpointu (walidacja Zod → `.update()` RLS-scoped → SQLSTATE mapping):
  `src/pages/api/shelves/[id].ts:19-113`.
- **Middleware** — `src/lib/middleware/handler.ts:39-45`: `PUBLIC_EXACT` + `PUBLIC_PREFIXES`;
  wszystko poza tym jest **default-protected**. `/account` będzie chronione automatycznie,
  bez konfiguracji.
- **Wzorzec strona+wyspa** — `src/pages/shelves.astro` (defense-in-depth redirect
  `if (!Astro.locals.user) return Astro.redirect('/login')` + `<Island client:load />`).
  Wyspa pobiera dane klient-side przez `fetch('/api/...')` (cookies sesji).
- **Browser Supabase** — `src/lib/db/supabase.browser.ts`: `createBrowserSupabaseClient()`
  (anon + sesja z cookies). Auth-mutacje przez `supabase.auth.updateUser({...})`.
- **Wzorzec formularzy** — `src/components/LoginForm.tsx:20-121`: stan
  `loading / formError / fieldErrors`, Zod walidacja, błędy per-pole z `data-testid`,
  przycisk `disabled={loading}`. Reużyć kształtu UX.
- **Nav** — `src/layouts/Layout.astro:47-84` (blok `{user && ...}`); link `/account`
  dorzucić przed `<ThemeToggle>`.
- **Zod dla profilu** — brak; utworzyć `src/lib/account/schema.ts`.

## Desired End State

Zalogowany użytkownik wchodzi na `/account` (link „Moje konto" w nagłówku) i widzi:
1. **Profil** — pole `display_name` z bieżącą wartością, zapis przez „Zapisz" (optymistyczny
   update, rollback przy błędzie).
2. **Email** — bieżący email + formularz zmiany; po zapisie baner „sprawdź skrzynkę i
   potwierdź zmianę".
3. **Hasło** — formularz „nowe hasło" + „powtórz hasło" (min 6); po zapisie komunikat sukcesu.
4. **Koszty vision** — blok z grand total USD + rozbiciem (vision / refine) + liczbami analiz.
5. **Klucze API** — sekcja-placeholder z opisem i CTA „Dodaj klucz" (disabled / informacja
   „wkrótce") — S-32 ją wypełni.

Weryfikacja: typecheck + lint + vitest zielone; e2e `account.spec.ts` przechodzi
(strona ładuje się, pokazuje statystyki, edycja display_name z mockowanym PATCH,
walidacja hasła klient-side, email/hasło mutacje mockowane przez `page.route` — bez
mutowania współdzielonego konta testowego).

### Key Discoveries:

- `GET /api/account/stats` gotowy — Phase 2 tylko go konsumuje (`src/pages/api/account/stats.ts:56-63`).
- RLS `profiles_update_own` pozwala bezpieczny `.from('profiles').update()` scoped do `auth.uid()`
  (`0002_rls_policies.sql:9`) — PATCH endpoint nie potrzebuje service-role.
- `/account` jest default-protected przez middleware — zero zmian w `PUBLIC_EXACT`
  (`src/lib/middleware/handler.ts:39-45`).
- `supabase.auth.updateUser({email})` wyzwala Supabase re-confirmation email — UX musi to
  zakomunikować (baner), inaczej user myśli że nic się nie stało.
- E2E nie może realnie zmienić emaila/hasła współdzielonego konta z `auth.setup.ts` — te
  mutacje mockować przez `page.route('**/auth/v1/user')` (wąsko — patrz F1) / przez mock własnego PATCH.
- **Email-change zależy od konfiguracji projektu Supabase** (F3 plan-review): baner „sprawdź
  skrzynkę" zakłada, że potwierdzanie zmiany emaila jest WŁĄCZONE. `auth.setup.ts:29` odnotowuje,
  że potwierdzanie przy signup jest WYŁĄCZONE na tym projekcie — jeśli zmiana emaila też jest bez
  potwierdzenia, `updateUser({email})` zmienia adres natychmiast i baner wprowadza w błąd.
  Manualna weryfikacja (user-only) musi potwierdzić faktyczny flow (natychmiast vs potwierdzenie)
  i dopasować treść banera.

## What We're NOT Doing

- **Faktyczne klucze BYOK** (tabela `user_api_keys`, szyfrowanie, add/test/delete) — to S-32.
  W S-31 tylko placeholder sekcji.
- **Toggle `ai_enabled`** użytkownika — to domena admina (S-26), nie self-service profilu.
- **Usunięcie konta** przez usera — poza scope (admin-side w S-26).
- **Avatar / zdjęcie profilowe**, display_name w `auth.users.raw_user_meta_data`
  (trzymamy się kolumny `profiles.display_name`).
- **Re-autentykacja (current-password)** przed zmianą hasła — session-based `updateUser`
  jej nie wymaga; pominięte świadomie na MVP.
- **Historia / miesięczne rozbicie kosztów** — blok pokazuje sumę zwracaną przez
  istniejący `/api/account/stats`, bez nowych agregatów.

## Implementation Approach

Trzy atomic fazy w kolejności zależności: backend → shell strony z danymi tylko-do-odczytu
i edycją display_name → mutacje credentiali. Każda faza kończy się commitem i własnym
zestawem automatów; Phase 2 i 3 dokładają e2e. display_name idzie przez typowany endpoint
(spójny envelope, mockowalny); email/hasło przez browser `supabase.auth.updateUser` (Supabase
zarządza re-confirmation + sesją).

## Phase 1: Profile schema + PATCH /api/account/profile

### Overview

Backend dla edycji `display_name`: Zod schema + endpoint PATCH konsumujący RLS-scoped
`.from('profiles').update()`, z F-02 envelope i SQLSTATE mappingiem wzorowanym na
`shelves/[id].ts`.

### Changes Required:

#### 1. Account Zod schema

**File**: `src/lib/account/schema.ts` (nowy)

**Intent**: Zdefiniować walidację i typ dla update'u profilu. Single source of truth dla
kształtu body PATCH i dla klient-side pre-walidacji w wyspie.

**Contract**: `UpdateProfileSchema = z.object({ display_name: z.string().trim().min(1).max(100) })`
(spójne z `SignupSchema.display_name` w `src/lib/auth/schema.ts`). Eksport
`type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>`.

#### 2. PATCH endpoint

**File**: `src/pages/api/account/profile.ts` (nowy)

**Intent**: Zaktualizować `profiles.display_name` zalogowanego usera i zwrócić nowy stan w
F-02 envelope. RLS scopuje update do `auth.uid()` — brak ręcznego `.eq('id', user.id)` nie
jest luką, ale dodajemy go explicite dla czytelności i parytetu z `single()`.

**Contract**: `export const prerender = false`. `PATCH` handler: 401 gdy `!locals.user`;
parse JSON (400 `VALIDATION_ERROR` przy złym JSON); `UpdateProfileSchema.safeParse`
(400 `VALIDATION_ERROR` + `details: z.flattenError(...)`); `locals.supabase.from('profiles')
.update({ display_name }).eq('id', locals.user.id).select('id, display_name').single()`.
Mapping błędów jak w `shelves/[id].ts:64-99`: `PGRST116` → 404, inne → 500 `INTERNAL_ERROR`
+ `console.error` z `{name, message, code}`. Sukces: `apiResponse({ data: { profile:
{ id, display_name } } })`.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Unit testy endpointu przechodzą: `npm run test`
- Nowy plik testowy `tests/unit/pages/api/account/profile.test.ts` pokrywa: 200 + zaktualizowany
  `display_name`; 401 gdy `user=null`; 400 gdy display_name pusty/za długi (Zod); 400 przy złym
  JSON; 500 gdy update zwraca nieoczekiwany błąd DB (envelope `{error:{code}}`)

#### Manual Verification:

- (brak — faza czysto backendowa, pokryta automatami)

**Implementation Note**: Faza bez kroku manualnego — po zielonych automatach commit i przejście
do Phase 2.

---

## Phase 2: Strona /account + statystyki + edycja display_name + nav

### Overview

Shell strony i wyspa: defense-in-depth Astro page, `AccountIsland` pobierający statystyki i
profil, edytowalne `display_name` (PATCH z Phase 1, optymistycznie), blok kosztów vision,
placeholder sekcji kluczy API, link w nawigacji.

### Changes Required:

#### 1. Astro page

**File**: `src/pages/account.astro` (nowy)

**Intent**: Chroniona strona renderująca `Layout` + wyspę konta. Przekazuje początkowy
`display_name` i `email` z SSR (z `Astro.locals.user` + odczyt `profiles`), żeby uniknąć
migotania pustych pól przy hydratacji.

**Contract**: Frontmatter: defense-in-depth `if (!Astro.locals.user) return Astro.redirect('/login')`;
SSR `Astro.locals.supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()`.
Render `<AccountIsland client:load initialDisplayName={...} email={user.email} />` wewnątrz `Layout`.

#### 2. Account island

**File**: `src/components/AccountIsland.tsx` (nowy)

**Intent**: Interaktywny kontener konta. Renderuje sekcje: Profil (edycja display_name),
Email, Hasło, Koszty, Klucze (placeholder). W tej fazie **aktywna** jest edycja display_name
+ blok kosztów + placeholder kluczy. Sekcje Email i Hasło w Phase 2 to **wyłącznie szkielet
prezentacyjny** (nagłówek + layout sekcji, bez formularzy/handlerów) — formularze i logikę
`updateUser` dokłada Phase 3. (F2 plan-review: jednoznaczny zakres, bez „read-only/disabled".)

**Contract**: Props `{ initialDisplayName: string | null; email: string }`. Stan formularza
display_name wg wzorca `LoginForm.tsx:21-25` (`loading/formError/fieldErrors`). Zapis: klient
pre-waliduje `UpdateProfileSchema`, optymistycznie ustawia nową wartość, `fetch('/api/account/profile',
{method:'PATCH', body})`; przy błędzie envelope rollback do poprzedniej wartości + pokazanie
`error.message` / `fieldErrors`. `data-testid` na polach/przyciskach/komunikatach (parytet z
LoginForm) dla e2e.

#### 3. Statystyki kosztów (blok lub podkomponent)

**File**: `src/components/AccountIsland.tsx` (część wyspy; opcjonalnie wydzielony `AccountStats.tsx`)

**Intent**: Po zamontowaniu pobrać `GET /api/account/stats` i pokazać grand total USD
(`total_vision_cost_usd + total_refine_cost_usd`) prominentnie, z rozbiciem na vision/refine i
liczbami `vision_run_count` / `refine_call_count`. Stan ładowania przez istniejący `<Skeleton />`.

**Contract**: `fetch('/api/account/stats')` → envelope `{ data: { total_vision_cost_usd,
total_refine_cost_usd, vision_run_count, refine_call_count } }`. Formatowanie waluty (USD,
≥4 miejsca dla małych kwot — koszty bywają rzędu $0.00x). Błąd fetch → komunikat „nie udało
się pobrać statystyk", nie crash.

#### 4. Placeholder sekcji kluczy API

**File**: `src/components/AccountIsland.tsx` (część wyspy)

**Intent**: Statyczna sekcja zapowiadająca BYOK: nagłówek „Klucze API", krótki opis i CTA
„Dodaj klucz" (disabled lub z informacją „wkrótce"). Bez logiki — S-32 ją zastąpi.

**Contract**: Czysto prezentacyjny blok z `data-testid="account-keys-placeholder"`.

#### 5. Link nawigacji

**File**: `src/layouts/Layout.astro`

**Intent**: Dodać link „Moje konto" → `/account` w nagłówku auth-only, przed `<ThemeToggle>`.

**Contract**: `<a href="/account" data-testid="nav-account">Moje konto</a>` w bloku `{user && ...}`
(`Layout.astro:47-84`), stylistyka spójna z istniejącymi linkami nav.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Unit testy przechodzą: `npm run test`
- Test komponentu `tests/unit/components/AccountIsland.test.tsx` pokrywa: render z initial
  display_name; udany zapis display_name (mock `fetch` PATCH → 200); rollback przy błędzie
  (mock PATCH → 400/500); render bloku statystyk z mock `/api/account/stats`
- E2E `tests/e2e/account.spec.ts` (część „read + display_name"): zalogowany user otwiera
  `/account` z nawigacji, widzi blok statystyk, edytuje display_name (PATCH mockowany przez
  `page.route` → 200), widzi potwierdzenie; asercje przez `getByRole`/`getByTestId`, bez CSS
- `npm run build` przechodzi

#### Manual Verification:

- `/account` renderuje się poprawnie w przeglądarce, blok kosztów pokazuje realne wartości z konta
- Edycja display_name zapisuje się i utrzymuje po reloadzie strony
- Link „Moje konto" widoczny w nagłówku po zalogowaniu, prowadzi na `/account`
- Layout sekcji czytelny (Profil / Email / Hasło / Koszty / Klucze)

**Implementation Note**: Po zielonych automatach **pauza na manualną weryfikację użytkownika**
(przeglądarka — render, realne koszty, persystencja display_name) przed Phase 3.

---

## Phase 3: Zmiana emaila i hasła (Supabase Auth)

### Overview

Aktywować formularze email i hasła w `AccountIsland` przez browser
`supabase.auth.updateUser`, z obsługą re-confirmation (email) i walidacją powtórzenia (hasło).

### Changes Required:

#### 1. Formularz zmiany emaila

**File**: `src/components/AccountIsland.tsx`

**Intent**: Pozwolić zmienić email. Po `updateUser({email})` Supabase wysyła mail potwierdzający
na nowy adres — UX musi pokazać baner „sprawdź skrzynkę i potwierdź zmianę", bo zmiana nie jest
natychmiastowa.

**Contract**: Pole email (pre-walidacja `z.email()`), przycisk „Zmień email". Handler:
`createBrowserSupabaseClient().auth.updateUser({ email })`; sukces → baner info
(`data-testid="account-email-pending"`); błąd Supabase → `formError` z `error.message`.
`loading`/`disabled` wg wzorca LoginForm.

#### 2. Formularz zmiany hasła

**File**: `src/components/AccountIsland.tsx`

**Intent**: Pozwolić ustawić nowe hasło z polem powtórzenia, by uniknąć literówek. Bez
current-password (session-based updateUser tego nie wymaga).

**Contract**: Pola „nowe hasło" + „powtórz hasło"; klient-side: min 6 (parytet `SignupSchema`)
+ równość pól (inaczej `fieldError`). Handler: `auth.updateUser({ password })`; sukces →
komunikat `data-testid="account-password-success"` + czyszczenie pól; błąd → `formError`.

#### 3. Walidacja hasła w schemacie (opcjonalnie współdzielona)

**File**: `src/lib/account/schema.ts`

**Intent**: Dodać `ChangePasswordSchema` dla spójnej walidacji powtórzenia hasła klient-side.

**Contract**: `ChangePasswordSchema = z.object({ password: z.string().min(6), confirm:
z.string() }).refine(d => d.password === d.confirm, { path:['confirm'], message:'Hasła nie są
zgodne' })`. (Email walidowany inline `z.email()` — bez nowego schematu, chyba że wygodniej dorzucić.)

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Unit testy przechodzą: `npm run test`
- `tests/unit/components/AccountIsland.test.tsx` rozszerzony: walidacja niezgodnych haseł
  (błąd, brak wywołania `updateUser`); udana zmiana hasła (mock `updateUser` → `{error:null}`)
  czyści pola + pokazuje sukces; zmiana emaila (mock `updateUser`) → baner pending; błąd
  `updateUser` → `formError`. Mock browser klienta wg wzorca `PhotoUploader.test.tsx`
  (`vi.hoisted` + `vi.mock('.../supabase.browser')`)
- E2E `tests/e2e/account.spec.ts` (część „credentials"): walidacja niezgodnych haseł pokazuje
  błąd klient-side bez network; zmiana emaila/hasła z **mockiem** `page.route('**/auth/v1/user')`
  (nie mutuje współdzielonego konta) → odpowiednio baner pending / komunikat sukcesu.
  **Uwaga (F1 plan-review):** mock celuje WYŁĄCZNIE w `**/auth/v1/user` (endpoint `updateUser`),
  NIE w szeroki `**/auth/v1/**` — szeroki glob przechwyciłby też odświeżanie tokenu
  (`/auth/v1/token`) współdzielonej sesji storageState (`auth.setup.ts:34`) i rozwaliłby
  uwierzytelniony kontekst → flaky.

#### Manual Verification:

- Zmiana hasła na realnym koncie działa (wyloguj/zaloguj nowym hasłem) — **user-only**
- Zmiana emaila wyzwala mail potwierdzający, baner „sprawdź skrzynkę" się pokazuje — **user-only**
- Niezgodne hasła pokazują czytelny błąd bez wysyłki

**Implementation Note**: Po zielonych automatach **pauza na manualną weryfikację użytkownika**
(realna zmiana hasła + flow potwierdzenia emaila — nieautomatyzowalne, user-only) przed archiwizacją.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/pages/api/account/profile.test.ts` — PATCH: sukces, 401, 400 (Zod: pusty/za długi),
  400 (zły JSON), 500 (DB error → envelope). Wzorzec: `tests/unit/pages/api/shelves/index.test.ts`
  (mock `from()` chainowy, `makeContext` z `locals.user/supabase`).
- `tests/unit/components/AccountIsland.test.tsx` — display_name save/rollback, render statystyk
  (mock fetch), walidacja + zmiana hasła i emaila (mock browser supabase auth wg `PhotoUploader.test.tsx`).

### Integration Tests:

- Brak osobnych — RLS update-own pokryty przez endpoint unit + e2e na realnej (efemerycznej)
  Supabase w CI job `e2e`.

### Manual Testing Steps (user-only):

1. Zaloguj się, kliknij „Moje konto" w nagłówku → `/account` renderuje wszystkie sekcje.
2. Blok kosztów pokazuje realne sumy (porównaj z liczbą analiz).
3. Zmień display_name → zapis trzyma się po reloadzie.
4. Zmień hasło → wyloguj → zaloguj nowym hasłem.
5. Zmień email → pojawia się baner „sprawdź skrzynkę"; mail potwierdzający dociera.

## Performance Considerations

Brak istotnych — strona pobiera jeden lekki endpoint statystyk + jeden update. `Cache-Control:
private, no-store` z F-02 defaults chroni JWT-scoped content przed edge cache.

## Migration Notes

Brak migracji DB — `profiles.display_name` i RLS `profiles_update_own` już istnieją.

## References

- Wzorzec PATCH endpointu: `src/pages/api/shelves/[id].ts:19-113`
- Istniejący stats endpoint (konsumowany): `src/pages/api/account/stats.ts:1-65`
- Wzorzec formularza: `src/components/LoginForm.tsx:20-121`
- Strona+wyspa: `src/pages/shelves.astro`; nav: `src/layouts/Layout.astro:47-84`
- Browser auth: `src/lib/db/supabase.browser.ts`; mock w teście: `tests/unit/components/PhotoUploader.test.tsx:4-12`
- E2E auth/storageState: `tests/e2e/auth.setup.ts`, `playwright.config.ts`
- RLS policy: `supabase/migrations/0002_rls_policies.sql:9`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Profile schema + PATCH /api/account/profile

#### Automated

- [x] 1.1 Typecheck przechodzi: `npm run typecheck`
- [x] 1.2 Lint przechodzi: `npm run lint`
- [x] 1.3 Unit testy przechodzą: `npm run test`
- [x] 1.4 `tests/unit/pages/api/account/profile.test.ts` pokrywa 200/401/400-Zod/400-JSON/500

### Phase 2: Strona /account + statystyki + display_name + nav

#### Automated

- [ ] 2.1 Typecheck przechodzi: `npm run typecheck`
- [ ] 2.2 Lint przechodzi: `npm run lint`
- [ ] 2.3 Unit testy przechodzą: `npm run test`
- [ ] 2.4 `tests/unit/components/AccountIsland.test.tsx` pokrywa display_name save/rollback + render statystyk
- [ ] 2.5 E2E `tests/e2e/account.spec.ts` (read + display_name) przechodzi
- [ ] 2.6 `npm run build` przechodzi

#### Manual

- [ ] 2.7 `/account` renderuje sekcje; blok kosztów pokazuje realne wartości
- [ ] 2.8 Edycja display_name utrzymuje się po reloadzie
- [ ] 2.9 Link „Moje konto" widoczny w nagłówku, prowadzi na `/account`

### Phase 3: Zmiana emaila i hasła (Supabase Auth)

#### Automated

- [ ] 3.1 Typecheck przechodzi: `npm run typecheck`
- [ ] 3.2 Lint przechodzi: `npm run lint`
- [ ] 3.3 Unit testy przechodzą: `npm run test`
- [ ] 3.4 `AccountIsland.test.tsx` rozszerzony: walidacja haseł + zmiana hasła/emaila (mock updateUser)
- [ ] 3.5 E2E `account.spec.ts` (credentials, mock `**/auth/v1/**`) przechodzi

#### Manual

- [ ] 3.6 Realna zmiana hasła działa (wyloguj/zaloguj) — user-only
- [ ] 3.7 Zmiana emaila wyzwala baner + mail potwierdzający — user-only
- [ ] 3.8 Niezgodne hasła → czytelny błąd bez wysyłki
