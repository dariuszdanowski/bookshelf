# Panel Administracyjny — Implementation Plan

## Overview

Implementacja panelu admina dla BookShelf: lista użytkowników z przełącznikiem `ai_enabled`, impersonacja przez jednorazowy magic link oraz soft delete konta z anonimizacją. Panel dostępny wyłącznie dla userów z flagą `profiles.is_admin = true`.

## Current State Analysis

Kolumny `profiles.is_admin` i `profiles.ai_enabled` **już istnieją** (migration 0014). Brakuje:
- Service-role client (klucz istnieje w `Cloudflare.Env`, ale nigdzie nie użyty w kodzie)
- Guardów `ai_enabled` w endpointach vision/refine (AI_DISABLED jest w ApiErrorCode, ale nie podpięty)
- Strony `/admin` i `/api/admin/*` endpointów
- Conditional "Panel admina" linka w nawigacji

Następna migracja: **0023** (ostatnia istniejąca: 0022).

## Desired End State

Admin z `is_admin=true` widzi dodatkowy link "Panel admina" w headerze/UserMenu. Strona `/admin` prezentuje tabelę wszystkich użytkowników (email, display_name, flagi is_admin/ai_enabled, liczby książek/półek). Admin może togglować `ai_enabled` per user, impersonować użytkownika (jednorazowy magic link → redirect), oraz usunąć konto (soft delete: anonimizacja profilu + emaila w auth.users + zmiana hasła → blokada logowania, dane pozostają). Użytkownik z `ai_enabled=false` dostaje 403 `AI_DISABLED` przy próbie analizy zdjęcia — nawet z BYOK kluczem.

### Key Discoveries

- `src/lib/db/supabase.server.ts:33-68` — RLS-respecting client factory; service-role client musi być analogiczny lecz z `autoRefreshToken: false, persistSession: false`
- `src/lib/http/response.ts` — ApiErrorCode union; trzeba dodać `ADMIN_REQUIRED`
- `src/pages/api/photos/[id]/process.ts` — BYOK check (NO_API_KEY); ai_enabled check wchodzi tuż PRZED nim
- `src/pages/api/detections/[id]/refine.ts` — analogicznie do process
- `src/layouts/Layout.astro:14-27` — już fetchuje `profiles.display_name`; dodanie `is_admin` do tego samego selecta
- `src/components/UserMenu.tsx` — przyjmuje `displayName` + `email`; dodajemy prop `isAdmin`
- `supabase.auth.admin` API wymaga service-role key; `generateLink` + `getUserById` + `updateUserById` dostępne w @supabase/supabase-js v2
- Soft delete: zmiana emaila + hasła przez admin API blokuje login; session wygaśnie w ciągu max 1h (JWT expiry)

## What We're NOT Doing

- Zmiana schematu `profiles` poza `deleted_at` (Phase 2, item 0) — reszta kolumn już istnieje
- Dedykowane widoki historii lokalizacji dla przeniesionych danych (brak transferu — dane pozostają przy usuniętym userze)
- Przenoszenie ksiązek/półek do konta admina przy delete (roadmapa: soft delete z anonimizacją)
- Szyfrowanie klucza admina (service-role jest sekret Worker-side, nie trafia do klienta)
- Panel `/admin/[sub-pages]` — jedna strona `/admin` z sekcjami
- Impersonacja z powiadomieniem auditowym (poza zakresem MVP panelu)
- Paginacja listy userów (aplikacja małoskalowa; max 1000 przez auth.admin.listUsers)
- RLS policies dla admina — service-role client bypassuje RLS bez dodatkowych polityk

## Implementation Approach

**Architektura trójwarstwowa**:
1. **Guard** — `src/lib/admin/guard.ts`: helper `requireAdmin(locals)` → `Response | null`; używa RLS-respecting `locals.supabase` (może czytać tylko własny profil) → gwarantuje poprawną weryfikację is_admin
2. **Service-role client** — `src/lib/db/supabase.admin.ts`: `createAdminSupabaseClient(env)` z `autoRefreshToken: false`; używany wyłącznie po przejściu przez guard
3. **Admin endpoints** — `/api/admin/*`: każdy najpierw `requireAdmin`, dopiero potem tworzy adminClient

