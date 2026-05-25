# F-01: Persystencja + izolacja per-user (data-and-rls-substrate) — Implementation Plan

## Overview

Zamknięcie partial-baseline warstwy danych z roadmapy (slice F-01). Migracje `0001` (8 tabel) i `0002` (RLS) są już **napisane**, ale nie zastosowane ani zweryfikowane, a `src/lib/db/` jest puste. Ten plan: (1) aplikuje migracje do zlinkowanego zdalnego projektu Supabase i generuje typ `Database`, (2) dostarcza **RLS-respecting** typowane klienty (server SSR + browser, bez service-role), (3) dowodzi izolacji per-user testem integracyjnym Vitest. Bez Dockera, bez auth UI, bez endpointów — czysty substrat, na którym staną wszystkie slice'y S-01…S-08.

## Current State Analysis

- **Migracje**: `supabase/migrations/0001_initial_schema.sql` — 8 tabel (`profiles`, `shelves`, `photos`, `detections`, `book_candidates`, `books`, `shelf_entries`, `corrections`) z indeksami i CHECK-constraintami (enumy status/source/correction_type). `0002_rls_policies.sql` — RLS na każdej tabeli: `user_id = auth.uid()` dla tabel z kolumną `user_id`; `EXISTS`-przez-parent FK dla `detections` (→photos), `book_candidates` (→detections→photos), `shelf_entries` (→books). Projekt zlinkowany (`supabase/.temp/linked-project.json`); migracje **nie zastosowane**.
- **Runtime**: `astro.config.mjs` → `output: 'server'` + `cloudflare()` (bez opcji). `wrangler.jsonc` → `nodejs_compat` włączony, **brak `vars`/secrets bindings**. `worker-configuration.d.ts` (496 KB, generowany przez `wrangler types`) nie typuje jeszcze zmiennych Supabase.
- **Deps obecne**: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `@astrojs/cloudflare`, `wrangler`. Brak deva do testu integracyjnego (sam Vitest jest).
- **Braki**: `src/lib/db/` puste (.gitkeep), brak typu `Database`, brak skryptu `supabase gen types` (`generate-types` = `wrangler types`, nie supabase). `.env.example` ustala nazwy: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Konwencja konfliktowa**: `CLAUDE.md` opisuje `supabase.server.ts` jako *service-role* — świadomie odrzucone (patrz Desired End State / decyzja), bo service-role omija RLS i podkopuje guardrail prywatności.

## Desired End State

Po wykonaniu planu:
- Zdalny zlinkowany projekt ma zastosowane migracje 0001+0002; 8 tabel z włączonym RLS.
- `src/lib/db/database.types.ts` eksportuje typ `Database`; `npm run typecheck` zielony.
- `src/lib/db/supabase.server.ts` i `supabase.browser.ts` dostarczają `SupabaseClient<Database>` egzekwujący RLS (anon key + sesja usera), bez żadnego odwołania do service-role.
- `npm run test:integration` dowodzi: user A nie widzi danych user B (tabela z `user_id` + tabela EXISTS-przez-parent); domyślny `npm run test` pozostaje offline.

**Weryfikacja**: `npx supabase migration list` (oba applied) + `npm run typecheck` + `npm run test:integration` zielone; code review potwierdza brak service-role w `src/lib/db/`.

### Key Discoveries:

- RLS w `0002` pokrywa obie kształty polityk — bezpośrednią (`user_id = auth.uid()`) i przez-parent (`exists (...)`), więc test musi pokryć **oba** kształty, nie jeden (`supabase/migrations/0002_rls_policies.sql:28`, `:89`).
- `nodejs_compat` jest już w `wrangler.jsonc:3` — wymagane dla `@supabase/supabase-js` na Workers.
- Klienty F-01 używają wyłącznie `PUBLIC_*` (URL + anon key), które Vite inline'uje przez `import.meta.env` na build-time → **żadne wiring sekretów/`runtime.env` nie jest potrzebne w F-01** (to dopiero F-02/S-03).
- `@astrojs/cloudflare` dev używa Vite (nie miniflare) — pełny Workers-runtime smoke jest świadomie odłożony do pierwszego endpointu (S-01), zgodnie z decyzją „ściśle substrat".

## What We're NOT Doing

