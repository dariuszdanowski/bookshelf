# shelves-crud-and-purchased: CRUD półek + niesuwalna systemowa „Zakupione" — Implementation Plan

## Overview

Most do MVP. Dziś pojawia się full CRUD na user-created półkach (`/api/shelves` + `/shelves` UI) plus DB-level niezmienność systemowej „Zakupione" (trigger BEFORE DELETE / BEFORE UPDATE). „Zakupione" już zakładana per signup (`handle_new_user` trigger z S-01, migracja 0003); tutaj tylko cementujemy ją w schemacie + dorzucamy UNIQUE `(user_id, name)` constraint żeby user nie mógł stworzyć duplikatu.

## Current State Analysis

- **Tabela `shelves`** istnieje (migracja 0001) — `id`, `user_id` FK, `name` NOT NULL, `location`, `position_index` (NOT NULL default 0), `created_at`. Brak constraint UNIQUE (user_id, name) — user mógłby teoretycznie stworzyć 2 półki o tej samej nazwie.
- **RLS policies** na `shelves` z 0002: SELECT/INSERT/UPDATE/DELETE wszystkie `user_id = auth.uid()` (per-user isolation). Wystarczające — endpoint nie musi sam filtrować po user_id.
- **Trigger `handle_new_user`** (0003) tworzy „Zakupione" przy każdej rejestracji — verified w prod (signup tested 2026-05-26). User zawsze ma minimum 1 półkę.
- **F-02 envelope** (`apiResponse`, `apiError`) — single source of truth dla endpoint contract; consume via `src/lib/http/response.ts`.
- **Middleware** (`src/lib/middleware/handler.ts`) — `/api/shelves` automatycznie protected (nie w PUBLIC_EXACT ani PUBLIC_PREFIXES), redirect/401 dla anon. To pożądane.
- **Brak istniejących endpointów** w `src/pages/api/shelves/**` — całość greenfield.
- **Brak `src/lib/shelves/**`** — analogiczna struktura do `src/lib/auth/` z S-01 (schema.ts + ewentualne helper functions).
- **`database.types.ts`** — wygenerowany typed client; po migracji 0004 trzeba regenerować (`npm run db:types`).
- **Stream E S-09 landing CTA** dla zalogowanego dziś idzie do `/library` (not `/shelves`). Out-of-scope tutaj — `/library` przyjdzie w S-08 search. Linki do `/shelves` z UI po S-02: header nav albo follow-up slice.

## Desired End State

Po wykonaniu planu:

1. **Migration 0004** wgrana na zdalny Supabase:
   - `UNIQUE (user_id, name)` na shelves
   - Trigger BEFORE DELETE rzuca exception dla `name = 'Zakupione'`
   - Trigger BEFORE UPDATE rzuca exception jeśli próba zmiany `name` z `'Zakupione'` na cokolwiek innego
2. **API endpoints**:
   - `GET /api/shelves` → 200 + `{data:{shelves:[{id,name,location,position_index,is_system,book_count:0,created_at}]}}` z sortowaniem „Zakupione" first, potem name ASC
   - `POST /api/shelves` → 201 + `{data:{shelf}}` lub 400 VALIDATION_ERROR (np. duplicate name, name='Zakupione' user-attempted)
   - `PATCH /api/shelves/:id` → 200 + `{data:{shelf}}` lub 400/404; blokuje rename systemowej „Zakupione"
   - `DELETE /api/shelves/:id` → 204 lub 404; blokuje systemową „Zakupione" (DB trigger reject + endpoint catch + 400 VALIDATION_ERROR z czytelnym message)
3. **UI**:
   - `/shelves` (Astro page, protected) renderuje React island
   - Lista półek (cards lub rows) — „Zakupione" wyróżniona (badge „systemowa") + bez delete/rename
   - Form inline u góry: nowa półka (name + opcjonalna location)
   - Per row: edit mode toggle (inline), delete button (z `confirm()` dialog), oprócz „Zakupione"