Nawigacja: `Layout.astro` rozszerza istniejący fetch profilu o `is_admin`; przekazuje prop do `UserMenu` i `MobileNav`. Strona `/admin` dodaje własny is_admin check dla podwójnej ochrony (pattern z `/shelves/[id].astro`).

## Critical Implementation Details

**ai_enabled vs BYOK — kolejność guard'ów** (process + refine): `ai_enabled = false` blokuje vision NIEZALEŻNIE od BYOK klucza. Kolejność: (1) auth check, (2) ai_enabled check → AI_DISABLED, (3) BYOK key check → NO_API_KEY. Admin z globalnym kluczem env też jest blokowany przez ai_enabled (is_admin nie pomija tej flagi — celowo: admin może wyłączyć własne AI).

**service-role client w CF Workers**: `import { env } from 'cloudflare:workers'` (module-level) + fallback `import.meta.env.SUPABASE_SERVICE_ROLE_KEY` dla dev/Vitest. Analogicznie do `supabase.server.ts` wzorca z lekcji.

**Soft delete — email w auth.users**: Supabase admin API `updateUserById` z `email_confirm: true` zmienia email bez wysyłania maila potwierdzającego. Zapis: `deleted-{userId}@bookshelf.deleted`. Istniejąca sesja wygasa naturalnie (max 1h JWT TTL) — akceptowalne dla admin use case.

**Impersonacja — env**: `generateLink` potrzebuje poprawnego `SITE_URL` w Supabase dashboard (redirect po kliknięciu magic linka). W dev: `http://localhost:4321`. W prod: Workers URL. Wymaga weryfikacji manualnej po deploy.

---

## Phase 1: Security Foundation

### Overview

Service-role client, guard helper, `ADMIN_REQUIRED` w ApiErrorCode, guard `ai_enabled` w endpointach vision, strona `/admin` z bramką auth, conditional "Panel admina" link w nawigacji.

### Changes Required

#### 1. Service-role client factory

**File**: `src/lib/db/supabase.admin.ts`

**Intent**: Nowy plik tworzący klienta Supabase z kluczem service-role (omija RLS). Nie wstrzyknąć do `App.Locals` — tworzony on-demand wyłącznie w admin endpointach po przejściu guardu.

**Contract**: Eksportuje `createAdminSupabaseClient(env: Cloudflare.Env): SupabaseClient<Database>`. Czyta `env?.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY` i `env?.PUBLIC_SUPABASE_URL ?? import.meta.env.PUBLIC_SUPABASE_URL`. Opcje: `auth: { autoRefreshToken: false, persistSession: false }`.

#### 2. Admin guard helper

**File**: `src/lib/admin/guard.ts`

**Intent**: Reusable helper dla API endpointów weryfikujący że wywołujący jest adminem. Zwraca `null` gdy OK, `Response` gdy błąd — endpointy mogą napisać `const g = await requireAdmin(locals); if (g) return g`.

**Contract**: `requireAdmin(locals: App.Locals): Promise<Response | null>`. Sprawdza `locals.user` (null → 401 UNAUTHENTICATED), następnie `locals.supabase.from('profiles').select('is_admin').eq('id', locals.user.id).single()` (is_admin !== true → 403 ADMIN_REQUIRED).

#### 3. ADMIN_REQUIRED w ApiErrorCode

**File**: `src/lib/http/response.ts`

**Intent**: Dodanie kodu błędu dla dostępu admin-only. Używany przez guard i admin endpointy.

**Contract**: Dodaj `'ADMIN_REQUIRED'` do unii `ApiErrorCode`. Brak innych zmian w pliku.

#### 4. Guard `ai_enabled` w process endpoint — ✓ ALREADY DONE, skip

**File**: `src/pages/api/photos/[id]/process.ts`

**Status**: Guard już istnieje w `process.ts:74-86` (komentarz "Guard: ai_enabled per profile (S-26)"). Implementer nie musi nic dodawać — weryfikacja przez checkpoint 1.6 (manual test ai_enabled=false → AI_DISABLED).

