# S-47: Admin — flaga is_technical w DB — Plan Implementacji

## Overview

Dodajemy kolumnę `profiles.is_technical BOOLEAN NOT NULL DEFAULT false` i przenosimy klasyfikację kont technicznych (e2e, testy, debug) z heurystyki w kodzie frontendu do sygnału DB-level, którym zarządza admin przez toggle w panelu. Usuwamy `TECHNICAL_EMAIL_PREFIXES` i fallback `book_count===0 && !display_name` z `isAutomatic()`.

## Current State Analysis

- `AdminUsersIsland.tsx:19-33` — `TECHNICAL_EMAIL_PREFIXES` + `isAutomatic()` z dwoma kryteriami: prefiks emaila i `book_count===0 && !display_name`
- `UserAdminDTO` (`users/index.ts:9-19`) — brak pola `is_technical`
- `GET /api/admin/users` (`users/index.ts:54`) — profiles select bez `is_technical`
- `PATCH /api/admin/users/[id]/ai-enabled` — gotowy wzorzec do skopiowania dla nowego endpointu
- Ostatnia migracja: `0024_grant_public_roles.sql` → nowa będzie `0025_profiles_is_technical.sql`
- Backfill: tylko konta z prefiksami emaila (`e2e-`, `ux-verify-`, `debug-vision-`, `rls-test-`, `auth-trigger-`); fallback `book_count===0` celowo NIE backfillowany (real user po rejestracji bez książek)
- `tests/e2e/admin.spec.ts` — 376 linii, wzorce istniejących testów

## Desired End State

- `profiles.is_technical` istnieje w DB; istniejące konta testowe mają `is_technical = true` po migracji
- Admin może togglować flagę dla dowolnego użytkownika przez nową kolumnę „Tech" w tabeli (jak AI)
- `isAutomatic()` zwraca wyłącznie `user.is_technical` — zero heurystyki
- Filtr „Ukryj konta automatyczne" działa na podstawie flagi DB
- Testy E2E pokrywają toggle + filtrowanie

### Key Discoveries

- `ai-enabled.ts` jest identycznym wzorcem dla nowego endpointu `technical.ts` — kopiuj strukturę 1:1
- Backfill w migracji wymaga JOIN z `auth.users` (email jest w auth, nie w profiles) — Postgres pozwala to w migration file bo ma dostęp do schematu `auth`
- `isActionable` w wierszu (`!isOwn && !user.is_admin && !user.deleted_at`) dotyczy przycisków Impersonuj/Usuń; toggle Tech ma być we wszystkich wierszach jak AI — nie używać `isActionable` dla warunku disable

## What We're NOT Doing

- Nie backfillujemy kont z `book_count===0 && !display_name` — to mógłby być real user po rejestracji
- Nie usuwamy heurystyki email-prefix jako opcji *manualnego* oznaczania przez admina — konta e2e będą miały `is_technical=true` po backfill, nie potrzeba heurystyki
- Nie dodajemy RLS na `is_technical` (admin panel używa service-role clienta, który omija RLS)
- Nie dodajemy endpointu do auto-ustawiania `is_technical` przy rejestracji na podstawie emaila — admin ustawia ręcznie

## Implementation Approach

Dwie atomowe fazy:
1. **Migracja + backend** — kolumna DB + backfill + extend DTO + nowy endpoint
2. **Frontend + testy** — uproszczony `isAutomatic()` + kolumna Tech z togglem + E2E

---

## Phase 1: Migracja DB + backend (endpoint + DTO)

### Overview

Tworzy kolumnę `is_technical` w DB z backfillem, rozszerza DTO i dodaje endpoint PATCH do togglowania.

### Changes Required

#### 1. Migracja DB

**File**: `supabase/migrations/0025_profiles_is_technical.sql`

**Intent**: Dodaje `is_technical BOOLEAN NOT NULL DEFAULT false` do profiles, tworzy partial index na `WHERE is_technical`, backfilluje istniejące konta e2e-testowe na podstawie emaila z `auth.users`.

**Contract**:
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_technical boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_technical_idx
  ON public.profiles (id) WHERE is_technical;

-- Backfill kont testowych na podstawie prefiksów emaila
UPDATE public.profiles p
SET is_technical = true
FROM auth.users u
WHERE p.id = u.id
  AND (
    u.email ILIKE 'e2e-%'
    OR u.email ILIKE 'ux-verify-%'
    OR u.email ILIKE 'debug-vision-%'
    OR u.email ILIKE 'rls-test-%'
    OR u.email ILIKE 'auth-trigger-%'
  );
