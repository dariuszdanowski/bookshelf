# Limity budżetu AI-resolution per-profil — Plan implementacji

## Przegląd

Dziś `AI_RESOLUTION_BUDGET_LIMITS` (`src/lib/resolution/budgetPolicy.ts:4-8`) to trzy stałe
globalne, identyczne dla każdego użytkownika: `maxCallsPerPhoto: 3`, `maxCallsPerUserAction: 1`
(dziś martwy — zob. niżej), `maxCallsPerDay: 20`. Ten plan przenosi dwie z nich
(`maxCallsPerPhoto`, `maxCallsPerDay`) na kolumny w `profiles`, edytowalne self-service przez
użytkownika na `/account`, z zachowaniem dzisiejszych wartości jako domyślnych. Dodatkowo:
możliwość przywrócenia wartości domyślnych, wskaźnik dzisiejszego zużycia i miękki reset tego
licznika — bez naruszania append-only tabeli audytowej `resolution_calls`.

## Analiza stanu obecnego

- `AI_RESOLUTION_BUDGET_LIMITS` (`src/lib/resolution/budgetPolicy.ts:4-8`) — stałe modułowe.
  `isAiResolutionBudgetAvailable` (`:15-20`) sprawdza `callsForPhoto`/`callsForDay` przeciw tej
  stałej; `maxCallsPerUserAction` (`:6`) nie ma dziś żadnego call-site poza własną definicją —
  potwierdzone grepem w całym `src/`.
- `POST /api/detections/[id]/resolve` (`src/pages/api/detections/[id]/resolve.ts`) — linia
  49-53 robi jedno query do `profiles` (dziś tylko `ai_enabled`, guard `AI_DISABLED`); linie
  109-135 liczą równolegle `dayCountResult`/`photoCountResult` z `resolution_calls` (filtr
  `.gte('created_at', todayStartUtc)` dla dnia, `.eq('photo_id', ...)` dla zdjęcia) i wołają
  `isAiResolutionBudgetAvailable` z domyślną stałą; błąd 429 (`RESOLUTION_BUDGET_EXCEEDED`,
  linia 136-142) ma dziś generyczny komunikat bez liczb.
- `DetectionReview.tsx:534-537` konsumuje ten błąd wyłącznie po statusie HTTP 429 i renderuje
  `json.error?.message` bez zmian — wzbogacenie treści w `resolve.ts` **nie wymaga** żadnej
  zmiany we froncie.
- `/account` (`src/pages/account.astro`) — SSR pobiera dziś `profile.display_name` (linia
  10-16) i przekazuje do jedynej wyspy `AccountIsland.tsx` (1129 linii, sekcje: Profil / Email
  / Hasło / Koszty analizy / Klucze API).
- `PATCH /api/account/profile` (`src/pages/api/account/profile.ts`) + `UpdateProfileSchema`
  (`src/lib/account/schema.ts:14-16`) — dziś jedyne, **wymagane** pole `display_name`.
- Precedens formularza z polami liczbowymi już istnieje: sekcja "Klucze API" w
  `AccountIsland.tsx` — `request_timeout_ms`/`max_tokens_override`, `type="number" min={1}`,
  wartości trzymane jako string w stanie i konwertowane `Number(...)` dopiero przy submicie
  (`:380-387` `handleSaveEdit`, `:751-789` dodawanie, `:929-960` edycja).
- `database.types.ts` jest plikiem **commitowanym** (nie gitignored — `git check-ignore` exit
  1), nie generowanym on-demand w tym branchu. Kolumna `ai_enabled` jest tam ręcznie wpisana w
  `Row`/`Insert`/`Update` typu `profiles` (`:348-370`) — nowe kolumny idą tym samym torem, bez
  zależności od żywej DB / `supabase gen types` (analogicznie do lekcji o `Database.Functions`
  będącej `never` bez regeneracji — kolumny różnią się od funkcji/RPC tym, że da się je dopisać
  ręcznie w prostym, płaskim typie).
