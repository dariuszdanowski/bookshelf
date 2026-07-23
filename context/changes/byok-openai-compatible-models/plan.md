# Model picker dla klucza BYOK openai_compatible — Plan implementacji

## Przegląd

Dodajemy do sekcji "Klucze API" (`AccountIsland.tsx`) przycisk "Załaduj modele" widoczny obok pola "Model" dla kluczy `openai_compatible` — zarówno w formularzu dodawania nowego klucza, jak i edycji istniejącego. Po kliknięciu, serwer odpytuje `GET {base_url}/v1/models` używając podanego (lub już zapisanego, jeśli pole klucza zostało puste w edycji) klucza API i zwraca listę modeli ze znacznikiem dostępności. Kliknięcie modelu na liście wpisuje jego dokładny identyfikator w pole Model.

## Analiza stanu obecnego

- `src/components/AccountIsland.tsx` — sekcja "Klucze API" ma add-form (`addForm`/`addOpen`) i edit-form (`editForm`/`editingId`) z polami `label`, `provider`, `base_url` (tylko dla `openai_compatible`), `model` (zawsze, tekst wolny), `key_value`, `request_timeout_ms`/`max_tokens_override` (dla providerów innych niż `anthropic`).
- `src/lib/keys/probe.ts` — `probeKey(provider, apiKey, baseUrl)` zwraca `'ok'|'error'` przez `GET /v1/models` na providerze; zna już URL/nagłówki dla wszystkich 4 providerów (`anthropic`, `openai`, `openrouter`, `openai_compatible`). Dla `openai_compatible` buduje `${baseUrl}/v1/models` — zakłada, że `baseUrl` jest już znormalizowany (bez trailing `/v1`).
- `src/lib/keys/schema.ts` — `normalizeBaseUrl()` (prywatna funkcja modułowa) usuwa trailing slash i `/v1` z URL-a przy zapisie (`baseUrlField` transform). `CreateKeySchema`/`UpdateKeySchema` używają jej automatycznie. Add-form dziś wysyła surowy `base_url` do `POST /api/account/keys` dopiero przy zapisie — normalizacja dzieje się tam, nie wcześniej.
- `src/pages/api/account/keys/[id]/test.ts` — precedens "probe-style" endpointu: zawsze zwraca `200` z `{data:{result:'ok'|'error'}}` (probe failure to wynik testu, nie błąd serwera 4xx/5xx), dekryptuje zapisany klucz przez `decryptWithEnvKey`.
- Brak dziś jakiegokolwiek sposobu zobaczenia listy modeli przed zapisaniem klucza — user musi znać dokładny string modelu z dokumentacji swojego serwera.

## Pożądany stan końcowy

W formularzu dodawania i edycji klucza `openai_compatible`: po wpisaniu base URL i klucza API (w edycji: klucz może zostać pusty — używamy wtedy już zapisanego), przycisk "Załaduj modele" staje się aktywny. Kliknięcie odpytuje serwer, pokazuje stan ładowania, a po sukcesie — listę modeli z widocznym znacznikiem "Dostępny"/"Niedostępny" przy każdym. Kliknięcie pozycji na liście wypełnia pole Model dokładnym identyfikatorem i chowa listę. Błąd sieci/złego adresu/klucza pokazuje czytelny komunikat błędu inline, bez wyjątku w konsoli.

### Kluczowe odkrycia:

- `probeKey` (`src/lib/keys/probe.ts:13-47`) ma gotowy switch URL/nagłówków per provider — nowa funkcja `listModels` powinna go reużyć (refaktor do wspólnego resolvera), nie duplikować.
- `normalizeBaseUrl` (`src/lib/keys/schema.ts:11-13`) jest dziś prywatna — musi zostać wyeksportowana, bo add-form wysyła surowy `base_url` (może mieć trailing `/v1`) *przed* zapisem klucza, czyli przed jedynym miejscem, które dziś normalizuje.
- Wzorzec "probe-style endpoint zawsze 200" z `test.ts` (linia 16-60) jest bezpośrednim precedensem dla nowego endpointu — nie wynajdywać nowej konwencji błędów.
- `editForm.key_value` puste = "nie zmieniaj klucza" (istniejący komentarz w UI, linia ~1131) — endpoint listowania modeli musi honorować tę samą semantykę przez fallback na `id` + odszyfrowanie zapisanego `encrypted_key`.

## Czego NIE robimy

