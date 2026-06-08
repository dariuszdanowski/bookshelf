# S-44 e2e-flake-stabilization — Implementation Plan

## Overview

Utwardzić flaky testy E2E tak, by pełny `npm run test:e2e` przechodził
deterministycznie przy `retries: 0` (lokalnie), bez polegania na globalnym
retry. Naprawa wyłącznie w warstwie testów — zero zmian w kodzie produkcyjnym.

## Current State Analysis

Trzy znane flaki (zielone w izolacji, padają w pełnym przebiegu na współdzielonej
sesji storageState, 1 signup/run). Przyczyny zweryfikowane w kodzie:

1. **Lost-click podczas hydratacji wyspy** (`account.spec.ts:33-34`).
   `UserMenu` renderowany jest server-side w `Layout.astro` z `client:load`;
   `user-menu-trigger` istnieje w SSR-HTML natychmiast. Test klika go zanim React
   podepnie `onClick={() => setOpen(...)}` (`UserMenu.tsx:41`). Klik przepada,
   `open` zostaje `false`, a `user-menu-account` renderuje się tylko gdy
   `{open && ...}` (`UserMenu.tsx:63,80`) → drugi klik czeka w nieskończoność →
   timeout. Czasem hydratacja wyprzedza klik i test przechodzi → flake.

2. **Ciasny timeout na refetch po mutacji** (`shelves.spec.ts:39-43`).
   `ShelvesIsland` jest client-fetched: `loading` startuje `true`, formularz
   (`shelf-form-submit`) renderuje się dopiero w gałęzi `loading=false`
   (`ShelvesIsland.tsx:15,91,101`) — więc fill/submit są bezpieczne po hydratacji
   (Playwright auto-czeka na pojawienie się formularza). Flake to **5s timeout** na
   pojawienie się `shelf-item-name` po `handleCreate` (POST `/api/shelves` →
   `await fetchShelves()` GET) pod zimnym dev-serverem Astro (kompilacja route
   on-demand) przy `workers: 1`. To wyścig z zegarem, nie z hydratacją.

3. **Transientny odczyt computed-style** (`dark-mode-contrast.spec.ts:58-59`).
   `await editButton.hover()` + natychmiastowy, jednorazowy
   `getComputedStyle(el).backgroundColor`. Jeśli React re-renderuje wiersz między
   hover a odczytem, albo :hover nie zdążył się zaaplikować — odczyt łapie stan
   bez hovera. Plus ten sam create-refetch timing co w (2).

### Key Discoveries:

- Brak centralnych helperów E2E (`tests/e2e/helpers/` nie istnieje) — wzorce
  oczekiwań powtarzane inline, niespójne (Explore: `account-costs.spec.ts` ma
  lokalny `waitForAccountReady`, reszta wymyśla własne `toBeVisible` guardy).
- Istniejące sygnały „gotowości" wyspy są wystarczające — `shelves-loading`
  (`ShelvesIsland.tsx:93`), `account-stats-loading`/`account-stats-content`
  (account.spec używa `.or(...)`), więc **marker hydratacji w prod jest zbędny**.
- `playwright.config.ts`: `retries: CI ? 2 : 0`, `workers: CI ? 1`,
  `webServer: npm run dev` (Astro dev, on-demand compile). Cel S-44 = determinizm
  przy `retries:0` (lokalnie), więc fix musi działać bez globalnego retry.
- Powierzchnia sweepu (grep): `user-menu-trigger` → `account.spec`, `auth.spec`;
  `getComputedStyle` po `.hover()` → `dark-mode-contrast`, `media-pack`;
  create-shelf flow → `shelves`, `dark-mode-contrast`. Bonus: jawny
  `waitForTimeout(500)` w `cost-panel.spec.ts:238` (łamie regułę z AGENTS.md).

## Desired End State

`npm run test:e2e` przechodzi 3× pod rząd lokalnie (retries:0), bez flake'ów na
trzech nazwanych specach ani na specach dotkniętych tymi samymi antywzorcami.
Wspólny moduł helperów hermetyzuje deterministyczne interakcje; `tests/e2e/AGENTS.md`
dokumentuje wzorzec, by przyszłe testy nie regenerowały antywzorca.

## What We're NOT Doing

- **Zero zmian w kodzie produkcyjnym** (komponenty, endpointy, prod-markery
  hydratacji) — naprawiamy wyłącznie testy.