- `tests/unit/pages/api/detections/resolve.test.ts` — `makeSupabase()` mockuje `profiles.select`
  zwracając stały obiekt `{ ai_enabled: aiEnabled }`, bez nowych pól. Kod musi być odporny na
  `undefined` dla nowych pól (fallback do stałej `AI_RESOLUTION_BUDGET_LIMITS`), inaczej
  wszystkie dotychczasowe testy tego pliku zaczęłyby cicho blokować budżet (`undefined` w
  porównaniu `count < undefined` jest zawsze `false`).
- `tests/unit/components/AccountIsland.test.tsx` — 16 wywołań `render(<AccountIsland .../>)`,
  żadne nie przekazuje przyszłych nowych propsów.
- Migracje: najwyższy numer na `origin/main` to `0031` (zweryfikowane `git ls-tree origin/main`
  — zgodnie z lekcją "sprawdź max numer na main"), więc kolejny wolny to `0032`.
- Konwencja RLS: `profiles_update_own` (`supabase/migrations/0002_rls_policies.sql:9`) już
  pokrywa `update` na `id = auth.uid()` — nowe kolumny nie wymagają nowej polityki.
- Precedensy migracji dodających kolumny do `profiles`: `0014_profiles_admin_ai.sql` (`ai_enabled`,
  `is_admin`), `0023_profiles_soft_delete.sql`, `0025_profiles_is_technical.sql`.

## Pożądany stan końcowy

Użytkownik widzi na `/account` nową sekcję "Limity AI-resolution" z: dwoma edytowalnymi polami
liczbowymi (limit dzienny, limit na zdjęcie), przyciskiem zapisu, przyciskiem "Przywróć
domyślne", wskaźnikiem dzisiejszego zużycia ("X / Y dzisiaj") i przyciskiem resetu tego
licznika. Backend liczy budżet AI-resolution względem wartości z profilu użytkownika (fallback
do 3/20 gdy profil ich jeszcze nie ma — nie powinno się zdarzyć po migracji, ale chroni testy i
edge-case). Komunikat 429 pokazuje realne liczby i limit, który je spowodował. Zero zmiany
zachowania dla użytkowników, którzy nigdy nie dotkną nowych pól — defaulty identyczne jak dziś.

### Kluczowe odkrycia:

- `maxCallsPerUserAction` jest dziś martwy — decyzja: zostaje wewnętrzny, nie trafia do
  `profiles`/UI (zob. Otwarte pytania w dokumencie źródłowym, rozstrzygnięte podczas planu).
- Wzbogacenie komunikatu 429 nie wymaga zmian w `DetectionReview.tsx` — front już przepuszcza
  `message` z API bez interpretacji treści.
- `database.types.ts` wymaga ręcznej edycji (nie regeneracji) — commitowany plik, wzorzec
  `ai_enabled` już istnieje.

## Czego NIE robimy

- Nie wystawiamy `maxCallsPerUserAction` jako konfigurowalnego pola — zostaje wewnętrzną stałą
  w `budgetPolicy.ts`, bez kolumny w `profiles`.
- Nie usuwamy ani nie modyfikujemy wierszy w `resolution_calls` — audyt zostaje w pełni
  nienaruszony (append-only), reset licznika działa przez okno czasowe, nie przez dane.
- Nie pokazujemy wskaźnika zużycia "na zdjęcie" na `/account` — ma sens tylko w kontekście
  konkretnego zdjęcia (widoku detekcji), nie na stronie ustawień profilu.
- Nie zmieniamy `DetectionReview.tsx` — patrz Kluczowe odkrycia.
- Nie tworzymy nowego dedykowanego endpointu dla samych wartości limitów — rozszerzamy
  istniejący `PATCH /api/account/profile`. Akcja resetu licznika dostaje własny, mały endpoint,
  bo to akcja (efekt uboczny: ustawienie znacznika czasu), nie deklaratywna wartość pola.

## Podejście do implementacji