#### 5. Guard `ai_enabled` w refine endpoint — ✓ ALREADY DONE, skip

**File**: `src/pages/api/detections/[id]/refine.ts`

**Status**: Guard już istnieje w `refine.ts:97-107` (komentarz "Guard: ai_enabled per profile (parity z process.ts)"). Skip.

#### 6. Strona `/admin` — stub z bramką

**File**: `src/pages/admin.astro`

**Intent**: Nowa strona SSR widoczna tylko dla adminów. Middleware blokuje anonimów (nie w PUBLIC_EXACT); strona dodatkowo weryfikuje `is_admin`.

**Contract**: `export const prerender = false`. Po `Astro.locals.user!` check, fetch `profiles.select('is_admin').eq('id', user.id).single()`. Jeśli `!profile?.is_admin` → `return Astro.redirect('/')`. Renderuje `<Layout title="Panel administratora">` z placeholder `<p>Wkrótce: lista użytkowników.</p>` (zastąpiony w Phase 2).

#### 7. `Layout.astro` — dodanie `is_admin` do fetch profilu

**File**: `src/layouts/Layout.astro`

**Intent**: Rozszerzenie istniejącego fetch `profiles.display_name` o pole `is_admin`, aby Layout mógł przekazać flagę do UserMenu i MobileNav.

**Contract**: Zmień `.select('display_name')` → `.select('display_name, is_admin')`. Zapisz wynik w `const isAdmin = profile?.is_admin ?? false`. Przekaż `isAdmin` jako prop do `<UserMenu ... isAdmin={isAdmin} />` i `<MobileNav ... isAdmin={isAdmin} />`.

#### 8. `UserMenu.tsx` — conditional "Panel admina" link

**File**: `src/components/UserMenu.tsx`

**Intent**: Nowy props `isAdmin` — gdy `true`, pokaż link "Panel admina" w dropdown menu nad linkiem "Edytuj profil".

**Contract**: Dodaj prop `isAdmin: boolean` do type `Props`. Wstaw element `<a href="/admin">Panel admina</a>` z `data-testid="user-menu-admin"` warunkowo `{isAdmin && ...}`. Wzorzec stylistyczny identyczny jak istniejący link "Edytuj profil".

#### 9. `MobileNav.tsx` — conditional "Panel admina" link

**File**: `src/components/MobileNav.tsx`

**Intent**: Analogicznie do UserMenu — conditional link w nawigacji mobilnej.

**Contract**: Dodaj prop `isAdmin: boolean`. MobileNav renderuje linki przez statyczną `const LINKS = [...] as const` + `.map()` — do tej tablicy nie można wstrzyknąć warunkowego wpisu. Renderuj link `/admin` **poza pętlą `LINKS.map()`**, warunkowo po ostatnim elemencie `<ul>`, przed blokiem `email/LogoutButton`:
```tsx
{isAdmin && (
  <li>
    <a href="/admin" data-testid="mobile-nav-admin" ...>Panel admina</a>
  </li>
)}
```
Wzorzec stylistyczny (className, aria-current) identyczny jak w `.map()`.

### Success Criteria

#### Automated Verification

- Typecheck zielony: `npm run typecheck`
- Lint zielony: `npm run lint`
- Unit testy zielone: `npm run test` (w tym nowe testy guardu)

#### Manual Verification

- Zalogowany user bez `is_admin` wchodzi na `/admin` → redirect na `/`; nie widzi linku "Panel admina" w headerze
- Zalogowany user z `is_admin=true` widzi link "Panel admina" w UserMenu i MobileNav; może wejść na `/admin`
- Ustawienie `ai_enabled=false` na profilu testowym w Supabase Studio → próba analizy zdjęcia → UI pokazuje błąd (AI_DISABLED)

**Implementation Note**: Po Phase 1 i przejściu automated verification — pauza na manual confirmation przed Phase 2.

---

## Phase 2: User List + AI Toggle

### Overview

Endpoint GET `/api/admin/users` (lista userów przez admin API), PATCH `/api/admin/users/[id]/ai-enabled` (toggle), komponent `AdminUsersIsland.tsx` z tabelą i togglem.