- **Nie ruszamy `retries: 2` w CI** — zostaje jako siatka na udokumentowany
  infra-blip (JWT iat-skew tuż po `supabase start`, zob. memory), NIE jako fix
  flake'a. Fix celuje w determinizm przy `retries:0`.
- **Nie wprowadzamy globalnego retry ani `test.describe.configure({ retries })`**
  jako maskowania — tylko bounded, asercją-walidowane `toPass` na pojedyncze
  interakcje.
- **Nie przerabiamy modelu sesji** (per-spec re-auth) — shared storageState
  zostaje; flake nie wynika z wygasania sesji, lecz z hydratacji/timingu.

## Implementation Approach

Trzy deterministyczne prymitywy w jednym module helperów, potem aplikacja do
3 nazwanych flaków, potem sweep tych samych antywzorców w pozostałych specach.

- **Lost-click → retry-otwarcia walidowany side-effectem.** `openUserMenu(page)`
  owija klik triggera + asercję widoczności dropdownu w `expect(async () => {...})
  .toPass({ timeout })`. Retry kończy się, gdy React zhydratował i klik zarejestrował
  otwarcie — deterministycznie, bez maskowania (realny brak menu wciąż failuje).
- **Mutacja → czekanie na odpowiedź, nie na zegar.** `createShelf(page, name,
  location)` robi fill + `Promise.all([page.waitForResponse('**/api/shelves'
  POST), submit.click()])`, potem czeka na refetch GET i widoczność wiersza z
  hojnym, ale jawnym timeoutem (czeka na realny stan, nie na 5s arbitralne).
- **Transientny odczyt → polling do oczekiwanej wartości.** `expectHoverBg(locator,
  expected)` robi `hover()` i owija odczyt computed-style w `toPass`, aż wartość
  się ustabilizuje na oczekiwanej (realnie zły kolor failuje po timeoucie).

## Phase 1: Wspólny moduł helperów E2E

### Overview

Stworzyć `tests/e2e/helpers/interactions.ts` z trzema deterministycznymi
prymitywami i udokumentować je w `tests/e2e/AGENTS.md`. Bez konsumentów jeszcze
(Faza 2/3 je podłącza) — ale każdy helper przetestowany przez podłączenie do
jednego flaka w tej samej fazie, by udowodnić determinizm.

### Changes Required:

#### 1. Moduł helperów

**File**: `tests/e2e/helpers/interactions.ts` (nowy)

**Intent**: Hermetyzować trzy deterministyczne wzorce interakcji tak, by specy nie
powtarzały antywzorców. Funkcje czyste względem `page`/`Locator`, bez globalnego
stanu.

**Contract**: Eksportuje:
- `openUserMenu(page): Promise<void>` — `expect(async () => { await
  page.getByTestId('user-menu-trigger').click(); await
  expect(page.getByTestId('user-menu-dropdown')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 })`. Idempotentny względem już-otwartego menu
  (toggle: jeśli dropdown już widoczny, kolejny klik by go zamknął — guard przez
  sprawdzenie widoczności przed klikiem wewnątrz retry).
- `createShelf(page, name: string, location?: string): Promise<void>` — fill pól
  formularza + `Promise.all([page.waitForResponse(r => r.url().includes('/api/shelves')
  && r.request().method() === 'POST' && r.ok()), page.getByTestId('shelf-form-submit')
  .click()])`, następnie `await expect(page.getByTestId('shelf-item-name')
  .filter({ hasText: name })).toBeVisible({ timeout: 10_000 })`.
- `expectHoverBg(locator: Locator, expected: string): Promise<void>` — `await
  locator.hover()` + `await expect(async () => { const bg = await locator.evaluate(
  el => getComputedStyle(el).backgroundColor); expect(bg).toBe(expected); })
  .toPass({ timeout: 3_000 })`.

Sygnatury są kontraktem dla Faz 2–3. Polski/test-konwencja: lokatory przez
`getByTestId` zgodnie z AGENTS.md.

#### 2. Dokumentacja wzorca

**File**: `tests/e2e/AGENTS.md`

**Intent**: Dopisać krótką sekcję „Deterministyczne interakcje (helpers)" linkującą
antywzorce hydratacja-lost-click / transient-read / mutation-timing do helperów,
by przyszłe testy używały ich zamiast surowych klików.

**Contract**: Nowa sekcja po „Pięć antywzorców" — wskazuje
`helpers/interactions.ts` jako kanoniczne źródło i podaje, kiedy użyć którego
helpera.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Moduł importowalny — jeden flak (`account.spec`) podłączony do `openUserMenu`
  w tej fazie i `npx playwright test account.spec.ts` zielony lokalnie 3× pod rząd.