Cztery fazy idące od fundamentu w górę: (1) DB + czysta logika budżetu (testowalna w izolacji,
zero zależności od HTTP/UI), (2) backend API konsumujący tę logikę, (3) UI konsumujący backend,
(4) E2E spinający całość + weryfikacja ręczna. Każda faza ma własne testy jednostkowe, dzięki
czemu fazy 2-3 mogą polegać na już zweryfikowanym fundamencie zamiast retestować go pośrednio.

## Krytyczne szczegóły implementacji

- **Fallback dla brakujących/`null` pól profilu w `resolve.ts`**: wartości limitów z `profiles`
  muszą przechodzić przez `?? AI_RESOLUTION_BUDGET_LIMITS.maxCallsPerX` przed przekazaniem do
  `isAiResolutionBudgetAvailable`. Bez tego dzisiejszy mock `profiles.select` w
  `resolve.test.ts` (zwraca tylko `{ ai_enabled }`) sprawiłby, że WSZYSTKIE istniejące testy
  tego pliku zaczęłyby fałszywie blokować budżet — nie przez błąd kompilacji, tylko przez cichą
  zmianę zachowania w runtime.
- **Nowe propsy `AccountIsland` muszą być opcjonalne z defaultami** (3 / 20 / 0) — 16 istniejących
  `render(<AccountIsland .../>)` w `AccountIsland.test.tsx` nie przekazuje ich; wymuszenie
  wymaganych propsów oznaczałoby dotknięcie wszystkich 16 wywołań bez żadnej wartości
  dodanej dla tych testów.
- **`UpdateProfileSchema` przechodzi z "wymagane `display_name`" na "partial update"** — każde
  pole `.optional()`, plus `.refine` wymagające co najmniej jednego pola (żeby pusty `{}` nie
  przechodził jako no-op 200). Endpoint buduje `.update({...})` tylko z podanych kluczy. Sekcja
  "AI-resolution" na `/account` będzie zapisywać PATCH-em zawierającym wyłącznie dwa nowe pola
  (bez `display_name`) — dzisiejsze testy zawsze wysyłają `display_name`, więc nie są zagrożone,
  ale nowa ścieżka musi działać bez niego.
- **Wspólny helper okna czasowego** (`effectiveDailyWindowStart`) w `budgetPolicy.ts`, używany
  zarówno przez `resolve.ts` (liczenie budżetu) jak i `account.astro` (wskaźnik dzisiejszego
  zużycia) — unika zdublowania logiki "dzień zaczyna się o północy UTC, chyba że user zresetował
  licznik później" w dwóch miejscach.
- **Reset licznika nie kasuje `resolution_calls`** — ustawia `profiles.ai_resolution_daily_reset_at
  = now()`; okno liczenia dnia to `max(dzisiejsza północ UTC, ai_resolution_daily_reset_at)`.
  Następnego dnia północ UTC jest zawsze późniejsza niż wczorajszy reset, więc mechanizm
  samo-czyści się bez TTL/joba czyszczącego.
- **CHECK constraint jako defense-in-depth**: Zod blokuje wartości poza zakresem przed zapisem,
  ale kolumny dostają też `check (... between 1 and N)` w SQL — zgodnie z konwencją repo
  (triple guard Zod + UI + DB). Endpoint musi mapować SQLSTATE `23514` (check_violation) → 400
  `VALIDATION_ERROR`, obok istniejących `23505`/`23503`/`P0001`/`PGRST116`.

## Faza 1: Fundament DB + czysta logika budżetu

### Przegląd

Nowe kolumny w `profiles`, ręczna aktualizacja typów, parametryzacja
`isAiResolutionBudgetAvailable` i nowy helper okna czasowego — wszystko testowalne bez HTTP/UI.

### Wymagane zmiany:

#### 1. Migracja

**Plik**: `supabase/migrations/0032_profiles_resolution_budget.sql`

**Cel**: Dodać dwie kolumny limitów (z dzisiejszymi wartościami jako default, więc zero zmiany
zachowania dla istniejących wierszy) + kolumnę znacznika miękkiego resetu dziennego licznika.

