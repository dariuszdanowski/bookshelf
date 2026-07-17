# Usunięcie blokady AI-resolution per-zdjęcie + licznik prób — Plan implementacji

## Przegląd

`ai-resolution-budget-per-profile` (PR #171, zmergowany) wprowadził dwa niezależne limity:
dzienny (`ai_resolution_max_calls_per_day`) i per-zdjęcie (`ai_resolution_max_calls_per_photo`,
liczony **all-time** bez okna czasowego, bez żadnego mechanizmu resetu). Manualna weryfikacja
ujawniła, że per-zdjęciowa blokada jest permanentna i nieodwracalna — jedyny workaround to
podniesienie profilowego limitu, co osłabia ochronę kosztową dla WSZYSTKICH zdjęć usera. Właściciel
repo zdecydował: usunąć blokadę per-zdjęcie całkowicie (zostaje wyłącznie dzienny limit jako
guardrail kosztowy), ale zachować **widoczność** liczby prób AI-resolution dla danego zdjęcia —
informacyjnie, bez wpływu na dostępność funkcji.

## Analiza stanu obecnego

- `src/pages/api/detections/[id]/resolve.ts:115-156` — liczy RÓWNOLEGLE `dayCountResult` (okno
  `effectiveDailyWindowStart`) i `photoCountResult` (`.eq('photo_id', ...)`, **bez** filtra
  czasowego — all-time count). `isAiResolutionBudgetAvailable` (linia 146-148) blokuje, gdy
  KTÓRYKOLWIEK z dwóch limitów jest wyczerpany. Komunikat 429 (linia 152-155) wymienia oba liczniki.
- `src/lib/resolution/budgetPolicy.ts` — `AI_RESOLUTION_BUDGET_LIMITS` ma trzy pola:
  `maxCallsPerPhoto: 3`, `maxCallsPerUserAction: 1` (martwy, poza zakresem tej zmiany — zostaje
  bez zmian), `maxCallsPerDay: 20`. `isAiResolutionBudgetAvailable(state, limits)` sprawdza oba
  `callsForPhoto < limits.maxCallsPerPhoto && callsForDay < limits.maxCallsPerDay`.
  `AiResolutionBudgetState` = `{ callsForPhoto, callsForDay }`, `AiResolutionBudgetLimits` =
  `{ maxCallsPerPhoto, maxCallsPerDay }`.
- `supabase/migrations/0032_profiles_resolution_budget.sql` — dodał `profiles.ai_resolution_max_calls_per_photo`
  (`int not null default 3`) + `CHECK (... between 1 and 10)` + constraint
  `profiles_ai_resolution_max_calls_per_photo_range`. Najwyższy numer migracji na `origin/main`:
  `0032` (zweryfikowane `git ls-tree origin/main`) → kolejny wolny to `0033`.
- `src/lib/db/database.types.ts:353,365,377` — `ai_resolution_max_calls_per_photo: number` w
  `profiles.Row`/`Insert`/`Update` (ręcznie wpisane, commitowany plik, bez regeneracji z DB).
- `src/lib/account/schema.ts:20` — `UpdateProfileSchema.ai_resolution_max_calls_per_photo`
  (`z.number().int().min(1).max(10).optional()`).
- `src/pages/api/account/profile.ts:52,56,89` — PATCH endpoint przekazuje pole do `.update()`,
  `.select()`, i response.
- `src/pages/account.astro:14,20,43` — SSR selectuje pole, przekazuje jako prop
  `initialMaxCallsPerPhoto` do wyspy.
- `src/components/AccountIsland.tsx` — `DEFAULT_MAX_CALLS_PER_PHOTO = 3` (linia 25), prop
  `initialMaxCallsPerPhoto` (linia 31/45), state `maxCallsPerPhoto` (linia 57), input
  `data-testid="account-resolution-max-photo-input"` (linia ~588-595), `handleRestoreDefaults`
  resetuje oba pola do 3/20, `handleSaveLimits` wysyła oba pola w PATCH.
- `src/pages/api/photos/[id].ts` (GET, linia 35-315) — zwraca `PhotoDTO` + `photo_url` +
  `detections` + `vision_run` + `costs_total_usd`. `costs_total_usd` (linia 84-115) to precedens
  **best-effort dekoracyjnego pola**: równoległe zapytanie, `try/catch` degradujący do `null`
  przy błędzie, nie 500 — nie blokuje głównej odpowiedzi.
- `src/components/DetectionReview.tsx` — `photoId` jest propsem top-level komponentu (linia
  1990-1996), dostępny wszędzie w drzewie. `ApiResponse.data` (linia 1933-1943) ma
  `costs_total_usd?: number | null` jako sibling `photo`; `setCostsTotalUsd(json.data.costs_total_usd ?? null)`
  (linia 2094) to wzorzec do naśladowania. `vision-run-panel` (linia 2787, `data-testid`) to
  istniejący **photo-scoped** (nie detection-scoped) panel akcji z przyciskami
  `rerun-match-button` (2823), `add-missed-book-button` (2831) i wspólnym slotem komunikatu
  `data-testid="action-message"` (linia 2882). `useDetectionDecision` (obsługa 429 dla
  AI-resolution, `handleAiResolve`) jest **detection-scoped** i dziś NIE ma `photoId` w zasięgu —
  budżet per-zdjęcie żył tam tylko przez wartości zwrócone z API, nie przez lokalny stan.

## Pożądany stan końcowy

`POST /api/detections/[id]/resolve` blokuje WYŁĄCZNIE na podstawie dziennego limitu — żadna
liczba prób na konkretnym zdjęciu nie blokuje więcej wywołań AI-resolution. `/account` nie
pokazuje już pola "Limit na zdjęcie" (usunięte razem z kolumną DB). Widok zdjęcia
(`DetectionReview.tsx`, panel `vision-run-panel`) pokazuje informacyjnie "Próby AI-resolution
dla tego zdjęcia: N" — czysto informacyjne, bez przycisku, bez wpływu na dostępność funkcji.

### Kluczowe odkrycia:

- Usunięcie blokady per-zdjęcie NIE wymaga migracji `resolution_calls` (append-only, bez zmian) —
  tylko migracja `profiles` (drop column) i logiki w `resolve.ts`.
- Licznik prób w UI nie potrzebuje nowego endpointu — rozszerzamy istniejący
  `GET /api/photos/[id]` dokładnie tym samym wzorcem co `costs_total_usd` (best-effort,
  równoległe zapytanie, degradacja do `null`).
- `maxCallsPerUserAction` (martwy parametr w `AI_RESOLUTION_BUDGET_LIMITS`) zostaje bez zmian —
  poza zakresem tej zmiany (nie dotyczy per-zdjęcia).

## Czego NIE robimy

- Nie usuwamy dziennego limitu (`ai_resolution_max_calls_per_day`) ani mechanizmu miękkiego
  resetu (`ai_resolution_daily_reset_at`) — zostają bez zmian, to jedyny pozostały guardrail
  kosztowy.
- Nie dodajemy żadnego przycisku/akcji przy liczniku prób w widoku zdjęcia — to czysta
  informacja, zgodnie z decyzją właściciela repo ("wywal blokadę, ale podawaj liczbę prób").
- Nie zmieniamy `maxCallsPerUserAction` — zostaje martwym, wewnętrznym parametrem jak dotychczas.
- Nie kasujemy istniejących wierszy `resolution_calls` — `DROP COLUMN` dotyczy wyłącznie
  `profiles.ai_resolution_max_calls_per_photo`, audyt zostaje w pełni nienaruszony.

## Podejście do implementacji

Cztery fazy odwracające poprzedni slice tam, gdzie to konieczne (DB → backend → UI → E2E), plus
nowy, mały kawałek funkcjonalności (licznik prób) doklejony do tego samego cyklu, żeby nie
zostawiać osobnego pustego PR-a. Kolejność faz identyczna z poprzednim planem (fundament → API →
UI → E2E), bo zależności są te same.

## Faza 1: DB + logika budżetu

### Przegląd

Migracja usuwająca kolumnę + constraint, aktualizacja typów, uproszczenie
`isAiResolutionBudgetAvailable` do sprawdzania wyłącznie dziennego limitu.

### Wymagane zmiany:

#### 1. Migracja

**Plik**: `supabase/migrations/0033_remove_photo_resolution_limit.sql`

**Cel**: Usunąć CHECK constraint i kolumnę per-zdjęciowego limitu z `profiles`. Nieodwracalne
(`DROP COLUMN`), ale dane w niej i tak nic już nie znaczą po usunięciu blokady w kodzie.

**Kontrakt**:
```sql
alter table public.profiles
  drop constraint if exists profiles_ai_resolution_max_calls_per_photo_range;

alter table public.profiles
  drop column if exists ai_resolution_max_calls_per_photo;
```

#### 2. Typy TypeScript

**Plik**: `src/lib/db/database.types.ts`

**Cel**: Usunąć `ai_resolution_max_calls_per_photo` z `profiles.Row`/`Insert`/`Update` (linie
353, 365, 377).

**Kontrakt**: Usunięcie trzech linii, bez zmiany pozostałych pól.

#### 3. Logika budżetu

**Plik**: `src/lib/resolution/budgetPolicy.ts`

**Cel**: `AI_RESOLUTION_BUDGET_LIMITS` traci `maxCallsPerPhoto` (zostaje `maxCallsPerUserAction`
+ `maxCallsPerDay`). `AiResolutionBudgetState`/`AiResolutionBudgetLimits` zwężają się do samego
dnia. `isAiResolutionBudgetAvailable` sprawdza wyłącznie `callsForDay < limits.maxCallsPerDay`.
`effectiveDailyWindowStart` zostaje bez zmian (nadal potrzebny dla dziennego okna).

**Kontrakt**:
```ts
export const AI_RESOLUTION_BUDGET_LIMITS = {
  maxCallsPerUserAction: 1,
  maxCallsPerDay: 20,
} as const;

export type AiResolutionBudgetState = { callsForDay: number };
export type AiResolutionBudgetLimits = { maxCallsPerDay: number };

export function isAiResolutionBudgetAvailable(
  state: AiResolutionBudgetState,
  limits: AiResolutionBudgetLimits = AI_RESOLUTION_BUDGET_LIMITS,
): boolean {
  return state.callsForDay < limits.maxCallsPerDay;
}
```

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx supabase migration up` (lokalny stack) — migracja stosuje się czysto
- `npm run typecheck` przechodzi bez `ai_resolution_max_calls_per_photo` w `database.types.ts`
- `npx vitest run tests/unit/lib/resolution/budgetPolicy.test.ts` — usunięte testy
  `callsForPhoto`/custom `maxCallsPerPhoto`, istniejące testy `effectiveDailyWindowStart` bez
  zmian, nowy test: `isAiResolutionBudgetAvailable` ignoruje dowolnie wysoki `callsForPhoto` (bo
  typ nie ma już tego pola — test raczej potwierdza, że sygnatura przyjmuje tylko `callsForDay`)
- `npm run lint` przechodzi

#### Weryfikacja ręczna:

- (brak — czysta logika bez UI, w pełni pokryta automatami)

---

## Faza 2: Backend API

### Przegląd

`resolve.ts` traci blokadę per-zdjęcie (zostaje tylko dzienna), `account/schema.ts` +
`profile.ts` tracą pole, `GET /api/photos/[id]` zyskuje informacyjny licznik prób.

### Wymagane zmiany:

#### 1. Konsumpcja budżetu w resolve.ts

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: Usunąć `photoCountResult` z równoległego zapytania (linia 124-133) i `ai_resolution_max_calls_per_photo`
z `.select()` profilu (linia 56) — zostaje tylko dzienne liczenie. `isAiResolutionBudgetAvailable`
wołane z `{ callsForDay: dayCount }` i `{ maxCallsPerDay }`. Komunikat 429 traci klauzulę "na
zdjęcie".

**Kontrakt**: `.select('ai_enabled, ai_resolution_max_calls_per_day, ai_resolution_daily_reset_at')`.
Jedno zapytanie `dayCountResult` (bez `Promise.all` z drugim — już niepotrzebny). Komunikat 429:
`` `Osiągnięto Twój dzienny limit AI-resolution (${dayCount}/${maxCallsPerDay}). Zmień limit na /account.` ``.

#### 2. Schema + endpoint profilu

**Pliki**: `src/lib/account/schema.ts`, `src/pages/api/account/profile.ts`

**Cel**: Usunąć `ai_resolution_max_calls_per_photo` z `UpdateProfileSchema` (linia 20), z
`.update()` payloadu (linia 52), z `.select()` (linia 56) i z response (linia 89).

**Kontrakt**: `UpdateProfileSchema` zostaje z `display_name` + `ai_resolution_max_calls_per_day`
(oba nadal `.optional()`, `.refine` bez zmian).

#### 3. Licznik prób w GET /api/photos/[id]

**Plik**: `src/pages/api/photos/[id].ts`

**Cel**: Dodać best-effort `resolution_attempts_count` do response — bliższy, gotowy precedens
istnieje w `src/pages/api/photos/[id]/costs.ts:68-96` (dokładnie ten sam count na
`resolution_calls` filtrowany po `photo_id`, best-effort degradacja przy błędzie) — użyj go
zamiast/obok `costs_total_usd` (linia 84-115) jako wzorca kształtu. **Nie kopiuj** rzutowania
`(locals.supabase as any)` z tego precedensu — było potrzebne, gdy `resolution_calls` nie było
jeszcze w `database.types.ts`; dziś jest w pełni typowane (`database.types.ts:445`), więc nowe
zapytanie powinno być zwykłym typowanym wywołaniem Supabase.

**Kontrakt**: `locals.supabase.from('resolution_calls').select('id', { count: 'exact', head: true }).eq('photo_id', id)`
(bez `as any`) wewnątrz istniejącego `try` bloku kosztów (linia 89-115) lub osobnego równoległego
best-effort bloku o tym samym kształcie. Response: `{ data: { photo, photo_url, detections,
vision_run, costs_total_usd, resolution_attempts_count } }`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx vitest run tests/unit/pages/api/detections/resolve.test.ts` — usunięte testy custom
  `maxCallsPerPhoto`/per-photo blokady, istniejące testy dziennego budżetu bez zmian (fallback
  `??` nadal chroni mock), nowy test: bardzo wysoki historyczny `photoCount` (np. 100) NIE
  blokuje wywołania, gdy dzienny budżet dostępny
- `npx vitest run tests/unit/pages/api/account/profile.test.ts` — usunięte testy per-photo pola,
  istniejące testy `display_name`/dziennego limitu bez zmian
- `npx vitest run "tests/unit/pages/api/photos/[id].test.ts"` — nowy test: GET zwraca
  `resolution_attempts_count` (happy path + degradacja do `null` przy błędzie zapytania)
- `npm run typecheck` i `npm run lint` przechodzą

#### Weryfikacja ręczna:

- (odroczona do Fazy 4 — pełny flow wymaga UI)

---

## Faza 3: UI

### Przegląd

`/account` traci pole "Limit na zdjęcie". Widok zdjęcia zyskuje informacyjny licznik prób przy
`vision-run-panel`.

### Wymagane zmiany:

#### 1. SSR account.astro

**Plik**: `src/pages/account.astro`

**Cel**: Usunąć `ai_resolution_max_calls_per_photo` z `.select()` (linia 14), usunąć
`initialMaxCallsPerPhoto` (linia 20, 43).

**Kontrakt**: `select('display_name, ai_resolution_max_calls_per_day, ai_resolution_daily_reset_at')`.

#### 2. AccountIsland.tsx

**Plik**: `src/components/AccountIsland.tsx`

**Cel**: Usunąć input "Limit na zdjęcie" (`account-resolution-max-photo-input`, linia ~583-598),
prop `initialMaxCallsPerPhoto`, state `maxCallsPerPhoto`/`setMaxCallsPerPhoto`,
`DEFAULT_MAX_CALLS_PER_PHOTO`. `handleSaveLimits` wysyła tylko `ai_resolution_max_calls_per_day`.
`handleRestoreDefaults` resetuje tylko dzienny limit do 20.

**Kontrakt**: Sekcja "Limity AI-resolution" zostaje z jednym polem (limit dzienny) + wskaźnikiem
zużycia + resetem licznika — layout `grid-cols-2` (linia ~579) upraszcza się do pojedynczego
pola.

#### 3. Licznik prób w DetectionReview.tsx

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: `ApiResponse.data` zyskuje `resolution_attempts_count?: number | null` (obok
`costs_total_usd`, linia 1940). Nowy state `resolutionAttemptsCount`, ustawiany analogicznie do
`setCostsTotalUsd` (linia 2094). Renderowany jako informacyjny tekst wewnątrz `vision-run-panel`
(obok przycisków, linia ~2787-2841) — widoczny tylko gdy `resolutionAttemptsCount != null && > 0`
(brak wartości = brak prób, nic do pokazania).

**Kontrakt**: `<p data-testid="resolution-attempts-count">Próby AI-resolution dla tego zdjęcia:
{resolutionAttemptsCount}</p>` — czysto informacyjny, bez interakcji.

#### 4. Rozszerzenie zakresu (ustalone podczas manualnej weryfikacji): koszt/liczba prób AI-resolution per propozycja

**Kontekst**: Podczas ręcznego testowania punktu 3 właściciel repo zauważył, że informacja o
AI-resolution powinna być widoczna też na poziomie pojedynczej propozycji (detekcji) — nie tylko
zbiorczo dla zdjęcia — analogicznie do istniejącego badge'a `$` pokazującego koszt OCR (refine)
per detekcja. Ustalono (AskUserQuestion): rozszerzyć **istniejący** badge `$`
(`CostPanel` w `DetectionCard`) o koszt AI-resolution, zamiast dodawać osobną ikonkę. Zdecydowano
dołożyć to do trwającej Fazy 3 (nie osobny cykl plan-review) — mniejszy, ściśle powiązany zakres.

**Pliki**: `src/pages/api/photos/[id].ts`, `src/lib/photos/schema.ts`, `src/components/DetectionReview.tsx`.

**Cel**: `GET /api/photos/[id]` agreguje `resolution_calls` per `detection_id` (ten sam wzorzec co
istniejący `refineCostByDet`) — nowe pola `resolution_cost_usd`/`resolution_attempts_count` na
`DetectionWithCandidatesDTO`. Badge `$` w `DetectionCard` sumuje `refine_cost_usd +
resolution_cost_usd` jako etykietę; tooltip wspomina liczbę prób AI, gdy > 0. `CostPanel` już
obsługiwał filtrowanie `resolution_calls` po `detectionId` w rozwijanym panelu (S-50) — brak
zmian w tym komponencie, tylko w danych wejściowych (`label`/`hint`).

**Kontrakt**: `resolution_cost_usd?: number`, `resolution_attempts_count?: number` na DTO.
Label: `` `$${(refine_cost_usd ?? 0 + resolution_cost_usd ?? 0).toFixed(4)}` `` (gdy suma > 0).
Hint: `` `Koszt OCR + AI-resolution tej propozycji (${attempts} ${attempts === 1 ? 'próba AI' : 'próby AI'}). Kliknij, by zobaczyć wywołania z cenami.` `` gdy attempts > 0, inaczej dotychczasowy tekst OCR-only.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npx vitest run tests/unit/components/AccountIsland.test.tsx` — usunięte testy pola per-photo
  (render initial value, walidacja poza zakresem dla tego pola), istniejące testy dziennego
  limitu/resetu licznika bez zmian
- `npx vitest run tests/unit/components/DetectionReview.test.tsx` — nowy test: licznik prób
  renderuje się, gdy `resolution_attempts_count > 0`, ukryty gdy `0`/`null`
- `npm run typecheck`, `npm run lint`, `npm run build` przechodzą

#### Weryfikacja ręczna:

- Otwórz `/account` — pole "Limit na zdjęcie" nie istnieje, tylko limit dzienny
- Otwórz widok zdjęcia z historycznymi próbami AI-resolution — licznik prób widoczny przy
  panelu akcji zdjęcia
- Wywołaj AI-resolution wielokrotnie (>10 razy) na tym samym zdjęciu w ramach dziennego budżetu —
  żadne wywołanie nie jest blokowane przez limit per-zdjęcie (bo już nie istnieje)
- Na propozycji (detekcji) z historią AI-resolution — badge `$` pokazuje sumę kosztu OCR +
  AI-resolution, tooltip po najechaniu wspomina liczbę prób AI; kliknięcie rozwija panel z
  wywołaniami (już istniejąca funkcjonalność `CostPanel`, tylko zasilona nowymi danymi)

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych
weryfikacji, zatrzymaj się tutaj po ręczne potwierdzenie przed przejściem do Fazy 4.

---

## Faza 4: E2E i pełna weryfikacja

### Przegląd

Aktualizacja istniejących E2E o usunięte pole, pełny przebieg automatów, ręczny smoke.

### Wymagane zmiany:

#### 1. E2E

**Plik**: `tests/e2e/account.spec.ts`

**Cel**: Usunąć interakcje z `account-resolution-max-photo-input` z testu
"limit AI-resolution: zapis przeżywa reload" (edycja tylko dziennego pola). Test walidacji poza
zakresem zostaje bez zmian (dotyczy pola dziennego, `999`).

**Kontrakt**: Bez zmian w liczbie testów — modyfikacja istniejących asercji/interakcji.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`
- `npm run typecheck`
- `npx vitest run` (pełna suita jednostkowa)
- `npx playwright test tests/e2e/account.spec.ts` (lokalnie — **NIE** pełna suita lokalnie,
  zob. `context/foundation/lessons.md § Pełna suita E2E zawiesza maszynę`; pełna suita
  walidowana w CI)
- `npm run build`

#### Weryfikacja ręczna:

- Pełny smoke na `/account`: brak pola "Limit na zdjęcie", reszta sekcji bez regresji
- Pełny smoke na widoku zdjęcia: licznik prób widoczny i poprawny, brak blokady per-zdjęcie

---

## Strategia testowania

### Testy jednostkowe:

- `budgetPolicy.ts`: `isAiResolutionBudgetAvailable` sprawdza tylko dzień
- `resolve.ts`: bardzo wysoki historyczny `photoCount` nie blokuje; komunikat 429 bez klauzuli
  "na zdjęcie"
- `profile.ts`/`account/schema.ts`: partial update bez pola per-photo
- `photos/[id].ts` GET: `resolution_attempts_count` happy path + degradacja do `null`
- `AccountIsland.tsx`: brak pola per-photo, reset dotyczy tylko dnia
- `DetectionReview.tsx`: licznik prób render/hide

### Testy integracyjne:

- Brak nowych — `DROP COLUMN` nie zmienia RLS (istniejąca `profiles_update_own` pokrywa update
  pozostałych kolumn bez zmian).

### Kroki testowania ręcznego:

1. Otwórz `/account` — zweryfikuj brak pola "Limit na zdjęcie".
2. Otwórz zdjęcie z historią prób AI-resolution (np. to samo zdjęcie z poprzedniej sesji
   testowej) — licznik prób widoczny.
3. Wywołaj AI-resolution wielokrotnie na tym samym zdjęciu (w ramach dziennego budżetu) —
   żadna blokada per-zdjęcie.
4. Wyczerpaj dzienny limit — 429 z komunikatem bez wzmianki o zdjęciu.

## Uwagi dotyczące migracji

`DROP COLUMN` jest nieodwracalny, ale dane w kolumnie nie są używane po tej zmianie (kod przestaje
je czytać w tej samej fazie co migracja) — brak ryzyka utraty aktywnie używanych danych.
`resolution_calls` (audyt) pozostaje całkowicie nienaruszone.

## Referencje

- Poprzedni plan (odwracany częściowo): `context/changes/ai-resolution-budget-per-profile/plan.md`
- Impl-review poprzedniego planu: `context/changes/ai-resolution-budget-per-profile/reviews/impl-review.md`
- Precedens best-effort dekoracyjnego pola: `src/pages/api/photos/[id].ts:84-115` (`costs_total_usd`)
- Precedens photo-scoped panelu akcji: `src/components/DetectionReview.tsx:2787` (`vision-run-panel`)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków.

### Faza 1: DB + logika budżetu

#### Automatyczne

- [x] 1.1 Migracja stosuje się czysto — 0c72d9e
- [x] 1.2 Typecheck przechodzi bez ai_resolution_max_calls_per_photo — 0c72d9e
- [x] 1.3 Testy jednostkowe budgetPolicy.test.ts przechodzą (zaktualizowane) — 0c72d9e
- [x] 1.4 Lint przechodzi — 0c72d9e

### Faza 2: Backend API

#### Automatyczne

- [x] 2.1 Testy jednostkowe resolve.test.ts przechodzą (zaktualizowane + nowe) — 7f8a17a
- [x] 2.2 Testy jednostkowe profile.test.ts przechodzą (zaktualizowane) — 7f8a17a
- [x] 2.3 Testy jednostkowe photos/[id].test.ts przechodzą (nowe) — 7f8a17a
- [x] 2.4 Typecheck i lint przechodzą — 7f8a17a

### Faza 3: UI

#### Automatyczne

- [x] 3.1 Testy jednostkowe AccountIsland.test.tsx przechodzą (zaktualizowane) — 8484975
- [x] 3.2 Testy jednostkowe DetectionReview.test.tsx przechodzą (nowe) — 8484975
- [x] 3.3 Typecheck, lint, build przechodzą — 8484975

#### Ręczne

- [x] 3.4 /account nie pokazuje pola "Limit na zdjęcie" — 8484975
- [x] 3.5 Licznik prób widoczny w widoku zdjęcia — 8484975
- [x] 3.6 Wielokrotne wywołania AI-resolution na tym samym zdjęciu nie są blokowane — 8484975
- [x] 3.7 Badge $ per propozycja sumuje OCR + AI-resolution, tooltip pokazuje liczbę prób — 8484975

### Faza 4: E2E i pełna weryfikacja

#### Automatyczne

- [x] 4.1 Lint zielony
- [x] 4.2 Typecheck zielony
- [x] 4.3 Pełna suita Vitest zielona (1285/1285)
- [x] 4.4 Playwright account.spec.ts zielony (8/8; pełna suita w CI, nie lokalnie)
- [x] 4.5 Build przechodzi

#### Ręczne

- [x] 4.6 Pełny smoke na /account i widoku zdjęcia bez regresji