```

#### 2. Rozszerzenie UserAdminDTO i GET endpoint

**File**: `src/pages/api/admin/users/index.ts`

**Intent**: Dodaje `is_technical: boolean` do `UserAdminDTO`, includuje pole w profiles SELECT i mapuje do DTO.

**Contract**:
- `UserAdminDTO` zyskuje nowe pole `is_technical: boolean`
- `profilesResult` select: `'id, display_name, is_admin, ai_enabled, is_technical, deleted_at, created_at'`
- W mapowaniu: `is_technical: profile?.is_technical ?? false`

#### 3. Nowy endpoint PATCH /api/admin/users/[id]/technical

**File**: `src/pages/api/admin/users/[id]/technical.ts`

**Intent**: Toggluje `profiles.is_technical` dla wskazanego użytkownika — identyczna struktura jak `ai-enabled.ts`.

**Contract**: Kopia `ai-enabled.ts` z zamienionym `ai_enabled` → `is_technical` we wszystkich miejscach (Zod schema, update, response, komunikaty błędów). Guard `id === locals.user!.id` zostaje (admin nie może modyfikować własnego konta).

### Success Criteria

#### Automated Verification

- Migracja aplikuje się na lokalnym stacku bez błędów: `supabase migration up`
- TypeScript kompiluje się bez błędów: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Unit testy zielone: `npm run test:unit`

#### Manual Verification

- `GET /api/admin/users` zwraca `is_technical: true` dla kont e2e- (weryfikacja w dev narzędziach przeglądarki lub curl)
- `PATCH /api/admin/users/:id/technical` z `{"is_technical": true}` zwraca 200 i aktualizuje pole

**Implementation Note**: Po fazie 1 poczekaj na potwierdzenie manualnego smoke przed fazą 2.

---

## Phase 2: Frontend + E2E testy

### Overview

Upraszcza `isAutomatic()` do jednej linii, dodaje kolumnę „Tech" z checkboxem toggle w tabeli, aktualizuje testy E2E.

### Changes Required

#### 1. Uproszczenie isAutomatic() i usunięcie heurystyki

**File**: `src/components/AdminUsersIsland.tsx`

**Intent**: Usuwa `TECHNICAL_EMAIL_PREFIXES` i dwa-kryteriowy fallback; `isAutomatic()` zwraca wyłącznie `user.is_technical`.

**Contract**:
- Usuń stałą `TECHNICAL_EMAIL_PREFIXES` (linie 20–26)
- Zastąp całe ciało `isAutomatic()` przez `return user.is_technical;`
- Typ `UserAdminDTO` importowany z `users/index.ts` — pole `is_technical` pojawi się automatycznie po zmianie w fazie 1

#### 2. Nowa kolumna Tech z togglem

**File**: `src/components/AdminUsersIsland.tsx`

**Intent**: Dodaje nagłówek kolumny „Tech" i checkbox toggle dla `is_technical` w każdym wierszu — wzorzec analogiczny do istniejącej kolumny „AI".

**Contract**:
- `togglingTechnicalId` state (jak `togglingId` dla AI)
- `handleToggleTechnical(user: UserAdminDTO)` — kopia `handleToggleAi` z zamianą `ai_enabled` → `is_technical` i URL `/api/admin/users/${user.id}/technical`
- Nagłówek `<th>` „Tech" między „AI" a „Książki" (lub po „AI" — spójność wizualna)
- `<td>` z `<input type="checkbox">`:
  - `data-testid={`admin-user-technical-toggle-${user.id}`}`
  - `checked={user.is_technical}`
  - `disabled={!!user.deleted_at || togglingTechnicalId === user.id}`
  - `onChange={() => handleToggleTechnical(user)}`
- Kolumna widoczna dla wszystkich wierszy (jak AI) — brak warunku `isActionable`
- `colSpan`: przed edycją grep wszystkich wystąpień `colSpan` w `AdminUsersIsland.tsx` i zaktualizuj KAŻDE odnoszące się do liczby kolumn tabeli (nie tylko wiersz pusty linia 379)

#### 3. Testy E2E

**File**: `tests/e2e/admin.spec.ts`

**Intent**: Dodaje testy dla toggle `is_technical` oraz weryfikację że filtr „Ukryj konta automatyczne" działa na podstawie flagi DB.

**Contract**:
- Scenariusz: admin włącza `is_technical` dla usera → `admin-user-technical-toggle-{id}` checked
- Scenariusz: admin wyłącza → unchecked
- Scenariusz: user z `is_technical=true` jest ukryty przy `hideAutomatic=true` i pojawia się przy `hideAutomatic=false`
- Wzorzec: analogia do istniejącego testu `ai_enabled` toggle w admin.spec.ts (Phase 2 testu)

### Success Criteria

#### Automated Verification

- TypeScript kompiluje się bez błędów: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Unit testy zielone: `npm run test:unit`
- E2E testy zielone: `npm run test:e2e` (pełny przebieg)

#### Manual Verification

- Panel admina: kolumna „Tech" widoczna, toggle działa (optimistic update + persist po reload)
- Checkbox „Ukryj konta automatyczne" filtruje konta z `is_technical=true` i nie filtruje kont z `book_count=0` które nie mają flagi
- Konta e2e- (po backfill) mają `is_technical=true` i są domyślnie ukryte

**Implementation Note**: Po zielonych E2E — pull request, oczekuj na merge.

---

## Testing Strategy

### Unit Tests

- Nie ma logiki domenowej w czystym sensie — `isAutomatic()` to `return user.is_technical`, nie wymaga oddzielnego unit testu

### E2E Tests

- Toggle is_technical ON/OFF z optimistic update i persist
- Filtrowanie hideAutomatic na podstawie flagi (nie heurystyki)
- Istniejące testy AI toggle jako wzorzec

### Manual Testing

1. Otwórz `/admin` → sprawdź kolumnę Tech
2. Toggluj is_technical dla dowolnego usera → checkbox zmienia się natychmiast (optimistic)
3. Odśwież stronę → flaga persystuje
4. Konto z `is_technical=true` znika przy „Ukryj konta automatyczne" = on
5. Odznacz „Ukryj konta automatyczne" → konto wraca na listę
6. Konto z `book_count=0` i bez nazwy (ale `is_technical=false`) pojawia się na liście

## Migration Notes

- Migracja w branchu, `supabase db push` automatycznie po merge do main (deploy.yml)
- Backfill jest idempotentny (WHERE — nie nadpisuje kont bez dopasowania)
- Migracja `NOT NULL DEFAULT false` jest bezpieczna — nie wymaga backfill dla istniejących wierszy (domyślna wartość ustawiana)

## References

- Wzorzec endpoint: `src/pages/api/admin/users/[id]/ai-enabled.ts`
- Wzorzec toggle UI: `AdminUsersIsland.tsx:112-154` (handleToggleAi)
- E2E wzorzec: `tests/e2e/admin.spec.ts` Phase 2 (ai_enabled toggle)
- Roadmapa S-47: `context/foundation/roadmap.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Migracja DB + backend