**Kontrakt**:
```sql
alter table public.profiles
  add column if not exists ai_resolution_max_calls_per_photo int not null default 3,
  add column if not exists ai_resolution_max_calls_per_day int not null default 20,
  add column if not exists ai_resolution_daily_reset_at timestamptz;

alter table public.profiles
  add constraint profiles_ai_resolution_max_calls_per_photo_range
  check (ai_resolution_max_calls_per_photo between 1 and 10),
  add constraint profiles_ai_resolution_max_calls_per_day_range
  check (ai_resolution_max_calls_per_day between 1 and 100);
```
Bez zmian RLS (`profiles_update_own` już pokrywa update własnego wiersza).

#### 2. Typy TypeScript

**Plik**: `src/lib/db/database.types.ts`

**Cel**: Ręcznie dopisać trzy nowe pola do `profiles.Row`/`Insert`/`Update`, analogicznie do
istniejącego `ai_enabled` (`:348-370`). Ten plik jest commitowany, nie regenerowany w branchu —
brak zależności od żywej DB.

**Kontrakt**: `ai_resolution_max_calls_per_photo: number` (Row/Update wymagane bo `not null
default`, `Insert` opcjonalne), analogicznie `ai_resolution_max_calls_per_day: number`,
`ai_resolution_daily_reset_at: string | null` (Row/Update/Insert wszystkie opcjonalne/nullable).

#### 3. Logika budżetu

**Plik**: `src/lib/resolution/budgetPolicy.ts`

**Cel**: (a) `isAiResolutionBudgetAvailable` przyjmuje limity jako parametr z domyślną
wartością równą dzisiejszej stałej — zero zmiany zachowania dla istniejących wywołań bez
drugiego argumentu. (b) Nowy helper liczący efektywny początek "dzisiaj" z uwzględnieniem
miękkiego resetu.

**Kontrakt**:
```ts
export type AiResolutionBudgetLimits = { maxCallsPerPhoto: number; maxCallsPerDay: number };

export function isAiResolutionBudgetAvailable(
  state: AiResolutionBudgetState,
  limits: AiResolutionBudgetLimits = AI_RESOLUTION_BUDGET_LIMITS,
): boolean { ... }

export function effectiveDailyWindowStart(now: Date, resetAt: string | null): Date {
  const todayStartUtc = new Date(now);
  todayStartUtc.setUTCHours(0, 0, 0, 0);
  if (!resetAt) return todayStartUtc;
  const reset = new Date(resetAt);
  return reset > todayStartUtc ? reset : todayStartUtc;
}
```
`AI_RESOLUTION_BUDGET_LIMITS` zostaje niezmieniona (nadal zawiera `maxCallsPerUserAction`, tylko
teraz jako jedyny konsument-fallback dla `maxCallsPerPhoto`/`maxCallsPerDay` i wewnętrzna stała
dla parametru, który nie ma kolumny).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx supabase migration up` (lokalny stack, jeśli dostępny) lub walidacja SQL składniowo —
  migracja stosuje się czysto
- `npm run typecheck` przechodzi z nowymi polami w `database.types.ts`
- Testy jednostkowe przechodzą: `npx vitest run tests/unit/lib/resolution/budgetPolicy.test.ts`
  — istniejące testy bez zmian (default param) + nowe: `isAiResolutionBudgetAvailable` z custom
  `limits` (niższy/wyższy niż default), `effectiveDailyWindowStart` (brak resetu → dzisiejsza
  północ; reset sprzed dzisiejszej północy → ignorowany; reset po dzisiejszej północy →
  honorowany)
- `npm run lint` przechodzi

#### Weryfikacja ręczna:

- (brak — czysta logika bez UI, w pełni pokryta automatami)

---

## Faza 2: Backend API

### Przegląd

Endpoint zapisu limitów (rozszerzenie istniejącego), nowy endpoint resetu licznika, i
konsumpcja per-profilowych limitów w `resolve.ts` z wzbogaconym komunikatem błędu.

### Wymagane zmiany:

#### 1. Schema walidacji profilu

**Plik**: `src/lib/account/schema.ts`

**Cel**: `UpdateProfileSchema` przechodzi z pojedynczego wymaganego pola na partial update z
dwoma nowymi opcjonalnymi polami budżetu, z granicami dopasowanymi do CHECK constraints z Fazy 1.

**Kontrakt**:
```ts
export const UpdateProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(100).optional(),
    ai_resolution_max_calls_per_photo: z.number().int().min(1).max(10).optional(),
    ai_resolution_max_calls_per_day: z.number().int().min(1).max(100).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Podaj co najmniej jedno pole do aktualizacji.',
  });