### Changes Required

#### 0. Migracja 0023 — profiles.deleted_at (przeniesiona z Phase 3)

**File**: `supabase/migrations/0023_profiles_soft_delete.sql`

**Intent**: Przeniesiona z Phase 3 do Phase 2 — kolumna `deleted_at` musi istnieć w `database.types.ts` zanim powstanie typecheck Phase 2 (UserAdminDTO i AdminUsersIsland odwołują się do tego pola). Kolumna potrzebna też do wyświetlania soft-deleted rows w tabeli z badge "Usunięte".

**Contract**:
```sql
alter table public.profiles
  add column if not exists deleted_at timestamptz;

create index if not exists profiles_deleted_at_idx
  on public.profiles(deleted_at)
  where deleted_at is not null;
```

**Implementation note**: Przed pisaniem kodu Phase 2 uruchom lokalne `npx supabase db reset` (lub `supabase migration up`) + `npx supabase gen types typescript --local > src/lib/db/database.types.ts` (w WSL, na lokalnym stacku — **NIE `--linked`**: flaga linked generuje z prod, który nie ma 0023 przed merge) — inaczej typecheck Phase 2 padnie na nieznanej kolumnie.

#### 1. GET `/api/admin/users`

**File**: `src/pages/api/admin/users/index.ts`

**Intent**: Lista wszystkich użytkowników aplikacji dla panelu admina. Łączy dane z `auth.users` (email via admin API) z tabelą `profiles` (is_admin, ai_enabled, deleted_at) i licznikami (books, shelves).

**Contract**: `export const GET: APIRoute`. Po `requireAdmin(locals)` tworzy `adminClient = createAdminSupabaseClient(env)`. Wywołuje `adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })` → lista authUsers. Równolegle fetchuje profiles + book counts + shelf counts (service-role, `Promise.all`). Scala przez JS Map (key = user.id). Sortuje by `created_at` desc. Zwraca `apiResponse({ data: { users: UserAdminDTO[] } })`.

Typ `UserAdminDTO`:
```typescript
{
  id: string
  email: string
  display_name: string | null
  is_admin: boolean
  ai_enabled: boolean
  deleted_at: string | null
  created_at: string
  book_count: number
  shelf_count: number
}
```

Mappowanie błędów: authError → 500 INTERNAL_ERROR z console.error.

#### 2. PATCH `/api/admin/users/[id]/ai-enabled`

**File**: `src/pages/api/admin/users/[id]/ai-enabled.ts`

**Intent**: Toggle flagi `ai_enabled` na wskazanym profilu. Admin nie może modyfikować własnego konta przez ten endpoint (self-modification guard).

**Contract**: `export const PATCH: APIRoute`. `requireAdmin` → `parseUuidParam(params.id)` → self-modification check (`id === locals.user.id` → 400 VALIDATION_ERROR). Parse body: Zod `{ ai_enabled: z.boolean() }`. `adminClient.from('profiles').update({ ai_enabled }).eq('id', id).select('id, ai_enabled').single()`. Błędy: PGRST116 → 404, inne → 500. Sukces: `apiResponse({ data: { user: { id, ai_enabled } } })`.

#### 3. `AdminUsersIsland.tsx`

**File**: `src/components/AdminUsersIsland.tsx`

**Intent**: React island dla strony `/admin`. Tabela użytkowników z kolumnami: email, display_name, is_admin badge, ai_enabled toggle, liczniki. Optymistyczny toggle dla `ai_enabled`.

**Contract**: Komponent `client:load`, no props. Fetchuje `GET /api/admin/users` na mount. Kolumny tabeli: email (truncate), display_name, is_admin (badge "Admin" / brak), ai_enabled (toggle input type=checkbox), book_count, shelf_count, created_at (data). Toggle ai_enabled: PATCH `/api/admin/users/{id}/ai-enabled` + optimistic update stanu lokalnego. Soft-deleted users (deleted_at !== null): wiersze z badge "Usunięte" i opacity-50. Skeleton podczas ładowania (reuse istniejącego `<Skeleton />`). Error state przy fetch failure.