#### Automated

- [x] 1.1 Migracja aplikuje się bez błędów: `supabase migration up` — aefcfa5
- [x] 1.2 TypeScript kompiluje się: `npm run typecheck` — aefcfa5
- [x] 1.3 Lint zielony: `npm run lint` — aefcfa5
- [x] 1.4 Unit testy zielone: `npm run test:unit` — aefcfa5

#### Manual

- [x] 1.5 GET /api/admin/users zwraca is_technical: true dla kont e2e- — aefcfa5
- [x] 1.6 PATCH /api/admin/users/:id/technical zwraca 200 i aktualizuje pole — aefcfa5

### Phase 2: Frontend + E2E testy

#### Automated

- [x] 2.1 TypeScript kompiluje się: `npm run typecheck` — 214b9c5
- [x] 2.2 Lint zielony: `npm run lint` — 214b9c5
- [x] 2.3 Unit testy zielone: `npm run test:unit` — 214b9c5
- [x] 2.4 E2E testy zielone: `npm run test:e2e` — 214b9c5

#### Manual

- [x] 2.5 Kolumna Tech widoczna w panelu admina, toggle działa i persistuje — 214b9c5
- [x] 2.6 Filtr hideAutomatic działa na podstawie flagi DB (nie heurystyki) — 214b9c5
- [x] 2.7 Konto z book_count=0 i is_technical=false pojawia się na liście (fallback usunięty) — 214b9c5
