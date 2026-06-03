# Zachowanie kosztów vision przy DELETE zdjęć (S-30) Implementation Plan

## Overview

Koszty vision (`vision_runs.cost_usd`) i refine (`refine_calls.cost_usd`) znikają
nieodwracalnie przy usunięciu zdjęcia, bo wszystkie FK są `ON DELETE CASCADE`.
S-29 (photos-crud DELETE) nie może wejść bez zachowania tej historii. Plan zmienia
FK na `SET NULL`, dorzuca `user_id` do `vision_runs` (denorm — agregacja per user
niezależna od `photos`), zmienia RLS `vision_runs` na bezpośredni `user_id`, i
dodaje `GET /api/account/stats` zwracający łączne koszty/liczby per user.

## Current State Analysis

- `vision_runs` (`0007`): `photo_id` FK **ON DELETE CASCADE**; RLS przez **join do photos** (`exists(photos where id=photo_id and user_id=auth.uid())`); **brak** kolumny `user_id`; `cost_usd numeric(10,6)`.
- `refine_calls` (`0012`): ma `user_id` FK ✓; `photo_id` **CASCADE** + `detection_id` **CASCADE**; RLS `user_id = auth.uid()`.
- Ścieżki kasowania kosztu przy DELETE photo: photo→vision_runs (cascade); photo→refine_calls.photo_id (cascade); photo→detections (cascade)→refine_calls.detection_id (cascade). **Trzy** FK trzeba zmienić.
- `costs.ts:38` używa `(locals.supabase as any)` dla `refine_calls` — precedens na chicken-egg typów nowej kolumny przed regen `database.types.ts`.
- Brak `/api/account/*`. Endpoint net-new.
- Max migracja na main: `0013` → nowa `0014`.
- Lokalny stack Supabase AV-blocked → migracja walidowana dopiero post-merge `db push` (lessons.md).

## Desired End State

Usunięcie zdjęcia (przyszłe S-29) **nie kasuje** rekordów kosztów — `vision_runs`/`refine_calls` zostają z `photo_id`/`detection_id = NULL`, zachowując `cost_usd` i `user_id`. `GET /api/account/stats` zwraca `{ total_vision_cost_usd, total_refine_cost_usd, vision_run_count, refine_call_count }` agregowane po `user_id` (RLS-respecting).

Weryfikacja: `npm run lint && npm run typecheck && npm run test` zielone; migracja `db push` po merge bez błędu; endpoint zwraca poprawne sumy.

### Key Discoveries:

- RLS `vision_runs` MUSI przejść na bezpośredni `user_id` — po `photo_id=NULL` join do photos nic nie znajdzie → user nie odczytałby własnego kosztu (Phase 1 #1).
- `refine_calls.detection_id` też CASCADE → bez zmiany na SET NULL photo→detection cascade i tak skasuje refine_call (rozszerzenie spec roadmapy).
- `as any` cast to ustalony repo-pattern dla query po nowej kolumnie przed regen typów.

## What We're NOT Doing

- DELETE zdjęcia (to S-29) — tylko przygotowujemy schemat.
- UI statystyk (to S-31 `/account`) — tylko endpoint danych.
- Soft-delete zdjęć ani osobna tabela `vision_cost_log` (odrzucone — denorm user_id + SET NULL wystarcza, mniejszy zakres).
- Zmiana sposobu zapisu kosztów przy `/process` / refine (zostają).

## Implementation Approach

Phase 1: migracja `0014` (schema). Phase 2: endpoint + unit test (mock DB). Migracja walidowana realnie dopiero post-merge `db push`.

## Critical Implementation Details

- **Kolejność w migracji**: dodaj `vision_runs.user_id` (nullable) → backfill z `photos.user_id` przez `photo_id` → `set not null`; DOPIERO potem `photo_id drop not null` + `alter ... on delete set null` (drop+recreate FK constraint). RLS: drop stare 4 polityki (join) → utwórz nowe na `user_id`.
- **Typy**: po dodaniu `vision_runs.user_id` query `.eq('user_id', ...)` nie przejdzie typecheck (kolumna spoza `database.types.ts` aż do regen). Użyj `(locals.supabase as any)` jak `costs.ts:38`, z komentarzem.

## Phase 1: Migracja 0014 — FK SET NULL + user_id + RLS

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/0014_vision_cost_preservation.sql`

**Intent**: Zachować koszty vision/refine przy DELETE photo. Dodać `vision_runs.user_id` (denorm), przełączyć 3 FK na SET NULL, przepisać RLS `vision_runs` na bezpośredni `user_id`.

**Contract**:
- `vision_runs`: `add column user_id uuid references auth.users(id) on delete cascade`; backfill `update vision_runs set user_id = (select user_id from photos where photos.id = vision_runs.photo_id)`; `alter column user_id set not null`. `alter column photo_id drop not null` + drop FK `vision_runs_photo_id_fkey` + `add ... references photos(id) on delete set null`. Drop 4 polityki RLS (join) → 4 nowe `using (user_id = auth.uid())` (+ insert `with check (user_id = auth.uid())`). Index `(user_id)` dla agregacji.
- **F1 — BEFORE INSERT trigger `set_vision_run_user_id`** (SECURITY DEFINER + `set search_path = public, pg_temp`): `new.user_id := (select user_id from photos where id = new.photo_id)`. KONIECZNE: istniejący `process.ts:105` insertuje bez user_id; trigger derywuje go z `photos` → zero zmian kodu, zero okna deploy-przed-migracją, działa dla wszystkich insert sites. Trigger biegnie przed NOT NULL i RLS `with check` → oba przechodzą. Wzorzec defense-in-depth (jak `handle_new_user`, `prevent_concurrent_vision_run`).
- `refine_calls`: `alter column photo_id drop not null` + drop FK `refine_calls_photo_id_fkey` → `on delete set null`; `alter column detection_id drop not null` + drop FK `refine_calls_detection_id_fkey` → `on delete set null`. (user_id zostaje NOT NULL — agregacja po nim; refine endpoint już ustawia user_id, więc bez zmian kodu.)
- FK drop/recreate przez `alter table ... drop constraint <name>` + `add constraint`. Nazwy (Postgres auto `<tbl>_<col>_fkey`): `vision_runs_photo_id_fkey`, `refine_calls_photo_id_fkey`, `refine_calls_detection_id_fkey`.

### Success Criteria:

#### Automated Verification:

- Lint: `npm run lint`
- Typecheck: `npm run typecheck` (migracja nie wpływa, ale guard)
- Unit/regresja: `npm run test`

#### Manual Verification:

- (post-merge, user-only) `npx supabase db push` aplikuje 0014 bez błędu
- (post-merge) w Studio: usunięcie photo zostawia `vision_runs`/`refine_calls` z NULL `photo_id`, koszt zachowany

**Implementation Note**: Migracja realnie testowana dopiero post-merge `db push` (lokalny stack AV-blocked). In-branch: SQL review + lint/typecheck/test zielone. Pauza na potwierdzenie usera.

---

## Phase 2: Endpoint GET /api/account/stats + test

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/account/stats.ts`

**Intent**: Zwrócić agregat kosztów vision per zalogowany user (RLS-respecting), niezależny od istnienia zdjęć.

**Contract**: `GET` → 401 gdy `!locals.user`; query `vision_runs` `.eq('user_id', user.id).eq('status','succeeded')` (F3 — count tylko udanych; running/failed mają cost_usd NULL i zaniżają sens count) — sumuj `cost_usd`, count; `refine_calls` `.eq('user_id', user.id)` — sumuj `cost_usd`, count. `(locals.supabase as any)` dla vision_runs.user_id (chicken-egg typów; precedens costs.ts:38). Odpowiedź F-02 envelope: `apiResponse({ data: { total_vision_cost_usd, total_refine_cost_usd, vision_run_count, refine_call_count } })`. Błędy → `console.error` + 500 `INTERNAL_ERROR`. `export const prerender = false`.

#### 2. Unit test

**File**: `tests/unit/pages/api/account/stats.test.ts`

**Intent**: Pokryć sumowanie + count + 401, mockując `locals.supabase`.

**Contract**: Mock vision_runs/refine_calls z `cost_usd`; assert sumy + liczby; 401 gdy user null. Wzorzec z `tests/unit/pages/api/photos/index.test.ts` (mock from→select→eq chain).

### Success Criteria:

#### Automated Verification:

- Nowy test zielony: `npm run test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Manual Verification:

- (post-merge, po db push) `GET /api/account/stats` zwraca poprawne sumy dla konta z historią vision

**Implementation Note**: Pauza na potwierdzenie usera.

## Testing Strategy

### Unit Tests:

- `stats.test.ts`: sumy `cost_usd`, count, 401; mock DB

### Manual Testing Steps (post-merge, user-only):

1. `npx supabase db push` → 0014 aplikuje się
2. Studio: usuń photo → vision_runs/refine_calls zostają z NULL photo_id
3. `GET /api/account/stats` → sumy zgodne

## Migration Notes

`0014` — irreversible w prod. `db push` ZAWSZE po merge do main (lessons.md). FK drop/recreate: zweryfikować realne nazwy constraintów przed pisaniem (Postgres `<table>_<col>_fkey`).

## References

- `supabase/migrations/0007_vision_runs.sql`, `0012_refine_calls.sql`
- `src/pages/api/photos/[id]/costs.ts:38` (as any precedens)
- Roadmap S-30; backlog uwaga F

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Migracja 0014 — FK SET NULL + user_id + RLS

#### Automated

- [x] 1.1 Lint: `npm run lint`
- [x] 1.2 Typecheck: `npm run typecheck`
- [x] 1.3 Unit/regresja zielone: `npm run test`

#### Manual

- [ ] 1.4 (post-merge) `npx supabase db push` aplikuje 0014 bez błędu
- [ ] 1.5 (post-merge) Studio: DELETE photo zostawia koszty z NULL photo_id

### Phase 2: Endpoint GET /api/account/stats + test

#### Automated

- [ ] 2.1 Nowy test stats.test.ts zielony: `npm run test`
- [ ] 2.2 Typecheck: `npm run typecheck`
- [ ] 2.3 Lint: `npm run lint`

#### Manual

- [ ] 2.4 (post-merge) `GET /api/account/stats` zwraca poprawne sumy