**Phase 2 only**: Brak przycisków impersonate/delete — te zostaną dodane w Phase 3.

#### 4. Aktualizacja `/admin.astro`

**File**: `src/pages/admin.astro`

**Intent**: Zastąpienie placeholdera z Phase 1 pełnym AdminUsersIsland.

**Contract**: Importuj i dodaj `<AdminUsersIsland client:load />` zamiast placeholdera. Reszta strony (guard, layout, h1) bez zmian.

### Success Criteria

#### Automated Verification

- Migracja 0023 stosuje się czysto lokalnie (supabase db reset + gen types)
- Typecheck zielony: `npm run typecheck`
- Lint zielony: `npm run lint`
- Testy zielone (unit + e2e): `npm run test && npm run test:e2e` — w tym `admin.spec.ts` (dostęp, lista, toggle)

#### Manual Verification

- Admin widzi listę wszystkich userów na `/admin` — email, flagi, liczniki
- Toggle `ai_enabled` na userze — zmiana widoczna od razu (optimistic), trwała po refresh
- Soft-deleted usery (z Phase 3 lub manualnie ustawiony deleted_at w Studio) wyświetlają się z badge i opacity

**Implementation Note**: Po Phase 2 — pauza na manual confirmation przed Phase 3.

---

## Phase 3: Impersonation + Soft Delete

### Overview

Endpoint impersonacji (magic link), endpoint soft delete (anonimizacja + zmiana hasła), rozszerzenie AdminUsersIsland o przyciski + ConfirmDialog. (Migracja 0023 przeniesiona do Phase 2 jako item 0 — Phase 3 bez migracji.)

### Changes Required

#### 1. POST `/api/admin/users/[id]/impersonate`

**File**: `src/pages/api/admin/users/[id]/impersonate.ts`

**Intent**: Generuje jednorazowy magic link dla wskazanego użytkownika. Admin kliknie link i zostanie zalogowany jako ten użytkownik (redirect w tej samej karcie — magic link podmienia sesję w całej przeglądarce przez wspólny cookie jar, więc nowa karta i tak nie zachowałaby sesji admina; powrót do panelu = ponowne zalogowanie, akceptowane w MVP).