#### Manual Verification:

- (brak — warstwa testów, weryfikacja automatami)

**Implementation Note**: Faza testowa — pełna weryfikacja przez uruchomienie
samych testów. Po automatach przejdź do Fazy 2.

---

## Phase 2: Aplikacja helperów do 3 nazwanych flaków

### Overview

Przepisać trzy nazwane flaki na helpery z Fazy 1 — usunąć surowe kliki/odczyty
będące źródłem wyścigu.

### Changes Required:

#### 1. account.spec.ts

**File**: `tests/e2e/account.spec.ts`

**Intent**: Zastąpić sekwencję `user-menu-trigger`.click + `user-menu-account`.click
(`:33-34`) wywołaniem `openUserMenu(page)` + klik `user-menu-account` (już w
otwartym, zhydratowanym menu).

**Contract**: `await openUserMenu(page); await page.getByTestId('user-menu-account')
.click(); await page.waitForURL('/account');`. Reszta testu bez zmian.

#### 2. shelves.spec.ts

**File**: `tests/e2e/shelves.spec.ts`

**Intent**: Zastąpić fill+submit+5s-wait (`:37-43`) wywołaniem `createShelf(page,
SHELF_NAME, SHELF_LOCATION)`. Pozostałe asercje (edit/delete) — wymienić gołe 5s
`toBeVisible` na czekanie powiązane z odpowiedzią refetch tam, gdzie to ten sam
wzorzec mutacja→refetch (rename PATCH, delete DELETE).