- **Klient service-role / admin** w kodzie aplikacji — odrzucone (omija RLS). Test integracyjny konstruuje admin-klienta *lokalnie, tylko w pliku testu* do tworzenia userów; nie trafia on do `src/lib/db/`.
- **`src/env.d.ts` / typowanie `Astro.locals.runtime.env`** — niepotrzebne, dopóki nie czytamy sekretów server-side → F-02/S-03.
- **Middleware / auth guard, UI logowania, callback** — F-02 (guard) i S-01 (login).
- **Trigger `handle_new_user()` (profiles + półka „Zakupione")** — S-01 / S-02 (FR-008).
- **Endpointy API + response envelope (`src/lib/http/response.ts`)** — F-02.
- **Lokalny stack Supabase (Docker), bucket Storage, seed dla danych domenowych** — odpowiednio: nie używamy; S-03; nie dotyczy.

## Implementation Approach

Trzy fazy w kolejności zależności: najpierw stan bazy + typ (faza 1), potem klienty konsumujące ten typ (faza 2), potem dowód izolacji egzekwowanej przez bazę (faza 3). Każda faza ma automatyczną bramkę (`migration list` / `typecheck` / `test:integration`), więc regresja jest łapana, zanim przejdziemy dalej.

## Critical Implementation Details

- **Kontrakt cookies `@supabase/ssr`**: `createServerClient` wymaga adaptera `cookies: { getAll, setAll }` (aktualny kontrakt; stare `get/set/remove` jest deprecated i psuje odświeżanie sesji). `getAll`/`setAll` bindujemy do `context.cookies` Astro (APIContext / AstroGlobal). To jedyny nieoczywisty fragment wiringu klienta.
- **RLS-scoped = pusto do czasu S-01**: dopóki S-01 nie ustawi sesji (cookie z JWT), server-client działa jako anon i RLS zwraca 0 wierszy. To jest **oczekiwane**, nie bug — test integracyjny dlatego sam loguje userów (`signInWithPassword`), by uzyskać `auth.uid()`.
- **Izolacja testu integracyjnego**: test hituje realny zlinkowany projekt i używa service-role do `auth.admin.createUser` + cleanup. Musi mieć własny config (env `node`, ładowanie `.env.local`) i **nie może** być w domyślnym `npm run test` (jsdom, offline) — inaczej domyślny run staje się zależny od sieci/sekretów (zasada z `CLAUDE.md`: drogie/flaky testy poza domyślnym runem).
- **CLI przez `npx` + bramka wstępna**: `supabase` NIE jest na PATH tej powłoki — wszystkie komendy wołaj jako `npx supabase …` (spójne z `docs/plan-implementacji.md`). **Przed Fazą 1** zweryfikuj `npx supabase --version`; jeśli pada na firewall korporacyjny (binarka z github releases — zob. memory), zainstaluj CLI raz przez VPN/scoop. Same `db push` / `gen types` rozmawiają z DB/management API (nie github), więc po dostępnym CLI firewall ich nie dotyka.

## Phase 1: Migracje zastosowane + typ Database

### Overview

Zastosuj 0001+0002 do zlinkowanego projektu i wygeneruj typ `Database` zasilający typowane klienty.

### Changes Required:

#### 1. Aplikacja migracji (operacja CLI, nie zmiana pliku)

**Intent**: Wypchnąć istniejące migracje do zdalnego zlinkowanego projektu, żeby 8 tabel + RLS istniały w bazie, na której będą stać slice'y.

**Contract**: `npx supabase db push` aplikuje `0001` i `0002` w kolejności. Po operacji `npx supabase migration list` pokazuje oba wpisy jako applied (remote). Brak zmian w plikach migracji.

#### 2. Skrypt generowania typów + plik typu

**File**: `package.json` (scripts) + `src/lib/db/database.types.ts` (nowy, generowany)

**Intent**: Ustanowić powtarzalny pipeline typu `Database` z aktualnego schematu, żeby klienty były typowane bez `any` i odświeżały się po zmianie schematu.

**Contract**: nowy skrypt `db:types` = `npx supabase gen types typescript --linked --schema public > src/lib/db/database.types.ts`. Wygenerowany plik eksportuje `export type Database = { ... }`. Plik jest commitowany (źródło typów dla `astro check`).

### Success Criteria:

#### Automated Verification:

- `npx supabase migration list` pokazuje 0001 i 0002 jako applied na zdalnym projekcie
- `src/lib/db/database.types.ts` istnieje i eksportuje typ `Database`
- `npm run typecheck` (astro check) zielony — 0 błędów

#### Manual Verification:

- W Supabase Studio (zlinkowany projekt) widoczne 8 tabel z włączonym RLS (badge), bez utraty istniejących danych

**Implementation Note**: Po przejściu automatycznej weryfikacji zatrzymaj się na manualne potwierdzenie (Studio), zanim ruszysz fazę 2.

---

## Phase 2: Typowane klienty RLS-respecting

### Overview

Dwa typowane klienty konsumujące typ `Database`, egzekwujące RLS przez anon key + sesję usera. Zero service-role.

### Changes Required:

#### 1. Klient browser

**File**: `src/lib/db/supabase.browser.ts` (nowy)

**Intent**: Klient dla wysp React po stronie przeglądarki, typowany, używający anon key.

**Contract**: eksportuje fabrykę zwracającą `SupabaseClient<Database>` z `@supabase/ssr` `createBrowserClient<Database>(url, anonKey)`. `url`/`anonKey` z `import.meta.env.PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` z guardem rzucającym czytelny błąd przy braku.

#### 2. Klient server (SSR, RLS-respecting)

**File**: `src/lib/db/supabase.server.ts` (nowy)

**Intent**: Request-scoped klient dla stron `.astro` i (później) endpointów API, egzekwujący RLS przez JWT usera z cookies — domyślna ścieżka dostępu do danych per-user.

**Contract**: eksportuje `createServerSupabaseClient(context)` przyjmujący Astro `APIContext`/`AstroGlobal`, zwracający `SupabaseClient<Database>` z `createServerClient<Database>(url, anonKey, { cookies })`. Adapter cookies implementuje `getAll()`/`setAll()` na `context.cookies` Astro. Żadnego odwołania do `SUPABASE_SERVICE_ROLE_KEY`.

```ts
// Szkic kontraktu cookie-adaptera (jedyny nieoczywisty fragment):
cookies: {
  getAll: () => context.cookies.getAll().map(({ name, value }) => ({ name, value })),
  setAll: (toSet) =>
    toSet.forEach(({ name, value, options }) => context.cookies.set(name, value, options)),
}
```

#### 3. Aktualizacja konwencji w CLAUDE.md

**File**: `CLAUDE.md` (sekcja Konwencje > Supabase)

**Intent**: Usunąć rozjazd kod/dok — F-01 świadomie odrzuca service-role na rzecz RLS-respecting, więc konwencja musi to odzwierciedlać, zanim następny agent przeczyta nieaktualny zapis (klasa z `lessons.md`: load-bearing convention detail).

**Contract**: zaktualizuj linię „Typed client: `supabase.server.ts` (service role, tylko w API endpoints)…" na: server client = RLS-respecting (`@supabase/ssr`, anon key + JWT z cookies); service-role wyłącznie w wąskich, wydzielonych ścieżkach privileged, gdy realnie zajdą (nie w F-01).

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony z nowymi klientami (oba zwracają `SupabaseClient<Database>`, bez `any`)
- `npm run lint` zielony na `src/lib/db/**`

#### Manual Verification:

- Code review: żaden plik w `src/lib/db/` nie importuje ani nie odwołuje się do `SUPABASE_SERVICE_ROLE_KEY`
- CLAUDE.md (sekcja Konwencje > Supabase) opisuje server client jako RLS-respecting (`@supabase/ssr`, anon+JWT), nie service-role

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie code-review (brak service-role), zanim ruszysz fazę 3.

---

## Phase 3: Test izolacji RLS (Vitest, integracyjny)

### Overview

Dowód, że RLS egzekwuje izolację per-user — dla obu kształtów polityk — uruchamiany osobno od domyślnego unit runu.

### Changes Required:

#### 1. Osobny config + skrypt integracyjny

**File**: `vitest.integration.config.ts` (nowy) + `package.json` (scripts)

**Intent**: Odseparować testy hitujące realny Supabase od szybkiego offline'owego unit runu (jsdom).

**Contract**: nowy config Vitest z env `node`, `include: ['tests/integration/**']`, ładowaniem `.env.local`. Nowy skrypt `test:integration` = `vitest run --config vitest.integration.config.ts`. Domyślny `vitest.config.ts` **NIE wymaga edycji** — ma już `include: ['tests/unit/**/*.{test,spec}.{ts,tsx}']`, więc `tests/integration/**` jest poza zakresem (kryterium 3.3 spełnione przez istniejącą konfigurację). Faza dodaje wyłącznie osobny config integracyjny.

#### 2. Test izolacji

**File**: `tests/integration/rls.test.ts` (nowy)

**Intent**: Udowodnić cross-user isolation egzekwowaną przez bazę, pokrywając politykę bezpośrednią i przez-parent.

**Contract**: `beforeAll` — admin-klient (service-role, konstruowany lokalnie w teście) tworzy userA i userB (`auth.admin.createUser`, `email_confirm: true`). Test: dla każdego usera anon-klient `signInWithPassword` → RLS-scoped. userA wstawia `shelf` (+ powiązany rekord do tabeli EXISTS-przez-parent, np. `book` i `shelf_entry`). Asercje: userB `select` na `shelves`/`shelf_entries` zwraca 0 wierszy danych A; userA widzi własne. `afterAll` — `auth.admin.deleteUser` dla obu (cascade czyści dane). Test skipuje z czytelnym komunikatem, gdy brak `SUPABASE_SERVICE_ROLE_KEY`/URL.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` zielony: userA widzi własną półkę, userB dostaje 0 wierszy dla danych A (tabela `shelves`, polityka `user_id`)
- Ten sam przebieg potwierdza izolację dla tabeli EXISTS-przez-parent (`shelf_entries` lub `detections`)
- Domyślny `npm run test` (jsdom unit) NIE odpala testu integracyjnego i pozostaje zielony/offline

#### Manual Verification:

- Po przebiegu testu zlinkowany projekt nie zawiera userów-śmieci (cleanup zadziałał — sprawdź `auth.users` w Studio)

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się na potwierdzenie cleanupu (Studio) — to ostatnia bramka F-01.

---

## Testing Strategy

### Unit Tests:

- Brak nowych unit testów w F-01 (substrat nie ma czystej logiki do izolowanego testu jednostkowego; matching/dedupe/isbn dostaną unit testy w M2).

### Integration Tests:

- `tests/integration/rls.test.ts` — cross-user isolation dla polityki bezpośredniej (`shelves`) i przez-parent (`shelf_entries`/`detections`); setup/teardown przez admin API z cleanupem.

### Manual Testing Steps:

1. Po `db push`: w Studio potwierdź 8 tabel + RLS enabled.
2. Po fazie 3: w Studio potwierdź brak userów-śmieci w `auth.users`.

## Performance Considerations

Nie dotyczy substratu. NFR `p95 < 1 s` na widokach nawigacji jest egzekwowany przy slice'ach czytających katalog (S-06/S-08); indeksy pod te zapytania już są w `0001` (`*_user_id_idx`).

## Migration Notes

`npx supabase db push` jest addytywne (same `create table`/`create policy`). Zakładamy, że zlinkowany projekt nie ma kolidującego stanu z poprzednich prób; jeśli `push` zgłosi konflikt, zweryfikuj `npx supabase migration list` przed jakimkolwiek `db reset` (reset jest destrukcyjny — nie używać na projekcie z danymi demo).

## References

- Roadmap slice: `context/foundation/roadmap.md` (F-01)
- Migracje: `supabase/migrations/0001_initial_schema.sql`, `supabase/migrations/0002_rls_policies.sql`
- Konwencje Supabase/Workers: `CLAUDE.md` (sekcje "Cloudflare adapter", "Supabase")
- Guardrail prywatności + RLS: `context/foundation/prd.md` (§ Guardrails, FR-003)
- Enforcement-by-code prior: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migracje zastosowane + typ Database

#### Automated

- [x] 1.1 `npx supabase migration list` pokazuje 0001 i 0002 jako applied na zdalnym projekcie — 83bea67
- [x] 1.2 `src/lib/db/database.types.ts` istnieje i eksportuje typ `Database` — 83bea67
- [x] 1.3 `npm run typecheck` (astro check) zielony — 0 błędów — 83bea67

#### Manual

- [x] 1.4 W Supabase Studio widoczne 8 tabel z włączonym RLS, bez utraty istniejących danych — 83bea67

### Phase 2: Typowane klienty RLS-respecting

#### Automated

- [x] 2.1 `npm run typecheck` zielony z nowymi klientami (oba zwracają `SupabaseClient<Database>`, bez `any`)
- [x] 2.2 `npm run lint` zielony na `src/lib/db/**`

#### Manual

- [x] 2.3 Code review: żaden plik w `src/lib/db/` nie odwołuje się do `SUPABASE_SERVICE_ROLE_KEY`
- [x] 2.4 CLAUDE.md (Konwencje > Supabase) opisuje server client jako RLS-respecting, nie service-role

### Phase 3: Test izolacji RLS (Vitest, integracyjny)

#### Automated

- [ ] 3.1 `npm run test:integration` zielony: userA widzi własną półkę, userB dostaje 0 wierszy dla danych A (tabela `shelves`, polityka `user_id`)
- [ ] 3.2 Ten sam przebieg potwierdza izolację dla tabeli EXISTS-przez-parent (`shelf_entries` lub `detections`)
- [ ] 3.3 Domyślny `npm run test` (jsdom) nie odpala testu integracyjnego i pozostaje zielony/offline

#### Manual

- [ ] 3.4 Po przebiegu testu brak userów-śmieci w `auth.users` (cleanup zadziałał)