4. **Testy**:
   - Unit: Zod schemas (min 8 testów) + endpoint handlers (min 12 testów)
   - Integration: DELETE/UPDATE block dla „Zakupione" + UNIQUE constraint + RLS scoping (min 4 testów)
   - E2E: golden path login → /shelves → create → edit → delete (min 1 test)
5. **Konwencje**:
   - Wszystkie endpointy mają `export const prerender = false`
   - Tylko `apiResponse`/`apiError`, zero `new Response()` ręcznie
   - `Cache-Control: private, no-store` przez F-02 defaults

**Weryfikacja**: `npm run typecheck` + `npm run lint` + `npm run test` + (Phase 1) `supabase db push` + (po deploy) curl smoke + (Twoja) UI smoke.

### Key Discoveries / auto-decisions

- **„Zakupione" hard-lock w DB, nie tylko UI** — pojedyncza warstwa walidacji jest słaba, agent może popełnić UI bug. DB triggers są ostatecznym guardem (rationale: lekcja z F-01 „RLS od dnia pierwszego" + ogólny load-bearing pattern z lessons.md „enforcement-by-code"). UI też nie pokazuje delete/edit dla „Zakupione" — defense in depth.
- **UNIQUE (user_id, name)** — bez tego user może stworzyć duplicate „Belletrystyka" → mylące w UI. Constraint enforce na poziomie DB; endpoint catch'uje `23505` (Postgres unique violation) i mapuje na `400 VALIDATION_ERROR` z message „Półka o tej nazwie już istnieje".
- **`book_count` w response = 0 zawsze (na razie)** — table `books` jeszcze nie istnieje (S-05 ją wprowadzi). Field jest w schemacie response żeby S-08 (catalog search) nie musiał zmieniać kontraktu. Po S-05 wstawimy real count przez subquery / left join.
- **Sortowanie**: „Zakupione" first (DESC by `name = 'Zakupione'` w SQL ORDER BY), potem `name ASC`. UI nie sortuje — endpoint zwraca w docelowej kolejności.
- **Brak pagination** — typowy user ma <50 półek; pagination = scope creep. Dodać follow-up slice jeśli realny use case (np. „Kolekcjoner z 200+ półkami").
- **Delete confirmation = native `window.confirm()`** — KISS, brak modal infrastruktury jeszcze. Future slice może wymienić na React modal jeśli pojawi się więcej destructive actions.
- **Edit mode = inline toggle** (per row) — bez modal / separate page. Forms identical schema, just different mutation.
- **Position_index = ignored w S-02** — kolumna istnieje (z 0001), ale UI nie pozwala na reordering. Default 0 wszędzie. Reordering zostawiamy do osobnego micro-slice'a jeśli/kiedy potrzebne (nie blokuje S-03..S-05).

## What We're NOT Doing

- **Reordering półek (drag-and-drop)** — `position_index` kolumna istnieje, ale UI nie pozwala zmieniać. Osobny micro-slice (Stream E candidate) jeśli/kiedy user się o to upomni.
- **Liczba książek (`book_count`)** — placeholder 0 w response shape; real count gdy S-05 wprowadzi `books` table. Następny slice nie ma kontraktowych zmian.
- **Bulk operations** — delete N półek naraz, batch rename. Out-of-scope; one-at-a-time wystarczy.
- **Modal dla delete confirmation** — `window.confirm()` wystarczy. Jeśli następny slice (S-06? S-07?) wprowadzi więcej destructive actions, możemy rozważyć modal infrastrukturę osobno.
- **Linkowanie z `/library` lub header nav do `/shelves`** — landing CTA z S-09 idzie do `/library` (Stream E decyzja). `/library` przyjdzie w S-08. Tymczasem user dociera do `/shelves` bezpośrednio przez URL (lub Stream E follow-up doda header nav).
- **Logging utworzenia/usunięcia półek** — Cloudflare Workers logs są wystarczające (`console.log` w endpoint jeśli debug); pełna telemetria w S-05 (corrections table — i tak persistuje user actions).
- **i18n** — UI komunikaty PO POLSKU literally (FR projektu kursowego); brak namespace messages, brak EN.
- **Public shelves / sharing** — explicit out-of-scope per PRD §Non-Goals.

## Implementation Approach

Dwie fazy w kolejności zależności:

1. **Phase 1 (DB + API)**: migration 0004 → Zod schemas → endpointy (GET/POST/PATCH/DELETE) → unit tests + integration test. Manual gate: `supabase db push` (user wykona ręcznie, bo agent nie pcha migracji do prod DB).
2. **Phase 2 (UI)**: Astro page `/shelves` (protected) → React island ShelvesList + ShelfForm → E2E test (Playwright golden path).

Phase 2 zależy od Phase 1 (UI fetch'uje endpointy). Niemożliwe równoległe.

## Critical Implementation Details

### Migration 0004 — anatomy

```sql
-- 1. UNIQUE constraint
alter table public.shelves
  add constraint shelves_user_name_unique unique (user_id, name);

-- 2. DELETE protection dla "Zakupione"
create or replace function public.prevent_zakupione_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.name = 'Zakupione' then
    raise exception 'Nie można usunąć systemowej półki "Zakupione"'
      using errcode = 'P0001';  -- raise_exception
  end if;
  return old;
end;
$$;

drop trigger if exists shelves_protect_zakupione_delete on public.shelves;
create trigger shelves_protect_zakupione_delete
  before delete on public.shelves
  for each row
  execute function public.prevent_zakupione_delete();

-- 3. UPDATE name protection
create or replace function public.prevent_zakupione_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.name = 'Zakupione' and new.name is distinct from old.name then
    raise exception 'Nie można zmienić nazwy systemowej półki "Zakupione"'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists shelves_protect_zakupione_rename on public.shelves;
create trigger shelves_protect_zakupione_rename
  before update on public.shelves
  for each row
  execute function public.prevent_zakupione_rename();
```

### Endpoint error mapping

W endpointach mapujemy Postgres error codes na F-02 envelope:

- `23505` (unique_violation, name dup) → `400 VALIDATION_ERROR` „Półka o tej nazwie już istnieje"
- `P0001` (raise_exception z naszego trigger'a) → `400 VALIDATION_ERROR` z message z `error.message`
- `23503` (foreign_key_violation, np. shelf nie istnieje na PATCH/DELETE) → `404 NOT_FOUND`
- Inne / nieoczekiwane → `500 INTERNAL_ERROR` „Database error" + console.error rich

Zod refuse name='Zakupione' na CREATE (`refine` w schema) — defense in depth (frontend rejection przed DB).

### Sortowanie w GET

```sql
select id, name, location, position_index, created_at
from public.shelves
order by (name = 'Zakupione') desc, name asc;
```

(„Zakupione" first → boolean DESC → true=1, false=0; reszta alfabetycznie.)

### React island data flow

`ShelvesIsland` (client:load):
1. `useEffect`: `fetch('/api/shelves')` → setShelves
2. State: shelves (array), loading, error
3. Akcje:
   - `onCreate(name, location)` → POST `/api/shelves` → unshift / merge / refetch list (refetch prostsze)
   - `onEdit(id, patch)` → PATCH `/api/shelves/:id` → refetch
   - `onDelete(id)` → `confirm('Usunąć półkę "X"?')` → DELETE `/api/shelves/:id` → refetch
4. Render: ShelfForm (create) + lista (per row: ShelfListItem z is_system flag)

## Phase 1: DB schema + API endpoints + unit + integration

### Overview

Migration 0004 + Zod schemas + 4 endpointy + unit tests dla schema + endpoint + integration test pokrywający triggery i RLS. Atomic commit.

### Changes Required

#### 1. Migration 0004

**File**: `supabase/migrations/0004_shelves_constraints.sql` (NEW)

**Intent**: UNIQUE constraint + 2 triggery „Zakupione" protect (DELETE + UPDATE name).

**Contract**: szczegółowy SQL w sekcji „Critical Implementation Details" wyżej. Idempotent (`create or replace function`, `drop trigger if exists`).

#### 2. Database types regeneration

**File**: `src/lib/db/database.types.ts` (generated; po migracji regen)

**Intent**: Po `supabase db push` uruchomić `npm run db:types` żeby typed client widział nowe triggery / constrainty (technicznie schema się nie zmienia w shape kolumn, więc regen może być no-op — ale dla pewności uruchamiamy).

#### 3. Zod schemas

**File**: `src/lib/shelves/schema.ts` (NEW)

**Intent**: walidacja inputów CRUD (CREATE, PATCH), schema response (Shelf).

**Contract**:
```ts
import { z } from 'zod';

const RESERVED_NAMES = ['Zakupione'] as const;

export const ShelfNameSchema = z.string()
  .trim()
  .min(1, 'Nazwa nie może być pusta')
  .max(100, 'Nazwa może mieć maksymalnie 100 znaków')
  .refine((name) => !RESERVED_NAMES.includes(name as never), {
    message: 'Nazwa "Zakupione" jest zarezerwowana dla systemowej półki',
  });

export const LocationSchema = z.string().trim().max(200).optional();

export const CreateShelfSchema = z.object({
  name: ShelfNameSchema,
  location: LocationSchema,
});

export const UpdateShelfSchema = z.object({
  name: ShelfNameSchema.optional(),
  location: LocationSchema,
}).refine(
  (data) => data.name !== undefined || data.location !== undefined,
  { message: 'Co najmniej jedno pole musi być podane' }
);

export type CreateShelfInput = z.infer<typeof CreateShelfSchema>;
export type UpdateShelfInput = z.infer<typeof UpdateShelfSchema>;
```

#### 4. List endpoint

**File**: `src/pages/api/shelves/index.ts` (NEW — GET + POST)

**Intent**: GET zwraca posortowaną listę półek usera; POST tworzy nową.

**Contract**:
- `GET`: `select id, name, location, position_index, created_at from shelves order by (name = 'Zakupione') desc, name asc`. Map każdego row na `{...row, is_system: row.name === 'Zakupione', book_count: 0}`. Zwróć `{data:{shelves}}`.
- `POST`: parsuj body przez `CreateShelfSchema`, jeśli fail → 400 VALIDATION_ERROR. Insert do shelves z `user_id: locals.user.id` (RLS i tak wymusza). Catch errors: `23505` → 400 „Półka o tej nazwie już istnieje"; reszta → 500 INTERNAL_ERROR + console.error rich. Sukces → 201 z `{data:{shelf: {...new_row, is_system: false, book_count: 0}}}`.
- `prerender = false`. `try/catch` na request.json() (S-01 pattern).

#### 5. Item endpoint

**File**: `src/pages/api/shelves/[id].ts` (NEW — PATCH + DELETE)

**Intent**: PATCH update (name + location); DELETE z constraint protection.

**Contract**:
- Validate `params.id` przez `parseUuidParam` z F-02 (404-privacy dla bad UUID).
- `PATCH`: parsuj `UpdateShelfSchema`, update via `eq('id', params.id)` (RLS scope per-user). Catch: `P0001` (trigger reject „Zakupione" rename) → 400 z message; `23505` → 400 dup; not found (`data.length === 0`) → 404; reszta → 500. Sukces → 200 z `{data:{shelf}}`.
- `DELETE`: delete via `eq('id', params.id)`. Catch: `P0001` (trigger reject „Zakupione" delete) → 400 z message; not found (rowCount 0) → 404; reszta → 500. Sukces → 204 (No Content, ale F-02 `apiResponse` nie wspiera 204; emit `apiResponse({data: {deleted: true}}, {status: 200})` zamiast lub use `new Response(null, {status: 204, headers: {'Cache-Control': 'private, no-store'}})` — wybieram 200 + `{data:{deleted:true}}` dla spójności envelope).
- `prerender = false`.

#### 6. Unit tests — schema

**File**: `tests/unit/lib/shelves/schema.test.ts` (NEW)

**Intent**: walidacja CreateShelfSchema, UpdateShelfSchema, ShelfNameSchema.

**Contract**: minimum 8 testów:
- valid name OK / empty name reject / 101-char name reject / „Zakupione" reject (CREATE) / whitespace trim
- valid location OK / 201-char location reject / undefined location OK
- UpdateShelfSchema: oba undefined reject („at least one field")

#### 7. Unit tests — endpoints

**File**: `tests/unit/pages/api/shelves/index.test.ts` (NEW)

**Intent**: GET list + POST create endpoint handlers z mock `locals.supabase`.

**Contract**: minimum 8 testów (4 per HTTP method):
- GET: lista zwraca posortowane shelves z is_system + book_count=0; pusta tabela → []; supabase error → 500
- POST: valid body → 201 z shelf; bad JSON → 400; invalid Zod → 400 z field errors; duplicate name (mock `23505`) → 400 z message; supabase 500 → 500

**File**: `tests/unit/pages/api/shelves/id.test.ts` (NEW)

**Intent**: PATCH + DELETE handlers.

**Contract**: minimum 6 testów:
- PATCH: valid update → 200; not found → 404; Zod fail → 400; P0001 (Zakupione rename) → 400 z message; duplicate name → 400
- DELETE: success → 200 + `{data:{deleted:true}}`; not found → 404; P0001 (Zakupione delete) → 400 z message; supabase 500 → 500

#### 8. Integration test

**File**: `tests/integration/shelves-rls-and-triggers.test.ts` (NEW)

**Intent**: weryfikacja na real Supabase (vs F-01 pattern z `rls.test.ts`): RLS scoping, UNIQUE constraint, oba triggery „Zakupione" protect.

**Contract**: minimum 5 testów (analogicznie do `tests/integration/rls.test.ts` z F-01 — używaj raw `createClient` + service-role admin do setup, anon + JWT user'a do queries):
- DELETE z user_id = user1 dla shelf systemowej „Zakupione" → exception P0001 (z message)
- UPDATE name z user1 dla „Zakupione" → exception P0001
- INSERT duplicate name dla same user → 23505 unique violation
- INSERT same name dla DIFFERENT user → OK (per-user uniqueness)
- User A SELECT shelves nie widzi user B shelves (RLS scoping check — redundant vs F-01 ale dla regression cover)

### Success Criteria

#### Automated

- `npx supabase migration list` pokazuje 0004 zaaplikowane na zdalnym (manual `supabase db push` przez user'a)
- `npm run db:types` regenerated bez błędów
- `npm run typecheck` zielony — 0 errors
- `npm run lint` zielony
- `npm run test` zielony — minimum 22 nowych unit testów (8 schema + 8 endpoint index + 6 endpoint id) + istniejące 63 = 85+
- `npm run test:integration` zielony — auth-trigger.test.ts (z S-01, nadal) + nowy shelves-rls-and-triggers.test.ts (5 testów)

#### Manual

- User: `supabase db push` (manual gate dla migracji)
- User: `npm run db:types` po push (opcjonalnie, jeśli agent nie zregeneruje samodzielnie)
- Code review: schema.ts ma RESERVED_NAMES; endpoint mapuje 23505 i P0001; integration test pokrywa 5 scenariuszy

**Implementation Note**: Po Phase 1 zatrzymaj się na user gate `supabase db push` + ewentualnie `npm run db:types`. Phase 2 (UI) startuje po confirm gate'u.

---

## Phase 2: UI — strona /shelves + React island + E2E

### Overview

Astro page `/shelves` (protected), React island z listą + form + delete dialog, E2E golden path.

### Changes Required

#### 1. /shelves page

**File**: `src/pages/shelves.astro` (NEW)

**Intent**: protected page (middleware redirektuje anon na /login), używa Layout, renderuje ShelvesIsland.

**Contract**:
```astro
---
import Layout from '../layouts/Layout.astro';
import ShelvesIsland from '../components/ShelvesIsland.tsx';

// Middleware ensures locals.user is non-null tu — to protected path.
---

<Layout title="Moje półki">
  <main class="mx-auto max-w-4xl p-8">
    <h1 class="mb-6 text-3xl font-bold">Moje półki</h1>
    <ShelvesIsland client:load />
  </main>
</Layout>
```

#### 2. ShelvesIsland (orchestrator)

**File**: `src/components/ShelvesIsland.tsx` (NEW)

**Intent**: fetch list + render form + render list + handle mutations + refetch.

**Contract**: React component z `useState` (shelves, loading, error). `useEffect` initial fetch. Funkcje `handleCreate`, `handleUpdate`, `handleDelete` wywołują endpointy + na sukces refetch. Render: `<ShelfForm onCreate={...} />` + `<ul>{shelves.map(s => <ShelfListItem key={s.id} shelf={s} onUpdate={...} onDelete={...} />)}</ul>`.

Loading state: spinner (lub po prostu „Ładowanie..." text). Error state: red banner z generic message.

#### 3. ShelfForm

**File**: `src/components/ShelfForm.tsx` (NEW)

**Intent**: form do create (top of page) — name input + optional location + submit button.

**Contract**: kontrolowany form (`useState` na name, location). Submit handler wywołuje `props.onCreate(name, location)` (przekazany z ShelvesIsland). Reset po sukcesie. Walidacja inline jeśli Zod fail na server (response.error.details z field errors).

#### 4. ShelfListItem

**File**: `src/components/ShelfListItem.tsx` (NEW)

**Intent**: pojedynczy row listy — name + location + book_count + akcje (Edit / Delete) oprócz dla `is_system`.

**Contract**: `useState` editMode. View mode: pokazuje name + location + book_count + buttony „Edytuj" / „Usuń". Edit mode: form inline + buttony „Zapisz" / „Anuluj". Dla `is_system=true`: badge „systemowa" + brak buttonów Edit/Delete. Delete: `if (confirm('Usunąć półkę "X"? Tej operacji nie można cofnąć.')) onDelete(id)`.

#### 5. E2E test

**File**: `tests/e2e/shelves.spec.ts` (NEW)

**Intent**: golden path login → /shelves → create → edit → delete (zarezerwowane „Zakupione" nie tykane).

**Contract**: Playwright spec używający globalnego signup helper'a (jeśli istnieje, jeśli nie — login z testowymi creds z env). Minimum 1 test pokrywający flow: login → otwiera `/shelves` → widzi „Zakupione" w liście → tworzy „Test Shelf" → edit → delete → potwierdza confirm.

### Success Criteria

#### Automated

- `npm run typecheck` zielony — React components typed bez `any`
- `npm run lint` zielony na `src/components/Shelf*` + `src/pages/shelves.astro`
- `npm run test` zielony — regression check (unit testy z Phase 1 nadal zielone)
- `npm run test:e2e` zielony — nowy `shelves.spec.ts` test (minimum 1)

#### Manual

- Code review: `client:load` na ShelvesIsland, fetch JSON pattern spójny z S-01 forms, „Zakupione" wyróżniona w UI bez delete/edit buttonów
- User dev smoke (`npm run dev`): otworzyć /shelves, stworzyć półkę, edytować, próbować usunąć „Zakupione" (UI nie pokazuje buttonu → strict check), usunąć user-created
- Production deploy: po push do main, GitHub Actions deploy zielony; curl `/shelves` redirektuje (anon) na `/login` lub renderuje (auth)

**Implementation Note**: Po Phase 2 manual user gate (UI smoke). Po nim → `/10x-impl-review` + `/10x-archive`.

---

## Testing Strategy

### Unit Tests (Phase 1)

- `tests/unit/lib/shelves/schema.test.ts` — 8 testów Zod validators
- `tests/unit/pages/api/shelves/index.test.ts` — 8 testów GET + POST handlers
- `tests/unit/pages/api/shelves/id.test.ts` — 6 testów PATCH + DELETE handlers

### Integration Tests (Phase 1)

- `tests/integration/shelves-rls-and-triggers.test.ts` — 5 testów real DB scenarios
- (regression) `tests/integration/rls.test.ts` (F-01) + `tests/integration/auth-trigger.test.ts` (S-01) nadal zielone

### E2E Tests (Phase 2)

- `tests/e2e/shelves.spec.ts` — 1 golden path test

### Manual Testing Steps

1. Po Phase 1: `supabase db push` (user) + Studio check że triggery istnieją (`prevent_zakupione_delete`, `prevent_zakupione_rename`)
2. Po Phase 2 dev smoke: stworzyć/edytować/usunąć user-created shelf
3. Po deploy: curl `GET https://bookshelf.../api/shelves` jako anon → 401 envelope; jako auth (z cookies sesji) → 200 z listą

## Performance Considerations

Nieistotne dla S-02. Lista półek (typowo <50 rows) ładuje się <50ms. Triggery wykonują single string comparison — milisekundy. Brak N+1 ani innych pułapek.

## Migration Notes

- **0004 idempotent** — `create or replace function`, `drop trigger if exists`. Bezpieczne ponowne uruchomienie (np. branch switch + reset).
- **Rollback**: jeśli triggery okażą się broken w prod, `drop trigger ... on shelves; drop function ...` (manualnie w Studio SQL Editor). Endpointy nadal działają (degradacja: user mógłby usunąć „Zakupione" — niedobrze, ale aplikacja nie pada). Lepsze niż całkowity revert deploy'u.
- **UNIQUE constraint** — istniejące dane: w prod jeden user (Twoje konto), brak duplikatów, więc safe. Jeśli kiedyś ktoś dorzuci usera z duplicate name (ręcznie), migration padnie na constraint add — wymaga pre-flight check / cleanup.

## References

- S-02 w roadmapie: `context/foundation/roadmap.md`
- F-01 (data + RLS substrate): `context/archive/2026-05-25-data-and-rls-substrate/`
- F-02 (API envelope + middleware): `context/archive/2026-05-26-api-response-contract/`
- S-01 (auth — wzorzec endpointów + middleware whitelist): `context/archive/2026-05-26-email-password-auth/`
- `handle_new_user` trigger (S-01 0003): `supabase/migrations/0003_handle_new_user.sql`
- Schema shelves (F-01 0001): `supabase/migrations/0001_initial_schema.sql`
- RLS shelves (F-01 0002): `supabase/migrations/0002_rls_policies.sql`
- F-02 envelope helpers: `src/lib/http/response.ts`
- Middleware (protected paths): `src/lib/middleware/handler.ts`
- Lessons (rules priors): `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: DB schema + API endpoints + unit + integration

#### Automated

- [ ] 1.1 `npm run typecheck` zielony — 0 errors
- [ ] 1.2 `npm run lint` zielony na `src/lib/shelves/**` + `src/pages/api/shelves/**`
- [ ] 1.3 `npm run test` zielony — minimum 22 nowych unit testów
- [ ] 1.4 `npm run test:integration` zielony — `shelves-rls-and-triggers.test.ts` (5 testów) + regression na rls.test.ts + auth-trigger.test.ts

#### Manual

- [ ] 1.5 `supabase db push` zaaplikował migrację 0004 na zdalny (Supabase Studio: funkcje `prevent_zakupione_delete` i `prevent_zakupione_rename` widoczne)
- [ ] 1.6 Code review: schema.ts ma RESERVED_NAMES; endpoint mapuje Postgres error codes (23505, P0001) na F-02 envelope; integration test pokrywa 5 scenariuszy

### Phase 2: UI + E2E

#### Automated

- [ ] 2.1 `npm run typecheck` zielony — React components typowane bez `any`
- [ ] 2.2 `npm run lint` zielony na `src/components/Shelf*` + `src/pages/shelves.astro`
- [ ] 2.3 `npm run test` zielony — regression unit + integration z Phase 1 nadal zielone
- [ ] 2.4 `npm run test:e2e` zielony — minimum 1 nowy test w `shelves.spec.ts`

#### Manual

- [ ] 2.5 Code review: `client:load` na ShelvesIsland; „Zakupione" w UI bez Edit/Delete buttonów; fetch JSON pattern spójny z S-01
- [ ] 2.6 Dev smoke: stworzyć półkę, edytować, próbować usunąć systemową „Zakupione" (nie ma buttonu — strict check), usunąć user-created (z confirm dialog)
- [ ] 2.7 Production smoke: po deploy curl `/api/shelves` jako anon → 401 envelope; otworzyć `/shelves` w przeglądarce po zalogowaniu → renderuje listę