**Contract**: create przez helper; dla rename/delete użyć `waitForResponse` na
`/api/shelves/*` (PATCH/DELETE) sprzężony z klikiem przed asercją widoczności/braku
wiersza. Kontrakt scenariusza (create→edit→delete, „Zakupione" chroniona) bez zmian.

#### 3. dark-mode-contrast.spec.ts

**File**: `tests/e2e/dark-mode-contrast.spec.ts`

**Intent**: Użyć `createShelf` dla setupu półki (`:52-56`) i `expectHoverBg(editButton,
DARK_HOVER_GRAY)` zamiast `hover()`+jednorazowy odczyt (`:58-62`). Asercja
„nie bieleje" (`!== LIGHT_HOVER_GRAY`) zachowana — `expectHoverBg` sprawdza
równość z `DARK_HOVER_GRAY`, co implikuje różność.

**Contract**: hover-asercja przez helper; testy M14 (`shelf-form-submit` bg, bez
hovera, bez mutacji) bez zmian — to statyczny odczyt, nie flaky.

### Success Criteria:

#### Automated Verification:

- `npx playwright test account.spec.ts shelves.spec.ts dark-mode-contrast.spec.ts`
  zielony lokalnie **3× pod rząd** (retries:0).
- Typecheck + lint przechodzą.

#### Manual Verification:

- (brak)

**Implementation Note**: Po 3× zielonych trzech specach przejdź do Fazy 3.

---

## Phase 3: Sweep tych samych antywzorców w pozostałych specach

### Overview

Zastosować helpery wszędzie, gdzie powtarza się ten sam antywzorzec, by pełny run
był deterministyczny — nie tylko trzy nazwane specy.

### Changes Required:

#### 1. UserMenu-open w innych specach

**File**: `tests/e2e/auth.spec.ts` (i ew. inne z `user-menu-trigger`)

**Intent**: Podmienić surowy `user-menu-trigger`.click przed interakcją z menu na
`openUserMenu(page)`, jeśli scenariusz tego nie testuje wprost (logout/golden-path
auth może klikać menu — wtedy helper, chyba że to dokładnie test otwierania menu).

**Contract**: `openUserMenu` tam, gdzie menu jest środkiem do celu, nie obiektem
testu. Test logowania/signup bez zmian, jeśli nie dotyka menu.

#### 2. Sweep transientnych hover-readów (NIE media-pack)

**File**: (sweep — żaden konkretny z góry)

**Intent**: Zweryfikować grepem, czy poza `dark-mode-contrast` (Faza 2) jakiś spec
sprzęga `.hover()` z natychmiastowym `getComputedStyle`. **Uwaga:** `media-pack.spec.ts:157,167`
to STATYCZNE odczyty `objectFit` (fit-contain/cover), bez `.hover()` — NIE flaky,
zostają bez zmian (grep `getComputedStyle` trafił je file-level, nie wzorcowo).

**Contract**: `rg -n "\.hover\(\)" tests/e2e` + ręczne sprawdzenie, czy po hover jest
odczyt computed-style; jeśli poza dark-mode brak — no-op (potwierdzić w raporcie
impl). Tylko realnie hover-sprzężone odczyty owinąć w `expectHoverBg`/polling.

#### 3. cost-panel.spec.ts — `waitForTimeout` w negative-wait

**File**: `tests/e2e/cost-panel.spec.ts`

**Intent**: `await page.waitForTimeout(500)` (`:238`) to **negative-wait** — test
dowodzi, że `/costs` NIE jest wołany przed klikiem (`:231-239`). NIE da się tego
zastąpić `waitForResponse` (czekanie na nieistnienie zdarzenia). Zamiast gołego
500ms okna czekać na konkretny ready-state, by dowód był deterministyczny.

**Contract**: zastąpić `waitForTimeout(500)` czekaniem na ustabilizowanie strony
przez konkretny sygnał — `await expect(page.getByTestId('cost-button-photo'))
.toBeVisible()` (i/lub `page.waitForLoadState('networkidle')`) — POTEM `expect(costsCalled)
.toBe(false)`. Semantyka „lazy fetch nie odpalił" zachowana, bez arbitralnego timera.

#### 4. create-shelf w innych specach

**File**: dowolne specy tworzące półkę przez `shelf-form-submit` jako setup

**Intent**: Użyć `createShelf` zamiast inline fill+submit+arbitralny-wait, gdzie to
setup (nie sam-w-sobie test tworzenia).

**Contract**: helper dla setupu; `shelves.spec` (test tworzenia) już pokryty w Fazie 2.

### Success Criteria:

#### Automated Verification:

- **Pełny** `npm run test:e2e` zielony lokalnie **3× pod rząd** (retries:0).
- Brak `waitForTimeout` w `tests/e2e/**` poza komentarzami/AGENTS.md:
  `rg "page.waitForTimeout" tests/e2e` zwraca tylko dokumentację.
- Typecheck + lint przechodzą.

#### Manual Verification:

- (brak — pełny przebieg E2E jest dowodem; manual user-only niepotrzebny dla
  warstwy testów)

**Implementation Note**: Po 3× zielonym pełnym runie — gotowe do PR (E2E już
przebiegnięty lokalnie zgodnie z twardą regułą „E2E przed PR").

---

## Testing Strategy

### Unit Tests:

- Brak nowych unit testów — zmiana dotyczy warstwy E2E. Helpery weryfikowane przez
  zielony przebieg specach, które ich używają.

### Integration Tests:

- Bez zmian (RLS integ niezwiązane).

### Manual Testing Steps:

- Brak — determinizm dowodzony automatami (3× pełny `npm run test:e2e`).

## Performance Considerations

- `toPass` z bounded timeoutem dodaje co najwyżej kilka retry-iteracji przy wolnej
  hydratacji; w happy-path (zhydratowane) kończy się po pierwszym przejściu — brak
  realnego narzutu czasowego na zielonym runie.

## Migration Notes

- Brak migracji danych. Czysto testowa refaktoryzacja.

## References

- Roadmap: `context/foundation/roadmap.md` (S-44)
- Konwencje E2E: `tests/e2e/AGENTS.md`
- Memory: `ci-e2e-jwt-iat-skew-flake` (dlaczego CI retries:2 zostaje), `dev-server-always-running-4321`
- Komponenty dające sygnały gotowości: `src/components/UserMenu.tsx:41,63,80`,
  `src/components/ShelvesIsland.tsx:15,93,101`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wspólny moduł helperów E2E

#### Automated

- [x] 1.1 Typecheck przechodzi: `npm run typecheck`
- [x] 1.2 Lint przechodzi: `npm run lint`
- [x] 1.3 `account.spec` podłączony do `openUserMenu` — `npx playwright test account.spec.ts` zielony 3× lokalnie

### Phase 2: Aplikacja helperów do 3 nazwanych flaków

#### Automated

- [ ] 2.1 `account.spec.ts shelves.spec.ts dark-mode-contrast.spec.ts` zielone 3× pod rząd (retries:0)
- [ ] 2.2 Typecheck + lint przechodzą

### Phase 3: Sweep tych samych antywzorców

#### Automated

- [ ] 3.1 Pełny `npm run test:e2e` zielony 3× pod rząd lokalnie (retries:0)
- [ ] 3.2 `rg "page.waitForTimeout" tests/e2e` zwraca tylko dokumentację
- [ ] 3.3 Typecheck + lint przechodzą