**Contract**: `export const POST: APIRoute`. `requireAdmin` → `parseUuidParam` → self-impersonation check (→ 400). `adminClient.auth.admin.getUserById(id)` → pobiera email. Sprawdź `profiles.select('deleted_at, is_admin')`: soft-deleted → 400 VALIDATION_ERROR "Konto zostało usunięte."; `is_admin === true` → 400 VALIDATION_ERROR "Nie można impersonować administratora." (UI ukrywa przycisk, server enforce'uje — defense-in-depth). `adminClient.auth.admin.generateLink({ type: 'magiclink', email: targetUser.email })` → pobiera `data.properties.action_link`. Błąd generateLink → 500 z console.error. Sukces: `apiResponse({ data: { action_link } })`.

#### 2. POST `/api/admin/users/[id]/delete`

**File**: `src/pages/api/admin/users/[id]/delete.ts`

**Intent**: Soft delete konta: anonimizacja profilu + emaila w auth.users + zmiana hasła na random → blokada logowania. Dane (books, shelves, photos) pozostają.

**Contract**: `export const POST: APIRoute`. `requireAdmin` → `parseUuidParam` → self-delete check (→ 400). Sprawdź `profiles.select('deleted_at, is_admin')`: już usunięty (deleted_at !== null) → 400 "Konto już zostało usunięte."; `is_admin === true` → 400 VALIDATION_ERROR "Nie można usunąć konta administratora." (UI ukrywa przycisk, server enforce'uje — defense-in-depth).

Krok 1 (DB): `adminClient.from('profiles').update({ deleted_at: new Date().toISOString(), display_name: 'Użytkownik usunięty' }).eq('id', id)` → error → 500.

Krok 2 (Auth, best-effort): `adminClient.auth.admin.updateUserById(id, { email: \`deleted-${id}@bookshelf.deleted\`, password: crypto.randomUUID(), email_confirm: true })` → error → log tylko (nie zwracaj 500 — profil już zanonimizowany).

Sukces: `apiResponse({ data: { deleted: true } })`.

#### 3. Rozszerzenie `AdminUsersIsland.tsx` o przyciski Phase 3

**File**: `src/components/AdminUsersIsland.tsx`

**Intent**: Dodanie do każdego wiersza tabeli przycisków "Impersonuj" i "Usuń konto" z potwierdzającym ConfirmDialog. Obie akcje chronione: brak dla is_admin users i dla soft-deleted rows.

**Contract**: Import `ConfirmDialog` (istniejący komponent). Stan: `confirmDelete: string | null` (userId) i `loadingImpersonate: string | null`. Przycisk "Impersonuj": widoczny dla aktywnych (deleted_at === null) i nie-adminów; `onClick` → POST `/api/admin/users/{id}/impersonate` → redirect `window.location.href = action_link`. Przycisk "Usuń konto": widoczny dla aktywnych i nie-adminów; `onClick` → otwiera ConfirmDialog z emailem użytkownika → po confirm → POST `/api/admin/users/{id}/delete` → reload listy. Obie akcje wyłączone gdy `id === własny user_id` (brak tych przycisków dla własnego wiersza).

#### 4. Testy E2E Phase 3

**File**: `tests/e2e/admin.spec.ts`

**Intent**: Rozszerzenie istniejących testów o weryfikację soft delete (user nie może się zalogować po delete — sprawdzamy przez zmianę stanu tabeli).

**Contract**: Test soft delete: admin klika "Usuń konto" na testowym userze → potwierdza dialog → user znika z aktywnych (badge "Usunięte"). Weryfikacja przez ponowny GET /api/admin/users. Impersonacja: weryfikacja tylko że POST zwraca action_link (nie redirect — trudne w E2E).

### Success Criteria

#### Automated Verification

- Typecheck zielony: `npm run typecheck`
- Lint zielony: `npm run lint`
- Unit i E2E testy zielone: `npm run test && npm run test:e2e`

#### Manual Verification

- Admin klika "Impersonuj" na testowym userze → przeglądarka otwiera magic link → zalogowanie jako ten user
- Admin klika "Usuń konto" → dialog → potwierdza → user pojawia się jako "Usunięte" z opacity; próba logowania tym emailem → fail (email zmieniony)
- Soft-deleted user nadal widoczny w adminpanelu z datą usunięcia i badge "Usunięte"
- SITE_URL w Supabase Dashboard = workers prod URL (nie localhost); magic link po kliknięciu redirectuje na właściwą domenę prod

**Implementation Note**: Po Phase 3 i automated verification — pauza na manual confirmation przez usera (impersonacja + soft delete to operacje produkcyjne; weryfikacja manualna obowiązkowa).

---

## Testing Strategy

### Unit Tests

- `tests/unit/admin-guard.test.ts`: requireAdmin gdy `user=null` → 401; gdy `is_admin=false` → 403; gdy `is_admin=true` → null
- Wzorzec testowania: mock `locals.supabase` (podobnie jak istniejące testy endpointów)

### Integration Tests (E2E)

- `tests/e2e/admin.spec.ts`:
  - **Phase 1**: non-admin → redirect z `/admin`; brak linku "Panel admina" w UserMenu dla non-admin; admin widzi link i może wejść
  - **Phase 2**: admin widzi listę userów; toggle ai_enabled zmienia stan; optimistic update działa
  - **Phase 3**: soft delete zmienia wiersz na "Usunięte"
- **Provisioning fixture admina**: dedykowany setup step wg istniejącego wzorca `auth.teardown.ts` (`SUPABASE_SERVICE_ROLE_KEY` w env test-runnera — lokalnie z `.dev.vars`, w CI z efemerycznej Supabase): service-role client ustawia `is_admin=true` na userze shared session ORAZ tworzy drugiego usera-cel (admin API `createUser`) dla testów toggle/delete. Testy destrukcyjne (soft delete) operują wyłącznie na userze-celu, nigdy na shared session user.

### Manual Testing Steps

1. Ustaw `is_admin=true` na koncie testowym przez Supabase Studio (UPDATE profiles SET is_admin=true WHERE id='...')
2. Zaloguj się — sprawdź link "Panel admina" w headerze
3. Wejdź na `/admin` — sprawdź tabelę userów
4. Toggle `ai_enabled` na innym koncie — sprawdź w Studio że zmiana trwała
5. Próba analizy zdjęcia po `ai_enabled=false` — sprawdź błąd AI_DISABLED w UI
6. Impersonacja: kliknij "Impersonuj" → otwiera się magic link w przeglądarce
7. Soft delete: kliknij "Usuń konto" → potwierdź → sprawdź badge + blokadę logowania

## Migration Notes

- Phase 1: zero migracji (kolumny is_admin i ai_enabled istnieją od 0014)
- Phase 2 (item 0): migracja 0023 dodaje tylko `deleted_at` + indeks; ADD COLUMN na małej tabeli profiles jest instant. Phase 3 bez migracji
- Migracja idempotentna (`add column if not exists`) — bezpieczny retry przy `db push`
- Po merge → `supabase db push` automatycznie przez deploy.yml

## References

- Roadmapa: `context/foundation/roadmap.md` § S-26
- Response helpers: `src/lib/http/response.ts`
- Service-role key setup: CLAUDE.md § Cloudflare adapter — specyfika
- Istniejący client factory wzorzec: `src/lib/db/supabase.server.ts`
- Auth guard wzorzec w endpointach: `src/pages/api/account/profile.ts`
- Delete DB-first wzorzec: `src/pages/api/books/[id].ts`
- UserMenu: `src/components/UserMenu.tsx`
- MobileNav: `src/components/MobileNav.tsx`
- ConfirmDialog: `src/components/ConfirmDialog.tsx`
- Lessons: `context/foundation/lessons.md` § Branch per change, § Przed migracją sprawdź max numer

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Security Foundation

#### Automated

- [x] 1.1 Typecheck zielony: `npm run typecheck` — 8b92109
- [x] 1.2 Lint zielony: `npm run lint` — 8b92109
- [x] 1.3 Testy jednostkowe zielone: `npm run test` — 8b92109

#### Manual

- [x] 1.4 Non-admin na `/admin` → redirect; brak linku "Panel admina" — 8b92109
- [x] 1.5 Admin widzi link "Panel admina" w headerze, może wejść na `/admin` — 8b92109
- [x] 1.6 `ai_enabled=false` → AI_DISABLED przy analizie zdjęcia — 8b92109

### Phase 2: User List + AI Toggle

#### Automated

- [x] 2.0 Migracja 0023 stosuje się czysto lokalnie (supabase db reset + gen types) — 00dae4e
- [x] 2.1 Typecheck zielony: `npm run typecheck` — 00dae4e
- [x] 2.2 Lint zielony: `npm run lint` — 00dae4e
- [x] 2.3 Testy zielone (unit + e2e): `npm run test && npm run test:e2e` — 00dae4e

#### Manual

- [x] 2.4 Admin widzi listę userów z poprawnymi danymi — 00dae4e
- [x] 2.5 Toggle `ai_enabled` — trwała zmiana widoczna po refresh — 00dae4e
- [x] 2.6 Soft-deleted usery wyświetlają się z badge "Usunięte" i opacity — 00dae4e

### Phase 3: Impersonation + Soft Delete

#### Automated

- [x] 3.1 Typecheck zielony: `npm run typecheck`
- [x] 3.2 Lint zielony: `npm run lint`
- [x] 3.3 Testy zielone: `npm run test && npm run test:e2e`

#### Manual

- [x] 3.4 Impersonacja: magic link otwiera się, loguje jako inny user
- [x] 3.5 Soft delete: user oznaczony jako "Usunięte"; logowanie starym emailem → fail
- [ ] 3.6 SITE_URL w Supabase Dashboard = workers prod URL; magic link redirectuje na właściwą domenę (nie localhost)
- [x] 3.7 Soft-deleted user nadal widoczny w adminpanelu z datą usunięcia i badge "Usunięte"