- Nie wystawiamy przycisku "Załaduj modele" dla providerów `anthropic`/`openai`/`openrouter` w UI (lib funkcja jest generyczna, ale to świadomie odłożone rozszerzenie na przyszłość, nie część tego slice'a).
- Nie cache'ujemy/persystujemy listy modeli między sesjami czy w DB — to efemeryczny fetch on-demand.
- Nie zmieniamy zachowania istniejącego przycisku "Testuj" ani `probeKey()` poza wewnętrznym refaktorem współdzielenia URL/nagłówków (zero zmiany zewnętrznego zachowania `probeKey`).
- Nie dodajemy timeoutu do `probeKey` — tylko do nowej `listModels` (patrz „Krytyczne szczegóły implementacji”).

## Podejście do implementacji

Trzy fazy: (1) backend — lib funkcja + Zod schema + endpoint + testy jednostkowe, (2) frontend — UI w `AccountIsland.tsx` + testy komponentu, (3) E2E — Playwright z zamockowanym własnym endpointem (zgodnie z regułą projektu: zero realnych wywołań zewnętrznych w automatach). Faza 1 i 2 są rozdzielne (backend nie zależy od UI), ale UI (faza 2) zależy od kontraktu endpointu z fazy 1.

## Krytyczne szczegóły implementacji

- **Timeout na `listModels`**: `fetch` do `{base_url}/v1/models` w nowej funkcji dostaje `signal: AbortSignal.timeout(10_000)` — lokalny serwer (np. relay z WS-bridge do prywatnej maszyny) może nigdy nie odpowiedzieć, a endpoint nie może wisieć w nieskończoność. `probeKey` **zostaje bez zmian** (brak timeoutu tam) — nie rozszerzamy istniejącego zachowania poza zakres tego planu.
- **Reset stanu listy modeli**: `addModels`/`editModels` (lista + loading + error) muszą być czyszczone (`{loading:false, error:null, list:[]}`) w czterech miejscach: otwarcie add-formu (`setAddOpen(true)`), anulowanie add-formu, `openEdit()`, anulowanie edycji — inaczej stara lista z poprzedniego base_url/klucza zostaje widoczna po zmianie kontekstu. Dodatkowo czyścimy przy każdej zmianie `base_url`/`key_value` w danym formularzu (stale list dla innego serwera myliłaby użytkownika).

## Faza 1: Backend — lib, schema, endpoint

### Przegląd

Nowa funkcja `listModels()` w `probe.ts` (reużywa URL/nagłówki z `probeKey` przez wspólny resolver), nowy Zod schema walidujący input, nowy endpoint `POST /api/account/keys/models` zwracający listę modeli ze znacznikiem dostępności.

### Wymagane zmiany:

#### 1. `src/lib/keys/schema.ts`

**Cel**: Wyeksportować `normalizeBaseUrl` (dziś prywatna), żeby nowy endpoint mógł znormalizować surowy `base_url` z add-formu przed zbudowaniem URL-a `/v1/models` — dokładnie ten sam problem podwójnego `/v1/v1`, który `baseUrlField` już rozwiązuje przy zapisie klucza. Dodać `ListModelsInputSchema` walidujący ciało nowego endpointu.

**Kontrakt**:
```ts
export function normalizeBaseUrl(url: string): string { ... }  // był prywatny, teraz export — logika bez zmian

export const ListModelsInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    provider: ProviderEnum,
    base_url: z.string().url().max(500),
    key_value: z.string().min(1).max(500).optional(),
  })
  .refine((d) => d.id !== undefined || d.key_value !== undefined, {
    message: 'id or key_value required',
  });
export type ListModelsInput = z.infer<typeof ListModelsInputSchema>;
```
`base_url` jest tu **wymagany** (nie `.nullish()` jak w `CreateKeySchema`) — nie ma sensu listować modeli bez adresu.

#### 2. `src/lib/keys/probe.ts`

**Cel**: Wydzielić budowanie URL/nagłówków z `probeKey` do wspólnej funkcji, żeby nowa `listModels` mogła ją reużyć bez duplikacji. Dodać `listModels()`, który odpytuje `/v1/models`, parsuje odpowiedź defensywnie (obsługa zarówno `{data:[...]}` jak i gołej tablicy — oba kształty występują w praktyce u różnych providerów OpenAI-compatible) i wylicza znacznik dostępności heurystyką na polach `available`/`is_available`/`status`/`state`, domyślnie `true` gdy żadne z tych pól nie występuje.

**Kontrakt**:
```ts
export type ProviderModelInfo = { id: string; available: boolean };

export async function listModels(
  provider: z.infer<typeof ProviderEnum>,
  apiKey: string,
  baseUrl?: string | null,
): Promise<{ ok: boolean; models: ProviderModelInfo[] }>
```
- Reużywa wewnętrzny resolver URL/nagłówków wydzielony z `probeKey` (`resolveModelsRequest(provider, apiKey, baseUrl): {url, headers} | null`); `probeKey` refaktoryzowany do korzystania z tego samego resolvera — **zero zmiany zewnętrznego zachowania `probeKey`** (te same testy manualne/`test.ts` przechodzą identycznie).
- `fetch(url, { headers, signal: AbortSignal.timeout(10_000) })` — 10s timeout (nowość, tylko tutaj, patrz „Krytyczne szczegóły implementacji").
- Nie-2xx / network error / JSON parse error → `{ ok: false, models: [] }` (żaden wyjątek nie ucieka).
- Parsowanie listy: `Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []`, filtr do wpisów z `typeof entry.id === 'string'`.
- Heurystyka dostępności per wpis: `available`/`is_available` (boolean) ma priorytet; potem `status`/`state` (string, lowercased) — wartości z `{'offline','unavailable','down','disabled','inactive','error'}` → `false`; wszystko inne, w tym brak pola → `true`.
- Sortowanie wyniku: dostępne najpierw, potem alfabetycznie po `id` (`models.sort((a,b) => Number(b.available) - Number(a.available) || a.id.localeCompare(b.id))`).

#### 3. `src/pages/api/account/keys/models.ts` (nowy plik)

**Cel**: Endpoint `POST` przyjmujący provider/base_url/(key_value LUB id), rozwiązujący plaintext klucza (bezpośrednio z body, albo przez odszyfrowanie zapisanego wiersza po `id`), wołający `listModels()` i zwracający wynik. Mirror stylu `[id]/test.ts` — zawsze `200`, wynik probe'u w payloadzie, nie w kodzie HTTP.

**Kontrakt**:
```ts
export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => { ... }
```
- 401 `UNAUTHENTICATED`, jeśli brak `locals.user` (przed czymkolwiek innym — privacy-first).
- Parsuj JSON body → 400 `VALIDATION_ERROR` na złym JSON lub `ListModelsInputSchema.safeParse` fail (to jest prawdziwa walidacja inputu, w odróżnieniu od wyniku probe'u).
- `base_url = normalizeBaseUrl(parsed.data.base_url)`.
- Rozwiązanie `apiKey`:
  - jeśli `parsed.data.key_value` obecne → użyj bezpośrednio (add-form / edit-form z nowym kluczem),
  - inaczej (edit-form z pustym polem klucza) → `SELECT encrypted_key FROM user_api_keys WHERE id = parsed.data.id AND user_id = locals.user.id` → 404 `NOT_FOUND` jeśli brak wiersza (ten sam privacy-pattern co `[id]/test.ts`) → `decryptWithEnvKey`.
- `const { ok, models } = await listModels(parsed.data.provider, apiKey, base_url)`.
- `return apiResponse({ data: { result: ok ? 'ok' : 'error', models } })` — zawsze `200`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi
- `npx astro check` (typecheck) przechodzi
- Nowe testy jednostkowe `tests/unit/lib/keys/probe.test.ts` (nowy plik — pokrywa `listModels`: happy path z mieszaną dostępnością, brak pól dostępności → wszystkie `available:true`, non-2xx → `ok:false`, network error → `ok:false`, kształt odpowiedzi jako gołą tablicę i jako `{data:[...]}`) przechodzą
- Rozszerzone testy `tests/unit/lib/keys/schema.test.ts` (export `normalizeBaseUrl`, `ListModelsInputSchema` — wymaga `id` lub `key_value`, odrzuca gdy oba brak, wymaga poprawnego URL w `base_url`) przechodzą
- Nowy plik `tests/unit/pages/api/account/keys/models.test.ts` (401 bez usera, 400 na złym body, ścieżka `key_value` bezpośrednio, ścieżka `id`→decrypt z zamockowanym Supabase, 404 gdy `id` nie należy do usera, `result:'error'` gdy `listModels` zwraca `ok:false`) przechodzi
- `npm test` (cała suita) zielone — brak regresji w istniejących testach `probe`/`test.ts`/`AccountIsland`

---

## Faza 2: Frontend — UI w AccountIsland

### Przegląd

Przycisk "Załaduj modele" obok pola Model + klikalna lista ze znacznikiem dostępności, symetrycznie w add-formie i edit-formie, tylko dla `provider === 'openai_compatible'`.

### Wymagane zmiany:

#### 1. `src/components/AccountIsland.tsx`

**Cel**: Dodać stan dla listy modeli (osobno dla add-formu i edit-formu — edit ma tylko jeden otwarty wiersz naraz, więc pojedynczy stan wystarcza), handler odpytujący nowy endpoint, przycisk i renderowanie listy w obu formularzach. Czyścić stan listy przy otwarciu/zamknięciu formularza i przy zmianie `base_url`/`key_value` (patrz „Krytyczne szczegóły implementacji" w nagłówku planu).

**Kontrakt**:
```ts
type ModelListState = { loading: boolean; error: string | null; list: { id: string; available: boolean }[] };
const [addModels, setAddModels] = useState<ModelListState>({ loading: false, error: null, list: [] });
const [editModels, setEditModels] = useState<ModelListState>({ loading: false, error: null, list: [] });

async function handleLoadModels(
  opts: { baseUrl: string; keyValue: string; id?: string },
  setState: (s: ModelListState) => void,
): Promise<void> { /* POST /api/account/keys/models, patrz kontrakt endpointu Fazy 1 */ }
```
- Przycisk (`account-keys-models-btn` w add-formie, `account-key-edit-models-btn-${key.id}` w edit-formie) renderowany tylko gdy `provider === 'openai_compatible'`, obok labelki "Model".
  - Add-form: `disabled={!addForm.base_url || !addForm.key_value || addModels.loading}` (brak zapisanego klucza — oba pola wymagane).
  - Edit-form: `disabled={!editForm.base_url || editModels.loading}` (klucz może być pusty — fallback na `id`).
- Lista renderowana pod polem Model (widoczna tylko gdy `list.length > 0`): scrollowalny kontener (`max-h-40 overflow-y-auto`), każdy wpis to `<button>` z tekstem `id` modelu + badge "Dostępny" (zielony)/"Niedostępny" (szary/czerwony) — klik ustawia `addForm.model`/`editForm.model` na `id` i czyści `list: []` (chowa listę).
- Stany `loading`/`error` renderowane inline pod przyciskiem (`account-keys-models-loading`/`account-keys-models-error`, analogicznie `-${key.id}` w edit-formie).
- Reset `addModels`/`editModels` do `{loading:false, error:null, list:[]}`:
  - w handlerze otwarcia add-formu (przycisk "Dodaj klucz") i anulowania add-formu,
  - w `openEdit()` i w handlerze anulowania edycji,
  - w `onChange` handlerach `base_url`/`key_value` obu formularzy (dopisać `setAddModels({loading:false,error:null,list:[]})`/`setEditModels(...)` obok istniejącego `setAddForm`/`setEditForm`).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi
- `npx astro check` przechodzi
- Rozszerzone `tests/unit/components/AccountIsland.test.tsx` (reużywają istniejący helper `stubFetch` z linii 30-40 tego pliku, nie ad-hoc mocki): przycisk niewidoczny dla `anthropic`/`openai`/`openrouter`, widoczny i disabled bez base_url/klucza dla `openai_compatible` (add-form), klik → fetch z poprawnym body → render listy z badge'ami dostępności, klik na model → pole Model wypełnione + lista znika, błąd sieci → komunikat inline, analogiczne przypadki dla edit-formu (w tym ścieżka z pustym `key_value` — sprawdzić że `id` klucza trafia w body zamiast `key_value`) przechodzą
- `npm test` zielone

---

## Faza 3: E2E + weryfikacja końcowa

### Przegląd

Playwright spec pokrywający golden path (add-form i edit-form) z zamockowanym `POST /api/account/keys/models` — zero realnego wywołania zewnętrznego serwera, zgodnie z regułą projektu.

### Wymagane zmiany:

#### 1. `tests/e2e/byok-model-picker.spec.ts` (nowy plik)

**Cel**: E2E golden path — otwórz `/account`, dodaj klucz `openai_compatible` z base_url+key, kliknij "Załaduj modele" (zamockowana odpowiedź z mieszaną dostępnością), zweryfikuj listę i znaczniki, kliknij model, zweryfikuj wypełnienie pola. Osobny scenariusz dla edit-formu istniejącego klucza z pustym polem klucza (weryfikuje, że request idzie z `id`, nie z `key_value`). Plus scenariusz błędu (mock zwraca `result:'error'` lub network error → komunikat inline, brak crasha).

**Kontrakt**: Wzorzec identyczny z istniejącym `tests/e2e/byok-key-override.spec.ts` — mockuje CAŁY endpoint aplikacji (nie zewnętrzny serwer), zgodnie z regułą "E2E zawsze mockuje vision/match/external przez page.route". Zgodnie z regułą `lessons.md` § „Playwright page.route() — predykat pathname zamiast glob-stringa": `page.route((url) => url.pathname === '/api/account/keys/models', handler)`, **nie** glob-string `'**/api/account/keys/models'`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` przechodzi
- `npx astro check` przechodzi
- `npm test` (cała suita) zielone
- Nowy spec `tests/e2e/byok-model-picker.spec.ts` zielony lokalnie (`npx playwright test byok-model-picker`)
- `npm run build` przechodzi

#### Weryfikacja ręczna:

- Użytkownik otwiera `/account`, dodaje/edytuje klucz `openai_compatible` ze swoim realnym (lub lokalnym) serwerem OpenAI-compatible, klika "Załaduj modele" i potwierdza, że lista + znaczniki dostępności wyglądają sensownie na żywym serwerze
- Brak regresji w istniejących przepływach kluczy API (dodawanie/edycja/test/aktywacja innych providerów)

---

## Strategia testowania

### Testy jednostkowe:

- `listModels()`: mieszana dostępność, brak pól dostępności (default `true`), non-2xx, network error, oba kształty odpowiedzi (goła tablica / `{data:[...]}`), sortowanie (dostępne pierwsze, potem alfabetycznie)
- `ListModelsInputSchema`: wymaga `id` lub `key_value`, wymaga poprawnego URL w `base_url`
- Endpoint: 401, 400 (zły JSON / schema fail), ścieżka `key_value`, ścieżka `id`→decrypt, 404 dla cudzego/nieistniejącego `id`, `result:'error'` propagacja
- Komponent: widoczność przycisku per provider, disabled states, render listy + badge'y, wybór modelu, czyszczenie stanu przy zmianie kontekstu, błędy

### Testy integracyjne:

- Nie dotyczy (brak zmian schematu DB/RLS)

### Kroki testowania ręcznego:

1. Otwórz `/account`, dodaj nowy klucz `openai_compatible`, wpisz realny base_url + klucz swojego serwera, kliknij "Załaduj modele" — sprawdź listę i znaczniki
2. Kliknij model z listy — sprawdź, że pole Model wypełniło się dokładnym identyfikatorem
3. Zapisz klucz, otwórz edycję, zostaw pole klucza puste, kliknij "Załaduj modele" ponownie — sprawdź że działa bez podawania klucza na nowo
4. Wpisz błędny base_url/klucz — sprawdź czytelny komunikat błędu

## Uwagi dotyczące wydajności

10s timeout na `listModels` chroni przed zawieszeniem endpointu przy niereagującym serwerze (np. offline WS-relay).

## Uwagi dotyczące migracji

Nie dotyczy — brak zmian schematu DB.

## Referencje

- Precedens probe-style endpoint: `src/pages/api/account/keys/[id]/test.ts`
- Istniejący `probeKey`: `src/lib/keys/probe.ts:13-47`
- Normalizacja base_url: `src/lib/keys/schema.ts:11-20`
- Wzorzec E2E mock własnego endpointu: `tests/e2e/byok-key-override.spec.ts`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków.

### Faza 1: Backend — lib, schema, endpoint

#### Automatyczne

- [x] 1.1 npm run lint przechodzi — fbf6d17
- [x] 1.2 npx astro check przechodzi — fbf6d17
- [x] 1.3 tests/unit/lib/keys/probe.test.ts (nowy) przechodzi — fbf6d17
- [x] 1.4 tests/unit/lib/keys/schema.test.ts (rozszerzony) przechodzi — fbf6d17
- [x] 1.5 tests/unit/pages/api/account/keys/models.test.ts (nowy) przechodzi — fbf6d17
- [x] 1.6 npm test (cała suita) zielone — fbf6d17

### Faza 2: Frontend — UI w AccountIsland

#### Automatyczne

- [x] 2.1 npm run lint przechodzi — 81c0dcb
- [x] 2.2 npx astro check przechodzi — 81c0dcb
- [x] 2.3 tests/unit/components/AccountIsland.test.tsx (rozszerzony) przechodzi — 81c0dcb
- [x] 2.4 npm test zielone — 81c0dcb

### Faza 3: E2E + weryfikacja końcowa

#### Automatyczne

- [ ] 3.1 npm run lint przechodzi
- [ ] 3.2 npx astro check przechodzi
- [ ] 3.3 npm test zielone
- [ ] 3.4 tests/e2e/byok-model-picker.spec.ts zielony lokalnie
- [ ] 3.5 npm run build przechodzi

#### Ręczne

- [ ] 3.6 Realny serwer OpenAI-compatible: lista + znaczniki dostępności wyglądają sensownie
- [ ] 3.7 Brak regresji w istniejących przepływach kluczy API
