# Per-call BYOK key override — Plan implementacji

## Przegląd

Dziś trzy akcje AI (refine, „Rozwiąż przez AI", przetwarzanie/rerun vision) zawsze używają jedynego `is_active=true` klucza BYOK usera (`getActiveProviderConfig`). Ten plan dodaje możliwość wyboru INNEGO klucza per-wywołanie — jednorazowy override, bez zmiany trwałego `is_active` w koncie. Dropdown pojawia się w istniejących `ConfirmDialog`-ach tych trzech akcji, domyślnie zaznaczony na aktywnym kluczu.

## Analiza stanu obecnego

- `getActiveProviderConfig(supabase, userId)` (`src/lib/keys/getActiveProviderConfig.ts:7-46`) selectuje jeden wiersz `user_api_keys` po `is_active=true`, deszyfruje klucz, zwraca `VisionProviderConfig`. Wywoływana w 3 miejscach: `resolve.ts:75`, `refine.ts:108`, `process.ts:97`.
- Żaden z tych trzech endpointów nie parsuje dziś JSON body: `resolve.ts:37` i `refine.ts:92` nawet nie destrukturyzują `request`; `process.ts:70` destrukturyzuje `request`, ale używa go tylko do `URL(...).searchParams` (skipMatch, linia 80).
- `user_api_keys` ma RLS (`select/insert/update/delete_own`, migracja `0016_user_api_keys.sql:17-27`) i unique partial index wymuszający ≤1 aktywny klucz (`0016_user_api_keys.sql:31-33`) — bez zmian, override NIE dotyka `is_active`.
- `GET /api/account/keys` (`src/pages/api/account/keys/index.ts:17-42`) już zwraca pełną listę kluczy usera jako `ApiKeyDTO[]` (`src/lib/keys/schema.ts:56-68`) — gotowy kontrakt do zasilenia dropdowna, zero zmian potrzebnych.
- Wszystkie trzy akcje UI już przechodzą przez `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) przed wykonaniem: refine (`DetectionReview.tsx:1605-1617`, powtórzone też ~2005-2032, ~2359-2386), resolve (`DetectionReview.tsx:1618-1634`, powtórzone), rerun-vision (`DetectionReview.tsx:3289-3301` i `:3627`). `ConfirmDialog` przyjmuje dziś tylko `message: string` (`ConfirmDialog.tsx:8`) — brak slotu na dodatkową treść.
- Wzorzec listy kluczy jako `<select>` już istnieje w `CostAnalysisModal.tsx:150-164` (filtr kosztów) — natywny `<select>`, brak radix/shadcn w repo (jedyny wzorzec dropdown w całym repo, potwierdzone: `AccountIsland.tsx`, `PhotoUploader.tsx`, `BookCard.tsx`, `CatalogSearchIsland.tsx`, `PhotoListIsland.tsx`, `DetectionReview.tsx:3406` — wszędzie natywny `<select>`).
- `DetectionReview.tsx` ma dziś DWA niezależne, ad-hoc fetche `/api/account/keys`: linia 790 (mount effect, tylko gdy `hasNoCandidates`, ustawia `activeProviderIsAnthropic`) i linia 2908 (lazy, na otwarcie dialogu rerun-vision, ustawia `activeKeyInfo`). Oba mają komentarz-ostrzeżenie (linie 781-784, 2904-2907): fetch musi być **lazy, na otwarcie dialogu**, NIE na mount — inaczej koliduje z kolejnością `mockResolvedValueOnce()` w istniejących testach, które nie renderują tych dialogów.
- `runProcessSSE(photoId, onStarted?)` (`src/lib/vision/runProcessSSE.ts:18-21`) woła `fetch(url, {method:'POST'})` bez body (linia 22) — jedyny caller: `DetectionReview.tsx:2876`.

## Pożądany stan końcowy

User z ≥2 kluczami BYOK, otwierając dialog potwierdzenia dla refine / „Rozwiąż przez AI" / rerun-vision, widzi dropdown z listą swoich kluczy (`etykieta (provider)`), domyślnie ustawiony na aktualnie aktywny. Wybór innego klucza i potwierdzenie wysyła to jedno wywołanie przez wybrany klucz — `is_active` w bazie zostaje niezmienione. User z ≤1 kluczem widzi dokładnie to co dziś (brak dropdowna, sama etykieta/brak info). Wybór wyboru NIE jest zapamiętywany między otwarciami dialogu (zawsze restart na aktywnym kluczu) — zgodnie z ustaloną semantyką „jednorazowy override".

### Kluczowe odkrycia:

- Wszystkie 3 endpointy backend potrzebują identycznego, mechanicznego dodatku: opcjonalne body → opcjonalny `keyId` do `getActiveProviderConfig`. Zero zmian schematu DB.
- Cała zmiana frontendowa to rozszerzenie istniejącego wzorca (`ConfirmDialog` + lazy fetch kluczy), nie nowa architektura.
- Powielenie renderów w `DetectionReview.tsx` (3× refine-dialog, 3× resolve-dialog, 2× rerun-dialog = 8 miejsc) jest już dziś faktem tego pliku (niezwiązanym z tym planem) — ten plan go nie naprawia (zob. „Czego NIE robimy"), tylko aplikuje tę samą, mechaniczną edycję 8×.

## Czego NIE robimy

- Nie dedukujemy/refaktorujemy powielonych 3× bloków renderowania w `DetectionReview.tsx` do wspólnego komponentu — to osobna, niezależna zmiana (ryzyko regresji w battle-tested pliku, poza kontraktem tego planu).
- Nie zmieniamy `is_active` / trwałego „aktywnego" klucza konta — override jest wyłącznie per-request.
- Nie dodajemy wyboru klucza dla „Ponów match" (rematch) — ta akcja nie woła żadnego providera BYOK (czysty Google Books/OpenLibrary).
- Nie zmieniamy DTO `ApiKeyDTO` ani `GET /api/account/keys` — kontrakt już wystarczający.
- Nie dodajemy trwałości wyboru (localStorage/sessionStorage) między otwarciami dialogu.

## Podejście do implementacji

Rozszerzenie istniejącego wzorca „provider abstraction" (S-33) o opcjonalny per-request override, analogicznie do jak `resolution-openai-compatible-provider` dodał `request_timeout_ms`/`max_tokens_override` do tej samej ścieżki — addytywne, backward-compatible zmiany kontraktu, zero migracji.

## Krytyczne szczegóły implementacji

- **Puste/brakujące body musi być tolerowane, nie 400.** Dziś wszystkie 8 wywołań UI robi `fetch(url, {method:'POST'})` BEZ body. `request.json()` na pustym body rzuca `SyntaxError`. Parsowanie w każdym z 3 endpointów musi łapać ten wyjątek i traktować go jak „brak override" (fallback do dzisiejszego zachowania `is_active`), NIE jak błąd walidacji — inaczej Faza 1 (backend) złamie wszystkie dzisiejsze callery zanim Faza 3 (frontend) zdąży zacząć wysyłać body. To odwraca zwykły wzorzec `POST /api/account/keys` (tam brak/zły JSON = 400, bo tam body jest wymagane; tutaj jest opcjonalne).
- **Rozróżnienie 403 vs 404 zależy od tego, CZY klient poprosił o konkretny klucz.** `getActiveProviderConfig` zwraca `null` w obu przypadkach (brak aktywnego klucza / podany keyId nie istnieje lub należy do innego usera — RLS + explicit `eq(user_id)` już to gwarantują). Endpoint musi rozróżnić te dwa `null`e na podstawie tego, czy `apiKeyId` było obecne w sparsowanym body: brak `apiKeyId` → dzisiejsze `403 NO_API_KEY`; obecne, ale `null` z DB → nowe `404 NOT_FOUND` (konwencja repo: RLS-scoped „nie ma / nie mój" = 404, nigdy 403 leakujący istnienie cudzego zasobu).
- **Lazy-fetch-on-open musi przetrwać refaktor do `useApiKeys`.** Dwa istniejące komentarze (`DetectionReview.tsx:781-784`, `:2904-2907`) ostrzegają, że fetch `/api/account/keys` NA MOUNT koliduje z kolejnością `mockResolvedValueOnce()` w testach niewchodzących w te dialogi. Nowy hook musi zachować identyczną semantykę: fetch wyzwalany jawnym wywołaniem (`fetchKeys()`), nigdy automatycznie w `useEffect` bez guardu na "dialog się otwiera".

## Faza 1: Backend — provider config po keyId + parsowanie body

### Przegląd

Rozszerza `getActiveProviderConfig` o opcjonalny `keyId`, dodaje mały schemat Zod na opcjonalne body, wpina w 3 endpointy z tolerancyjnym parsowaniem.

### Wymagane zmiany:

#### 1. Schemat override

**Plik**: `src/lib/keys/schema.ts`

**Cel**: Nowy, mały eksportowany schemat waliduje opcjonalne `{ apiKeyId }` w body POST-a. Reużywany przez 3 endpointy zamiast trzykrotnej duplikacji inline.

**Kontrakt**: `export const ApiKeyOverrideSchema = z.object({ apiKeyId: z.string().uuid().optional() });` — świadomie BEZ `.nullable()` na całym obiekcie (parsowanie po stronie endpointu decyduje co zrobić z brakiem/błędem JSON, zob. Krytyczne szczegóły).

#### 2. `getActiveProviderConfig` z opcjonalnym keyId

**Plik**: `src/lib/keys/getActiveProviderConfig.ts`

**Cel**: Gdy podano `keyId`, selectuje wiersz po `id + user_id` (ignorując `is_active`) zamiast po `is_active=true`. Zachowuje dzisiejszy default gdy `keyId` pominięty — 3 istniejący callerzy (dziś wywołujący bez 3. argumentu) muszą kompilować się i działać identycznie jak przed zmianą.

**Kontrakt**: `getActiveProviderConfig(supabase, userId: string, keyId?: string | null): Promise<VisionProviderConfig | null>`. Query builder: `keyId ? query.eq('id', keyId) : query.eq('is_active', true)`, zawsze z `.eq('user_id', userId)` (już dziś obecne, RLS to i tak wymusza — jawny filtr to istniejąca konwencja repo, nie nowa). Reszta funkcji (deszyfrowanie, mapowanie na `VisionProviderConfig`) bez zmian.

#### 3. Wpięcie w `resolve.ts`

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: Dodaje `request` do destrukturyzacji handlera, tolerancyjnie parsuje opcjonalne body przez `ApiKeyOverrideSchema`, przekazuje `apiKeyId` do `getActiveProviderConfig`, rozróżnia 403/404 wg obecności `apiKeyId` w body.

**Kontrakt**: Zastępuje wywołanie w linii 75 (`const providerConfig = await getActiveProviderConfig(locals.supabase, locals.user.id);`) blokiem: spróbuj `await request.json()` w try/catch (catch → `apiKeyId = undefined`), `ApiKeyOverrideSchema.safeParse`, potem `getActiveProviderConfig(locals.supabase, locals.user.id, apiKeyId)`; gdy `!providerConfig`: jeśli `apiKeyId` był podany → `apiError({code:'NOT_FOUND', status:404, message:'Wybrany klucz nie istnieje.'})`, inaczej dzisiejszy blok `NO_API_KEY`/403 (linie 76-83, bez zmian treści).

#### 4. Wpięcie w `refine.ts`

**Plik**: `src/pages/api/detections/[id]/refine.ts`

**Cel**: Identyczny wzorzec jak w (3), zastosowany do wywołania w linii 108.

**Kontrakt**: Ta sama logika co punkt 3 — dodaj `request` do destrukturyzacji (linia 92), zastąp blok wokół linii 107-116.

#### 5. Wpięcie w `process.ts`

**Plik**: `src/pages/api/photos/[id]/process.ts`

**Cel**: Identyczny wzorzec, ale `request` jest już destrukturyzowany (linia 70, używany dla `skipMatch`). Parsowanie musi nastąpić PRZED wywołaniem w linii 97, w fazie pre-stream (przed startem SSE) — zgodnie z istniejącym komentarzem klasy „Pre-stream validation... zwraca normalne JSON errors" (linie 62-63).

**Kontrakt**: Wstaw parsowanie body zaraz po odczycie `skipMatch` (linia 80), przed blokiem `ai_enabled` (linia 82) lub tuż przed wywołaniem w linii 97 — dowolna kolejność działa, o ile PRZED linią 97 i przed startem `TransformStream` (linia 186). Ten sam 403/404-split co punkt 3, zastępujący blok linii 96-105.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Testy jednostkowe przechodzą: `npx vitest run tests/unit/pages/api/detections/resolve.test.ts tests/unit/pages/api/detections/refine.test.ts tests/unit/pages/api/photos/process.test.ts tests/unit` (istniejące + nowe przypadki z Fazy 3 dla testów jednostkowych `getActiveProviderConfig`)

#### Weryfikacja ręczna:

- (brak — czysto backendowa faza, zweryfikowana automatami; ręczna weryfikacja end-to-end w Fazie 3 po podłączeniu UI)

---

## Faza 2: Frontend — infrastruktura (hook, dropdown, slot w dialogu)

### Przegląd

Buduje wielokrotnego użytku klocki: `useApiKeys` (lazy fetch listy kluczy), `ApiKeySelect` (dropdown), rozszerzenie `ConfirmDialog` o slot na dodatkową treść. Żaden z tych komponentów jeszcze nie jest wpięty w `DetectionReview.tsx` — to Faza 3.

### Wymagane zmiany:

#### 1. `ConfirmDialog` — slot na dodatkową treść

**Plik**: `src/components/ConfirmDialog.tsx`

**Cel**: Pozwala wywołującym wstrzyknąć dowolną treść (dropdown wyboru klucza) między tekstem wiadomości a przyciskami, bez zmiany istniejącego kontraktu dla pozostałych 6+ callerów tego komponentu w repo, którzy nie przekażą nowego propa.

**Kontrakt**: Nowy opcjonalny prop `children?: React.ReactNode` w `Props` (`ConfirmDialog.tsx:5-15`), renderowany jako `{children}` zaraz po `<p className="mt-2 text-sm text-gray-600">{message}</p>` (linia 60), przed `<div className="mt-4 flex justify-end gap-2">` (linia 62). Brak `children` → identyczny render jak dziś.

#### 2. `useApiKeys` hook

**Plik**: `src/components/useApiKeys.ts` (nowy)

**Cel**: Współdzielony, lazy-fetch hook zastępujący dwa dzisiejsze ad-hoc fetche (`DetectionReview.tsx:790`, `:2908`) i dostarczający dane dla trzeciego, nowego call-site'u (Faza 3). Musi zachować lazy-on-demand semantykę (zob. „Krytyczne szczegóły implementacji") — żadnego automatycznego fetcha w `useEffect` na mount.

**Kontrakt**:
```ts
function useApiKeys(): {
  keys: ApiKeyDTO[] | null;      // null = jeszcze nie załadowane
  fetchKeys: () => void;          // wyzwala GET /api/account/keys (idempotentnie bezpieczne wielokrotne wywołanie — nadpisuje keys)
}
```
Wewnątrz: `useState<ApiKeyDTO[] | null>(null)`, `fetchKeys` robi `fetch('/api/account/keys')` → `.then(r => r.json())` → `setKeys(body.data?.keys ?? [])`, `.catch` cichy (silent, jak dziś w obu istniejących miejscach — brak listy kluczy nie blokuje żadnego flow). Typ `ApiKeyDTO` importowany z `src/lib/keys/schema.ts`.

#### 3. `ApiKeySelect` komponent

**Plik**: `src/components/ApiKeySelect.tsx` (nowy)

**Cel**: Renderuje dropdown wyboru klucza gdy jest sens wyboru (≥2 klucze), w przeciwnym razie nic nie renderuje (decyzja: „ukryj selektor, brak dodatkowego tekstu" dla ≤1 klucza — sam `ConfirmDialog.message` już dziś opcjonalnie zawiera info o kluczu, np. `keyInfoLine` w `rerunConfirmMessage`, `DetectionReview.tsx:2981-2984` — ten wzorzec zostaje bez zmian dla przypadku 1-klucza).

**Kontrakt**:
```ts
function ApiKeySelect(props: {
  keys: ApiKeyDTO[] | null;
  value: string | null;
  onChange: (id: string) => void;
}): JSX.Element | null
```
Jeśli `keys === null || keys.length <= 1` → `return null`. Inaczej natywny `<select>` (wzorzec `CostAnalysisModal.tsx:150-164`, ale BEZ opcji „Wszystkie klucze"/„Bez przypisania" — tu zawsze wybieramy dokładnie jeden, realny klucz), `data-testid="api-key-select"`, opcje `${key.label} (${key.provider})`, `value={value ?? ''}`, `onChange={(e) => onChange(e.target.value)}`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- Nowe testy jednostkowe zielone: `npx vitest run tests/unit/components/ApiKeySelect.test.tsx tests/unit/components/useApiKeys.test.ts tests/unit/components/ConfirmDialog.test.tsx` (rozszerzenie istniejącego pliku jeśli istnieje, inaczej nowy)

#### Weryfikacja ręczna:

- (brak — komponenty jeszcze niewpięte do żadnego widoku; weryfikacja wizualna w Fazie 3)

---

## Faza 3: Wiring w DetectionReview.tsx + testy end-to-end

### Przegląd

Podłącza komponenty z Fazy 2 do 8 istniejących miejsc wywołania (3× refine, 3× resolve, 2× rerun-vision), zamienia dwa ad-hoc fetche na `useApiKeys`, przekazuje wybrany `apiKeyId` do handlerów i dalej do backendu z Fazy 1. Dodaje pełne pokrycie E2E (zgodnie ze standardem projektu — każdy scenariusz, nie tylko happy path).

### Wymagane zmiany:

#### 1. Podmiana ad-hoc fetchy na `useApiKeys` — DWA niezależne wywołania (plan-review F1)

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Usuwa dwa niezależne, prawie identyczne bloki fetch+setState (linie ~787-806 dla `activeProviderIsAnthropic`, ~2903-2923 dla `activeKeyInfo`), zastępuje je wywołaniami `useApiKeys()` — **w DWÓCH zasięgach, nie jednym**, bo oba stany żyją dziś w różnych komponentach: `activeProviderIsAnthropic` wewnątrz `useDetectionDecision` (linia 750, wołanego z `DetectionCard`, instancjonowanego raz na detekcję), `activeKeyInfo` w top-level `DetectionReview` (linia 2574, raz na zdjęcie). Plan-review (F1) potwierdził że to dwa różne zasięgi — jedno wspólne wywołanie wymagałoby prop-drillingu przez `DetectionCardProps` (odrzucone jako niepotrzebnie szersza zmiana; wybrano mirror dzisiejszego, już-działającego splitu).

**Kontrakt**: Dwa niezależne wywołania tej samej funkcji hooka:
- Wewnątrz `useDetectionDecision` (linia ~750): `const { keys: cardKeys, fetchKeys: fetchCardKeys } = useApiKeys();` — zasila dropdown w dialogach refine/resolve tej karty.
- W top-level `DetectionReview` (linia ~2574): `const { keys: photoKeys, fetchKeys: fetchPhotoKeys } = useApiKeys();` — zasila dropdown w dialogu rerun-vision.

W obu zasięgach: `activeKeyId = keys?.find(k => k.is_active)?.id ?? null`. `activeProviderIsAnthropic` pochodna z `cardKeys` (bez osobnego stanu). `activeKeyInfo` pochodna z `photoKeys`. Redundantny fetch między dwoma otwartymi kartami jest akceptowanym kompromisem (mirror dzisiejszego zachowania, zob. plan-review F1 Poprawka A). Wywołania `fetchCardKeys()`/`fetchPhotoKeys()` zastępują dzisiejsze inline fetche w miejscach otwarcia dialogów (patrz punkt 2) — usuwa potrzebę osobnego `useEffect` na mount dla `hasNoCandidates` (linie 787-806).

#### 2. Stan wybranego klucza + wyzwolenie fetcha przy otwarciu dialogu

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: DWA niezależne stany `selectedKeyId` — jeden w `useDetectionDecision` (refine+resolve, dzielą dialog-otwarcie-na-raz w obrębie jednej karty), jeden w top-level `DetectionReview` (rerun-vision) — analogicznie do splitu `useApiKeys()` z punktu 1. Każdy resetowany do odpowiadającego mu `activeKeyId` przy KAŻDYM otwarciu dialogu w danym zasięgu (nie tylko raz przy mount) — realizuje ustaloną semantykę „jednorazowy override, nie zapamiętany".

**Kontrakt**: W `useDetectionDecision`: `const [selectedCardKeyId, setSelectedCardKeyId] = useState<string | null>(null);`, wyzwalane w `RefineButton onClick` (linia 1549) i `AiResolutionButton onClick` (linia 1555): `fetchCardKeys(); setSelectedCardKeyId(activeKeyId);` przed `setConfirm*(true)`. W top-level `DetectionReview`: `const [selectedPhotoKeyId, setSelectedPhotoKeyId] = useState<string | null>(null);`, wyzwalane w `handleRerunVisionClick` (linia 2903): `fetchPhotoKeys(); setSelectedPhotoKeyId(activeKeyId);` przed `setConfirmRerunOpen(true)`. Po każdej faktycznej akcji (confirm/cancel) stan może zostać jak jest — kolejne otwarcie i tak go nadpisze.

#### 3. Przekazanie `apiKeyId` do handlerów akcji

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: `handleRefine`, `handleAiResolve` (oba w `useDetectionDecision`) wysyłają `selectedCardKeyId`; `runRerunVision` (top-level) wysyła `selectedPhotoKeyId` — w body POST-a, gdy ustawiony.

**Kontrakt**: `handleRefine()`/`handleAiResolve()` fetch (linie 970, 1032) zmienia się z `{ method: 'POST' }` na `{ method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ apiKeyId: selectedCardKeyId }) }` gdy `selectedCardKeyId != null`, inaczej bez body (zachowanie dzisiejsze — np. gdy `cardKeys` się jeszcze nie załadowały). `runRerunVision()` (linia 2876) przekazuje `selectedPhotoKeyId` do `runProcessSSE(photoId, { apiKeyId: selectedPhotoKeyId, onStarted: ... })` — zob. punkt 5.

#### 4. Wpięcie `ApiKeySelect` w 8 instancji `ConfirmDialog`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: `confirmRefine` ×3 (~1605, ~2005, ~2359) i `confirmAiResolve` ×3 (~1618, ~2018, ~2372) dostają `children={<ApiKeySelect keys={cardKeys} value={selectedCardKeyId} onChange={setSelectedCardKeyId} />}`; `confirmRerunOpen` ×2 (~3289, ~3627) dostaje `children={<ApiKeySelect keys={photoKeys} value={selectedPhotoKeyId} onChange={setSelectedPhotoKeyId} />}`.

**Kontrakt**: Mechaniczna edycja w 8 miejscach — dodanie jednego propa do istniejącego `<ConfirmDialog ...>`, z odpowiednim zestawem (`cardKeys`/`selectedCardKeyId` vs `photoKeys`/`selectedPhotoKeyId`) zależnie od tego, w którym z dwóch zasięgów (punkt 1) dana instancja żyje. Brak zmian w innych propach.

#### 5. `runProcessSSE` — nowa sygnatura z opcjonalnym `apiKeyId`

**Plik**: `src/lib/vision/runProcessSSE.ts`

**Cel**: Jedyny caller (`DetectionReview.tsx:2876`) musi móc przekazać wybrany klucz; funkcja dokleja go do body POST-a.

**Kontrakt**: `runProcessSSE(photoId: string, opts?: { apiKeyId?: string | null; onStarted?: () => void }): Promise<ProcessSSEResult>`. Fetch (linia 22) zmienia się na `{ method: 'POST', ...(opts?.apiKeyId ? { headers: {'Content-Type':'application/json'}, body: JSON.stringify({apiKeyId: opts.apiKeyId}) } : {}) }`. `onStarted` przenosi się z 2. pozycyjnego argumentu do pola `opts.onStarted` — jedyny call-site aktualizowany w tym samym kroku.

#### 6. Testy jednostkowe (Vitest) — rozszerzenie istniejących plików

**Pliki**: `tests/unit/pages/api/detections/resolve.test.ts` (252 linii), `tests/unit/pages/api/detections/refine.test.ts` (525 linii), `tests/unit/pages/api/photos/process.test.ts` (583 linii)

**Cel**: Nowe przypadki: (a) body z poprawnym `apiKeyId` innego (ale własnego) klucza → używa tego klucza, nie aktywnego; (b) body z `apiKeyId` nieistniejącym/cudzym → `404 NOT_FOUND`; (c) brak body / puste body → dzisiejsze zachowanie bez zmian (regresja guard).

**Kontrakt**: Rozszerzenie istniejących `describe` bloków, mockowanie `request.json()` analogicznie do wzorców już obecnych w tych plikach dla innych pól.

#### 7. Testy E2E (Playwright) — nowy spec

**Plik**: `tests/e2e/byok-key-override.spec.ts` (nowy, wzorowany na `tests/e2e/byok-enforcement.spec.ts`, 109 linii)

**Cel**: Pełne pokrycie zgodnie ze standardem projektu (nie tylko happy path): (1) konto z 2 kluczami BYOK — dropdown widoczny w każdym z 3 dialogów, domyślnie aktywny klucz zaznaczony; (2) wybór innego klucza + potwierdzenie → `page.route` przechwytuje POST i asertuje `apiKeyId` w body; (3) konto z 1 kluczem — dropdown NIE renderuje się w żadnym z 3 dialogów (regresja dzisiejszego UX); (4) wybrany klucz usunięty tuż przed potwierdzeniem (drugi tab / API call) → `404`, czytelny komunikat błędu w UI, brak crasha.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- `npx vitest run` — cały unit suite zielony (żadnej regresji w pozostałych ~845 testach)
- `npm run test:e2e` — cały E2E suite zielony, w tym nowy `byok-key-override.spec.ts`
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- Na koncie z 2 kluczami: otworzyć dialog „Doprecyzować odczyt?" / „Rozwiązać przez AI?" / „Ponowić vision?" — dropdown pokazuje oba klucze, domyślnie aktywny; wybór drugiego i potwierdzenie faktycznie używa go (widoczne np. w `vision_runs.model`/`api_key_id` w Supabase Studio albo w panelu kosztów `/account`)
- Na koncie z 1 kluczem: te same 3 dialogi wyglądają jak dziś (brak dropdowna)
- `is_active` w `user_api_keys` NIE zmienia się po użyciu override (sprawdzić w Supabase Studio przed/po)

---

## Strategia testowania

### Testy jednostkowe:

- `getActiveProviderConfig` — nowa gałąź `keyId` podana (istniejący/nieistniejący/cudzy), nowa vs stara sygnatura (bez 3. argumentu = bez zmian)
- 3 endpointy — parsowanie body: brak, puste, poprawne, z nieistniejącym `apiKeyId`
- `ApiKeySelect` — 0/1/2+ kluczy, `onChange` wywołuje callback z poprawnym id
- `ConfirmDialog` — `children` renderuje się gdy podane, nic się nie zmienia gdy pominięte

### Testy integracyjne:

- Brak nowych — RLS-owa izolacja kluczy jest już pokryta istniejącymi testami integracyjnymi `user_api_keys` (jeśli istnieją; jeśli nie, poza zakresem tego planu — kontrakt opiera się na już-działającej RLS z migracji 0016).

### Kroki testowania ręcznego:

1. Zalogować się na konto z ≥2 kluczami BYOK (np. demo, po tej sesji ma `glm-ocr` + `rav_lmstudio-qwen3.5-9b`)
2. Otworzyć detekcję bez kandydatów → kliknąć „Rozwiąż przez AI" → sprawdzić dropdown, zmienić wybór, potwierdzić, sprawdzić że użyty klucz to wybrany (nie domyślny aktywny)
3. To samo dla „Doprecyzuj odczyt" i „Ponów vision"
4. Usunąć jeden z kluczy tak, żeby zostać z jednym → sprawdzić że dropdown znika, dialog wygląda jak przed zmianą

## Uwagi dotyczące migracji

Brak migracji SQL — `user_api_keys.id` + RLS już wystarczają do lookupu po konkretnym kluczu.

## Referencje

- Wzorzec provider abstraction: `context/archive/2026-07-14-resolution-openai-compatible-provider/plan.md`
- `src/lib/keys/getActiveProviderConfig.ts:7-46`
- `src/components/ConfirmDialog.tsx`
- `src/components/CostAnalysisModal.tsx:150-164` (wzorzec select)
- `src/components/DetectionReview.tsx` (linie wskazane inline wyżej)
- `src/lib/vision/runProcessSSE.ts`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Backend — provider config po keyId + parsowanie body

#### Automatyczne

- [x] 1.1 `npm run typecheck` przechodzi — 3e89dc9
- [x] 1.2 `npm run lint` przechodzi — 3e89dc9
- [x] 1.3 Testy jednostkowe resolve/refine/process + getActiveProviderConfig zielone — 3e89dc9

### Faza 2: Frontend — infrastruktura (hook, dropdown, slot w dialogu)

#### Automatyczne

- [x] 2.1 `npm run typecheck` przechodzi — e1322d5
- [x] 2.2 `npm run lint` przechodzi — e1322d5
- [x] 2.3 Nowe testy jednostkowe (ApiKeySelect, useApiKeys, ConfirmDialog) zielone — e1322d5

### Faza 3: Wiring w DetectionReview.tsx + testy end-to-end

#### Automatyczne

- [x] 3.1 `npm run typecheck` przechodzi
- [x] 3.2 `npm run lint` przechodzi
- [x] 3.3 Cały unit suite zielony (`npx vitest run`) — 1241/1241
- [x] 3.4 Cały E2E suite (`npm run test:e2e`) — 246 passed + nowy `byok-key-override.spec.ts` (10/10) + 12 skipped (env-gated); 1 fail w `admin.spec.ts` potwierdzony jako pre-existing (identyczny fail na `git stash` bez zmian tego planu), niezwiązany z BYOK
- [x] 3.5 `npm run build` przechodzi

#### Ręczne

- [ ] 3.6 Dropdown działa poprawnie na koncie z 2 kluczami (3 akcje)
- [ ] 3.7 Dropdown ukryty na koncie z 1 kluczem (3 akcje)
- [ ] 3.8 `is_active` niezmienione po użyciu override