```

#### 2. Endpoint profilu

**Plik**: `src/pages/api/account/profile.ts`

**Cel**: `.update()` przyjmuje tylko podane klucze (partial), `.select()` zwraca też nowe pola,
mapowanie `23514` (check_violation) → 400 `VALIDATION_ERROR` obok istniejącego `PGRST116` → 404.

**Kontrakt**: `.update()` przekazuje wszystkie trzy pola wprost z `parsed.data` — `{ display_name:
parsed.data.display_name, ai_resolution_max_calls_per_photo:
parsed.data.ai_resolution_max_calls_per_photo, ai_resolution_max_calls_per_day:
parsed.data.ai_resolution_max_calls_per_day }`. `supabase-js` serializuje body przez
`JSON.stringify`, który pomija klucze o wartości `undefined` — Zod `.optional()` daje dokładnie
`undefined` dla pominiętych pól, więc to już jest poprawny partial update bez dodatkowej logiki
filtrującej klucze. Response `{ data: { profile: { id, display_name,
ai_resolution_max_calls_per_photo, ai_resolution_max_calls_per_day } } }` — istniejący konsument
(`handleSaveDisplayName` w `AccountIsland.tsx`) czyta tylko `.display_name`, więc dodatkowe pola
są dla niego przezroczyste.

#### 3. Nowy endpoint resetu licznika

**Plik**: `src/pages/api/account/reset-resolution-usage.ts`

**Cel**: Akcja (nie deklaratywne pole) — ustawia `ai_resolution_daily_reset_at = now()` dla
zalogowanego użytkownika, server-side timestamp (nigdy z body — unika spoofingu/clock-skew).

**Kontrakt**: `POST`, brak body. `401` gdy niezalogowany. Sukces: `{ data: { reset_at: string } }`.
`.update({ ai_resolution_daily_reset_at: new Date().toISOString() }).eq('id',
locals.user.id).select('ai_resolution_daily_reset_at').single()`; błąd DB → 500 `INTERNAL_ERROR`.

#### 4. Konsumpcja per-profilowych limitów w resolve.ts

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: Rozszerzyć istniejące query profilu (linia 49-53) o trzy nowe kolumny (jeden
round-trip, bez dodatkowego zapytania), użyć `effectiveDailyWindowStart` zamiast dzisiejszego
ręcznego liczenia `todayStartUtc` w filtrze `resolution_calls`, przekazać limity (z fallbackiem
`??`) do `isAiResolutionBudgetAvailable`, wzbogacić komunikat błędu 429 o realne liczby.

**Kontrakt**: `.select('ai_enabled, ai_resolution_max_calls_per_photo,
ai_resolution_max_calls_per_day, ai_resolution_daily_reset_at')`. Filtr dzienny:
`.gte('created_at', effectiveDailyWindowStart(new Date(), profile.ai_resolution_daily_reset_at).toISOString())`.
Komunikat 429: `` `Osiągnięto Twój limit AI-resolution (dziennie: ${dayCount}/${maxCallsPerDay},
na zdjęcie: ${photoCount}/${maxCallsPerPhoto}). Zmień limit na /account.` `` — patrz Krytyczne
szczegóły implementacji dla fallbacku `??` wymaganego, żeby dzisiejszy test mock nie zaczął
fałszywie blokować budżetu.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx vitest run tests/unit/pages/api/account/profile.test.ts` — istniejące testy bez zmian +
  nowe: partial update tylko z polami budżetu (bez `display_name`), odrzucenie wartości poza
  zakresem (Zod → 400 przed dotarciem do DB), mapowanie `23514` → 400 `VALIDATION_ERROR`
- `npx vitest run tests/unit/pages/api/account/reset-resolution-usage.test.ts` (nowy plik) —
  200 + `reset_at` w odpowiedzi, 401 niezalogowany, 500 na błąd DB
- `npx vitest run tests/unit/pages/api/detections/resolve.test.ts` — istniejące testy bez zmian
  (fallback `??` chroni mock bez nowych pól) + nowe: custom limity z profilu respektowane
  (niższy/wyższy niż default), komunikat 429 zawiera realne liczby, reset_at w przeszłości
  ignorowany, reset_at po dzisiejszej północy zawęża okno liczenia
- `npm run typecheck` i `npm run lint` przechodzą

#### Weryfikacja ręczna:

- (odroczona do Fazy 4 — pełny flow wymaga UI do wygenerowania żądań)

---

## Faza 3: UI /account

### Przegląd

Nowa sekcja w `AccountIsland.tsx` konsumująca endpointy z Fazy 2, z wzorcem identycznym do
istniejących sekcji (inline error/success, brak toastów).

### Wymagane zmiany:

#### 1. SSR fetch limitów i zużycia

**Plik**: `src/pages/account.astro`

**Cel**: Rozszerzyć istniejące query profilu o nowe kolumny + policzyć dzisiejsze zużycie
(reużywając `effectiveDailyWindowStart` z Fazy 1, ta sama logika co w `resolve.ts` — bez
duplikacji), przekazać jako nowe propsy wyspy.

**Kontrakt**: `select('display_name, ai_resolution_max_calls_per_photo,
ai_resolution_max_calls_per_day, ai_resolution_daily_reset_at')` + osobne query
`count` na `resolution_calls` z `.eq('user_id', user.id).gte('created_at',
effectiveDailyWindowStart(...))` — `.eq('user_id', ...)` explicite obok RLS, zgodnie z istniejącym
stylem repo (belt-and-suspenders, tak jak `resolve.ts:116` i profile query wyżej w tym samym
pliku). Nowe propsy: `initialMaxCallsPerPhoto: number`, `initialMaxCallsPerDay: number`,
`initialUsageToday: number`.

#### 2. Nowa sekcja w AccountIsland

**Plik**: `src/components/AccountIsland.tsx`

**Cel**: Sekcja "Limity AI-resolution" wzorowana na sekcji "Profil" (`:421-464`) i na wzorcu
pól liczbowych z sekcji "Klucze API" (string-w-stanie, `Number(...)` przy submicie). Zawiera:
dwa pola liczbowe, przycisk "Zapisz", przycisk "Przywróć domyślne" (czysto client-side —
wypełnia pola wartościami 3/20, user musi jeszcze kliknąć "Zapisz"), wskaźnik "X / Y dzisiaj",
przycisk "Wyzeruj dzisiejszy licznik" (woła nowy endpoint, po sukcesie aktualizuje wskaźnik na
0 lokalnie).

**Kontrakt**: Nowe propsy w `Props` **opcjonalne** z defaultami w destrukturyzacji (`= 3`, `=
20`, `= 0`) — nie dotykać istniejących 16 wywołań `render(<AccountIsland .../>)` w testach.
Zapis limitów PATCH-uje `/api/account/profile` z body `{ ai_resolution_max_calls_per_photo,
ai_resolution_max_calls_per_day }` (bez `display_name`). Reset licznika: `POST
/api/account/reset-resolution-usage`, sukces → `setUsageToday(0)`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx vitest run tests/unit/components/AccountIsland.test.tsx` — istniejące 16 testów bez
  zmian (defaulty propsów) + nowe: render z initial values, zapis limitów (sukces + walidacja
  klient-side poza zakresem), "Przywróć domyślne" resetuje pola bez fetcha, "Wyzeruj licznik"
  woła endpoint i aktualizuje wskaźnik
- `npm run typecheck`, `npm run lint`, `npm run build` przechodzą

#### Weryfikacja ręczna:

- Otwórz `/account`, zmień limit dzienny na np. 5, zapisz, odśwież stronę — wartość
  persystuje
- Kliknij "Przywróć domyślne" — pola wracają do 3/20 bez zapisu; zmiana widoczna dopiero po
  kliknięciu "Zapisz"
- Kliknij "Wyzeruj dzisiejszy licznik" — wskaźnik zużycia spada do 0
- Wprowadź wartość poza zakresem (np. 999) — komunikat walidacji, brak zapisu

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych
weryfikacji, zatrzymaj się tutaj po ręczne potwierdzenie przed przejściem do Fazy 4.

---

## Faza 4: E2E i pełna weryfikacja

### Przegląd

Rozszerzenie E2E o nowy scenariusz spinający cały flow, pełny przebieg automatów, ręczny smoke.

### Wymagane zmiany:

#### 1. E2E

**Plik**: `tests/e2e/account.spec.ts`

**Cel**: Nowy scenariusz (lub rozszerzenie istniejącego describe) pokrywający: edycja limitu →
zapis → reload strony → wartość persystuje; "Przywróć domyślne"; "Wyzeruj licznik" (mock
`resolution_calls` przez `page.route` lub realny licznik = 0 na świeżym koncie testowym, zgodnie
z istniejącą konwencją izolacji testowego usera w tym pliku).

**Kontrakt**: Lokatory przez `getByTestId` zgodnie z konwencją `tests/e2e/AGENTS.md`; predykat
pathname w `page.route`, nie glob-string (lekcja repo).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`
- `npm run typecheck`
- `npx vitest run` (pełna suita jednostkowa)
- `npm run test:e2e` (lub `npx playwright test tests/e2e/account.spec.ts` lokalnie na WSL,
  pełna suita w CI)
- `npm run build`

#### Weryfikacja ręczna:

- Pełny smoke na `/account`: sekcja widoczna, wartości poprawne, zapis/reset/przywróć
  domyślne działają wizualnie zgodnie z resztą strony (spójny styl, brak regresji w innych
  sekcjach)
- Wywołanie AI-resolution po obniżeniu limitu do 1 i dwukrotnej próbie — drugi request zwraca
  429 z komunikatem zawierającym realne liczby (widoczne w `DetectionReview`)

---

## Strategia testowania

### Testy jednostkowe:

- `budgetPolicy.ts`: parametryzowany `isAiResolutionBudgetAvailable` (default + custom limity),
  `effectiveDailyWindowStart` (brak resetu / reset przeszły / reset przyszły względem dzisiejszej
  północy)
- `account/schema.ts` (pośrednio przez `profile.test.ts`): partial update, granice Zod
- `profile.ts`: partial update bez `display_name`, mapowanie `23514`
- `reset-resolution-usage.ts`: nowy plik testowy, happy path + 401 + 500
- `resolve.ts`: fallback do defaultów gdy profil nie ma nowych pól (regresja dla dzisiejszego
  mocka), custom limity respektowane, treść komunikatu 429
- `AccountIsland.tsx`: nowa sekcja — render, zapis, przywróć domyślne, reset licznika

### Testy integracyjne:

- Brak nowych — zmiana nie dotyka RLS w sposób wymagający nowego testu integracyjnego
  (`profiles_update_own` już istnieje i jest pokryta).

### Kroki testowania ręcznego:

1. Zaloguj się, wejdź na `/account`, zweryfikuj że nowa sekcja pokazuje 3/20 jako wartości
   domyślne dla świeżego konta.
2. Zmień limit dzienny na 1, zapisz, wywołaj AI-resolution dla detekcji bez kandydatów,
   następnie spróbuj ponownie tego samego dnia — drugi request powinien dostać 429 z komunikatem
   pokazującym `1/1`.
3. Kliknij "Wyzeruj dzisiejszy licznik" — kolejna próba AI-resolution powinna znowu się udać.
4. Kliknij "Przywróć domyślne" bez zapisywania — odśwież stronę — wartości powinny wrócić do
   tego, co było ostatnio zapisane (nie do 3/20), bo przywrócenie bez zapisu jest tylko
   lokalną zmianą formularza.

## Uwagi dotyczące wydajności

Brak nowych zapytań o istotnym koszcie — jeden dodatkowy COUNT na `/account` (SSR, raz na
załadowanie strony) i trzy dodatkowe kolumny w już istniejącym query profilu w `resolve.ts`
(zero dodatkowych round-tripów).

## Uwagi dotyczące migracji

`ALTER TABLE ... ADD COLUMN ... DEFAULT` backfilluje istniejące wiersze automatycznie — zero
ręcznej migracji danych. Brak potrzeby TTL/joba czyszczącego dla `ai_resolution_daily_reset_at`
(mechanizm samo-czyści się przez porównanie z dzisiejszą północą UTC, zob. Krytyczne szczegóły
implementacji).

## Referencje

- Propozycja źródłowa: `modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md`
  (Propozycja 7)
- Precedens migracji kolumn profilu: `supabase/migrations/0014_profiles_admin_ai.sql`
- Precedens formularza z polami liczbowymi: `src/components/AccountIsland.tsx:751-789,929-960`
- Precedens partial-update + CHECK constraint mapping: `CLAUDE.md` § Konwencje → API endpoints

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków.

### Faza 1: Fundament DB + czysta logika budżetu

#### Automatyczne

- [x] 1.1 Migracja stosuje się czysto — 16f929b
- [x] 1.2 Typecheck przechodzi z nowymi polami w database.types.ts — 16f929b
- [x] 1.3 Testy jednostkowe budgetPolicy.test.ts przechodzą (istniejące + nowe) — 16f929b
- [x] 1.4 Lint przechodzi — 16f929b

### Faza 2: Backend API

#### Automatyczne

- [x] 2.1 Testy jednostkowe profile.test.ts przechodzą (istniejące + nowe) — 719bd99
- [x] 2.2 Testy jednostkowe reset-resolution-usage.test.ts przechodzą (nowy plik) — 719bd99
- [x] 2.3 Testy jednostkowe resolve.test.ts przechodzą (istniejące + nowe) — 719bd99
- [x] 2.4 Typecheck i lint przechodzą — 719bd99

### Faza 3: UI /account

#### Automatyczne

- [x] 3.1 Testy jednostkowe AccountIsland.test.tsx przechodzą (istniejące 16 + nowe) — fdb1229
- [x] 3.2 Typecheck, lint, build przechodzą — fdb1229

#### Ręczne

- [x] 3.3 Zmiana limitu na /account persystuje po odświeżeniu — fdb1229
- [x] 3.4 "Przywróć domyślne" resetuje pola bez zapisu — fdb1229
- [x] 3.5 "Wyzeruj dzisiejszy licznik" zeruje wskaźnik zużycia — fdb1229
- [x] 3.6 Wartość poza zakresem pokazuje walidację i blokuje zapis — fdb1229

### Faza 4: E2E i pełna weryfikacja

#### Automatyczne

- [x] 4.1 Lint zielony — 8a1489e
- [x] 4.2 Typecheck zielony — 8a1489e
- [x] 4.3 Pełna suita Vitest zielona (1280/1280) — 8a1489e
- [x] 4.4 Playwright account.spec.ts zielony (8/8, w tym 3 nowe); pełna suita lokalnie ma 37 pre-existing failures w niezwiązanych plikach (bbox/purchase/refine) — zgodnie z kontraktem fazy walidacja pełnej suity odroczona do CI (efemeryczny stack) — 8a1489e
- [x] 4.5 Build przechodzi — 8a1489e

#### Ręczne

- [ ] 4.6 Pełny smoke wizualny na /account bez regresji w innych sekcjach
- [ ] 4.7 429 po wyczerpaniu obniżonego limitu pokazuje realne liczby w DetectionReview
