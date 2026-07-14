# AI book resolution przez BYOK openai_compatible provider — plan implementacji

## Przegląd

Dziś `src/lib/resolution/client.ts` (AI book resolution fallback, S-50) jest zablokowany wyłącznie do providera `anthropic`, bo używa natywnego narzędzia Claude `web_search_20250305`. `src/pages/api/detections/[id]/resolve.ts` odrzuca każdy inny provider kodem `403 AI_RESOLUTION_PROVIDER_UNSUPPORTED`. Tymczasem `src/lib/vision/client.ts` już od S-33 ma gotową, zero-kodową ścieżkę `openai_compatible` (`fetch {baseUrl}/v1/chat/completions`).

User potwierdził (empirycznie, na własnym self-hosted OpenAI-compatible relayu `cf-llm-relay`, model `RAV_LAPTOP::Qwen/Qwen3.6-27B`) że self-hosted model daje sensowne wyniki identyfikacji książek z tekstu (10-25s, poprawny JSON) i poprawnie interpretuje obrazy. Decyzja: **pełne przełączenie bez logiki hybrydowej** — aktywny klucz BYOK typu `openai_compatible` obsługuje CAŁĄ ścieżkę (vision i resolution), tak jak dziś działa to dla vision. Ten plan rozszerza `resolution/client.ts` o analogiczny branch `openai_compatible` (bez `web_search` — self-hosted model nie ma live-lookup, więc identyfikacja opiera się wyłącznie na wiedzy treningowej modelu) i zdejmuje blokadę w `resolve.ts`.

Przy okazji (decyzja usera w trakcie planowania): modele "thinking" (Qwen3-family) potrafią zjeść cały budżet tokenów na `reasoning_content` bez dojścia do finalnej odpowiedzi, a wolniejsze węzły relaya potrafią zawiesić się bez odpowiedzi >120s. Stąd nowa, **wspólna dla vision i resolution** konfiguracja timeout/max_tokens per-klucz BYOK (nie stała w kodzie).

## Analiza stanu obecnego

### Kluczowe odkrycia:

- `src/lib/vision/client.ts:99-145` (`detectSpinesOpenAICompat`) — istniejący wzorzec fetch do `{baseUrl}/v1/chat/completions`, `image_url` z `data:...;base64,...`, `costUsd: 0`, single-attempt (brak retry-z-thinking). Brak jakiegokolwiek timeoutu na ten `fetch()` dziś.
- `src/lib/resolution/client.ts:94-150` (`resolveBookViaAI`) — wyłącznie Anthropic SDK + `tools: [{type:'web_search_20250305', ...}]`. `AiResolutionProviderConfig` (linia 17-22) ma tylko `{apiKey, model, keyId}` — brak `provider`/`baseUrl`.
- `src/pages/api/detections/[id]/resolve.ts:84-92` — twardy guard `providerConfig.provider !== 'anthropic'` → `403`. `AI_RESOLUTION_CONFIDENCE_FLOOR = 0.5` (linia 16) już jest provider-agnostyczny — działa na `outcome.result.confidence` niezależnie od tego, jak wynik powstał, więc anti-halucynacyjny confidence-gate z pytań planistycznych **już istnieje**, nie trzeba go dopisywać osobno.
- `src/lib/keys/getActiveProviderConfig.ts` — SELECT `id, provider, encrypted_key, model, base_url` z `user_api_keys`, zwraca `VisionProviderConfig`. Używane w `process.ts`, `refine.ts` i `resolve.ts` (mimo nazwy typu — resolve.ts dziś czyta tylko `apiKey`/`model`/`keyId` z tego samego zwróconego obiektu).
- `supabase/migrations/0016_user_api_keys.sql` — `provider text check (...)`, `model text`, `base_url text`, brak kolumn timeout/tokenów.
- `supabase/migrations/0027_ai_book_resolution_substrate.sql` — `resolution_calls` ma `model`, `api_key_id`, ale brak kolumny `provider`.
- `src/lib/keys/schema.ts` — `ProviderEnum`, `CreateKeySchema`, `UpdateKeySchema`, `ApiKeyDTO` — źródło prawdy dla walidacji i kształtu DTO kluczy.
- `src/components/AccountIsland.tsx:674-855` — formularze add/edit kluczy, `base_url` pokazywane warunkowo gdy `provider === 'openai_compatible'`. Wzorzec do powielenia dla nowych pól.
- `src/components/DetectionReview.tsx:135-161` (`AiResolutionButton`) + 3× zduplikowany `ConfirmDialog` (linie ~1566-1573, ~1955-1962, ~2299-2306) z tekstem *"wymaga aktywnego klucza Anthropic"* / *"Operacja jest płatna"* — nieprawdziwe po tej zmianie dla `openai_compatible`. `src/components/PhotoUploader.tsx:284-290` — istniejący wzorzec `fetch('/api/account/keys')` do odczytu aktywnego klucza po stronie klienta (do powielenia dla wykrycia aktywnego providera).
- `tests/unit/lib/vision/client.test.ts:193-278` i `tests/unit/lib/resolution/client.test.ts` — wzorce testowe do powielenia (`vi.stubGlobal('fetch', ...)` dla openai-compat, `vi.mock('@anthropic-ai/sdk')` dla anthropic).
- Migracje: ostatnia to `0029_candidate_full_edit.sql` → nowa to `0030_...`.

## Pożądany stan końcowy

User z aktywnym kluczem BYOK typu `openai_compatible` (np. wskazującym na własny self-hosted relay) może:
1. Uruchomić detekcję wizyjną (już działa, bez zmian w tym planie poza consumpcją nowego configu timeout/tokenów).
2. Kliknąć „Rozwiąż przez AI" na detekcji bez kandydatów — wywołanie idzie przez ten sam self-hosted model (bez `web_search`), wynik trafia do `book_candidates` identycznie jak dla Anthropic, z `resolution_calls.provider` zapisanym do telemetrii.
3. Ustawić per-klucz `request_timeout_ms` / `max_tokens_override` w `/account`, gdy domyślne wartości nie pasują do konkretnego self-hosted modelu (np. wolny model "thinking").
4. Zobaczyć w UI krótką informację, że aktywny provider nie ma dostępu do internetu (mniejsza trafność dla niszowych wydań), gdy aktywny klucz to nie-Anthropic.

Weryfikacja: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` przechodzą; manualny smoke z realnym self-hosted relayem (user-only, poza automatami — koszt/dostępność poza CI).

## Czego NIE robimy

- Nie dodajemy web_search ani żadnego innego narzędzia function-calling dla providera `openai_compatible` — self-hosted model odpowiada wyłącznie z wiedzy treningowej.
- Nie zmieniamy triggera resolution (nadal fallback po nieudanej strukturalnej kaskadzie — bez zmian w warunku widoczności przycisku).
- Nie zmieniamy `AI_RESOLUTION_BUDGET_LIMITS` (3/zdjęcie, 1/akcję, 20/dzień) — identyczne dla każdego providera.
- Nie dodajemy nowego enuma `book_candidates.source` — zostaje `'ai_resolution'` niezależnie od providera.
- Nie dotykamy `probeKey()` (`src/lib/keys/probe.ts`) — test klucza (`GET /v1/models`) już działa provider-agnostycznie.
- Nie zmieniamy zachowania Anthropic path (ani w vision, ani w resolution) — nowe kolumny timeout/max_tokens są opcjonalne (`null` = bez zmian względem dziś).

## Podejście do implementacji

Rozszerzamy istniejący wzorzec „provider abstraction" (S-33) zamiast projektować nowy. `resolution/client.ts` dostaje branch `provider !== 'anthropic'` analogiczny do `vision/client.ts::detectSpinesOpenAICompat` — osobna funkcja fetch, osobny (nowy) prompt bez wzmianek o `web_search`, ten sam `AiResolutionResultSchema` (już provider-agnostyczny, bo to kontrakt wyjściowy, nie wejściowy). Nowe kolumny `user_api_keys.request_timeout_ms` / `max_tokens_override` są czytane przez OBA moduły (`vision/client.ts` i `resolution/client.ts`) w ich openai-compat branchach — zero duplikacji configu, każdy moduł i tak ma własne stałe domyślne (`MAX_TOKENS`, timeout `undefined` = brak abortu) gdy kolumny są `null`.

## Krytyczne szczegóły implementacji

- **Timeout na fetch wymaga `AbortController`**: `fetch()` nie ma wbudowanego timeoutu. Gdy `request_timeout_ms` jest ustawiony, trzeba `AbortController` + `setTimeout(() => controller.abort(), ms)` + `signal: controller.signal` w obu miejscach (`vision/client.ts` i nowym branchu `resolution/client.ts`) i zmapować `AbortError` na istniejący `ok:false` kształt (`reason:'parse_failure'` dla vision, `reason:'api_error'` dla resolution — zgodnie z istniejącymi typami wyników). **Brak precedensu w repo** (plan-review F5): `AbortController` już istnieje (`BookModal.tsx:615`, `PhotoPurchasePanel.tsx:34`), ale wyłącznie do cancel-on-unmount — kombinacja z `setTimeout`-owym abortem jest pierwszą taką implementacją w bazie, więc `clearTimeout` w `finally` w obu miejscach wymaga szczególnej uwagi (brak istniejącego kodu do skopiowania).
- **Cloudflare Workers nie ma limitu wall-clock dla HTTP-triggered Workerów** (potwierdzone w docs.cloudflare.com/workers/platform/limits — CPU-time limit liczy tylko aktywne wykonanie JS, nie oczekiwanie na `fetch()`). Nie trzeba przechodzić na SSE/async dla samego wolnego modelu — synchroniczny POST wystarczy, o ile klient (przeglądarka) jest cierpliwy; `request_timeout_ms` chroni przed nieskończonym oczekiwaniem, nie przed limitem platformy.
- **`AiResolutionProviderConfig` musi być strukturalnie zgodny z `VisionProviderConfig`**: `resolve.ts` przekazuje `providerConfig` (zwrócony z `getActiveProviderConfig`, typowany jako `VisionProviderConfig`) bezpośrednio do `resolveBookViaAI`. Zamiast importować typ z `vision/client.ts` (moduły domenowe w tym repo świadomie nie współdzielą typów/stałych — patrz komentarz przy `COST_IN_PER_M` w `resolution/client.ts`), zdefiniuj równoległy `AiResolutionProviderConfig` z identycznym kształtem pól (`provider`, `apiKey`, `model`, `baseUrl`, `keyId`, `requestTimeoutMs`, `maxTokensOverride`) — TS strukturalne typowanie przepuści wywołanie bez jawnej konwersji.

## Faza 1: Schema — config kluczy + telemetria providera

### Przegląd

Migracja DB + propagacja nowych pól przez typy/schematy/`getActiveProviderConfig`. Zero zmian w logice biznesowej — czysto addytywne, nullable kolumny.

### Wymagane zmiany:

#### 1. Migracja `user_api_keys` + `resolution_calls`

**Plik**: `supabase/migrations/0030_provider_timeout_and_resolution_provider.sql`

**Cel**: Dodać per-klucz override timeoutu/limitu tokenów (używany przez vision i resolution openai-compat branche) oraz kolumnę `provider` do `resolution_calls` dla telemetrii per-provider.

**Kontrakt**:
```sql
alter table user_api_keys
  add column request_timeout_ms integer,
  add column max_tokens_override integer;

alter table resolution_calls
  add column provider text;
```
Obie kolumny w `user_api_keys` nullable (brak = zachowanie jak dziś: brak abortu, domyślny `MAX_TOKENS` modułu). `resolution_calls.provider` nullable — historyczne wiersze zostają `null`.

#### 2. `src/lib/db/database.types.ts`

**Plik**: `src/lib/db/database.types.ts`

**Cel**: Zsynchronizować typy `Row`/`Insert`/`Update` dla `user_api_keys` i `resolution_calls` z nową migracją. Korekta po plan-review: `resolution_calls` **już istnieje** w tym pliku (linie 436-495, kompletny blok Row/Insert/Update/Relationships) — komentarz w `resolve.ts:95-98` twierdzący inaczej jest nieaktualny. Wystarczy dopisać jedno pole do istniejącego bloku, nie tworzyć go od zera.

**Kontrakt**: `user_api_keys.Row/Insert/Update` +`request_timeout_ms: number | null`, +`max_tokens_override: number | null`. Istniejący blok `resolution_calls.Row/Insert/Update` +`provider: string | null`. Przy okazji: skoro blok był kompletny od dawna, sprawdź czy `as any` w `resolve.ts:98` da się zdjąć niezależnie od tej zmiany (patrz Faza 3.3).

#### 3. `src/lib/keys/schema.ts`

**Plik**: `src/lib/keys/schema.ts`

**Cel**: Zod-walidacja nowych pól przy tworzeniu/edycji klucza + zwracanie ich w DTO.

**Kontrakt**: `CreateKeySchema` i `UpdateKeySchema` +`request_timeout_ms: z.number().int().positive().max(300_000).nullish()` (górna granica 5 min — sensowny sufit, niezwiązany z limitem CPU Workers), +`max_tokens_override: z.number().int().positive().max(32_000).nullish()`. `ApiKeyDTO` +oba pola jako `z.number().nullable()`.

#### 4. `src/pages/api/account/keys/index.ts` i `[id].ts`

**Plik**: `src/pages/api/account/keys/index.ts`, `src/pages/api/account/keys/[id].ts`

**Cel**: Przepuścić nowe pola przez `KEY_SELECT`, insert (POST) i update payload (PATCH) — ten sam wzorzec co istniejące `model`/`base_url`.

**Kontrakt**: `KEY_SELECT` string +`,request_timeout_ms,max_tokens_override`. POST insert +`request_timeout_ms: request_timeout_ms ?? null, max_tokens_override: max_tokens_override ?? null`. PATCH `updatePayload` type +oba pola (opcjonalne), + `if` guardy analogiczne do `model`/`base_url`.

#### 5. `src/lib/keys/getActiveProviderConfig.ts`

**Plik**: `src/lib/keys/getActiveProviderConfig.ts`

**Cel**: Odczytać i przepuścić nowe kolumny do zwracanego configu.

**Kontrakt**: SELECT string +`, request_timeout_ms, max_tokens_override`. Zwracany obiekt +`requestTimeoutMs: row.request_timeout_ms, maxTokensOverride: row.max_tokens_override`.

#### 6. `src/lib/vision/client.ts` — rozszerzenie typu (bez zmiany zachowania)

**Plik**: `src/lib/vision/client.ts`

**Cel**: `VisionProviderConfig` +dwa nowe opcjonalne pola, żeby Faza 2 mogła je skonsumować. Bez zmiany logiki w tej fazie.

**Kontrakt**: `VisionProviderConfig` +`requestTimeoutMs?: number | null; maxTokensOverride?: number | null;`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Migracja stosuje się czysto lokalnie: `supabase migration up` (WSL stack)
- Typecheck przechodzi: `npm run typecheck`
- Unit testy przechodzą: `npm run test`
- Lint przechodzi: `npm run lint`

#### Weryfikacja ręczna:

- `supabase db push` (po merge, automatycznie w `deploy.yml`) — potwierdzić brak błędów w logu CI po merge

---

## Faza 2: Vision konsumuje nowy config

### Przegląd

`detectSpinesOpenAICompat` używa `requestTimeoutMs`/`maxTokensOverride` z configu zamiast sztywnych wartości/braku timeoutu. Czysto mechaniczna zmiana — zachowanie dla `null`/`undefined` identyczne jak dziś.

### Wymagane zmiany:

#### 1. `src/lib/vision/client.ts`

**Plik**: `src/lib/vision/client.ts`

**Cel**: Dodać opcjonalny `AbortController`-owy timeout i override `max_tokens` w `detectSpinesOpenAICompat`, sterowane przez `config.requestTimeoutMs` / `config.maxTokensOverride`.

**Kontrakt**: Gdy `config.requestTimeoutMs` ustawiony → `fetch(..., { signal })` z `AbortController` odpalającym `abort()` po tym czasie; `clearTimeout` w `finally`. Złapany `AbortError` → zwróć `{ ok: false }` z tego samego miejsca co dzisiejszy `!resp.ok` branch (funkcja i tak zwraca `{ok:false}` przy błędzie — `detectSpines`/`detectSingleSpineFromCrop` już mapują to na `reason:'parse_failure'`). `max_tokens: config.maxTokensOverride ?? MAX_TOKENS` w body requestu zamiast sztywnego `MAX_TOKENS`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Nowe testy w `tests/unit/lib/vision/client.test.ts`: (a) `requestTimeoutMs` ustawiony + fetch przekracza czas → `ok:false`; (b) `maxTokensOverride` ustawiony → `max_tokens` w wysłanym body fetch odpowiada override; (c) brak obu pól → zachowanie identyczne jak dziś (regresja istniejących testów)
- `npm run test`, `npm run typecheck`, `npm run lint` przechodzą

#### Weryfikacja ręczna:

- Manualny smoke z realnym self-hosted relayem: ustawić krótki `request_timeout_ms` (np. 5000) na kluczu wskazującym na wolny model, potwierdzić że UI dostaje błąd zamiast wisieć w nieskończoność

---

## Faza 3: Resolution — branch openai_compatible

### Przegląd

Serce zmiany: `resolution/client.ts` dostaje branch dla providerów innych niż `anthropic`, nowy prompt bez `web_search`, `resolve.ts` przestaje blokować te providery i zapisuje `provider` do `resolution_calls`.

### Wymagane zmiany:

#### 1. `src/lib/resolution/prompt.ts`

**Plik**: `src/lib/resolution/prompt.ts`

**Cel**: Nowy prompt (`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT`, wersjonowany analogicznie do `AI_RESOLUTION_PROMPT_VERSION`) dla modeli bez `web_search` — identyfikacja z wiedzy treningowej, explicit instrukcja by zwracać `null` dla niepewnych pól (ISBN/wydawca/rok) i `not_found` gdy brak pewności, zamiast zmyślać. Zachowuje identyczny kształt wyjściowego JSON (`AiResolutionResultSchema` — bez zmian, kontrakt wyjściowy jest już provider-agnostyczny).

**Kontrakt**: Nowa stała eksportowana obok istniejącej `AI_RESOLUTION_SYSTEM_PROMPT`. Różnice względem promptu Anthropic: brak wzmianek o `web_search`/wyszukiwaniu, explicit „Nie masz dostępu do internetu — odpowiadaj wyłącznie na podstawie wiedzy, którą już posiadasz" + „Jeśli nie jesteś w pełni pewien tytułu/autora, lub nie znasz konkretnego ISBN/wydawcy/roku dla tej książki, zwróć `null` dla tych pól zamiast zgadywać".

#### 2. `src/lib/resolution/client.ts`

**Plik**: `src/lib/resolution/client.ts`

**Cel**: Branch `openai_compatible`-style (jak `vision/client.ts::detectSpinesOpenAICompat`) — fetch do `{baseUrl}/v1/chat/completions`, bez `tools`, `searchCount` zawsze `0`, `costUsd` zawsze `0` (spójne z vision — „system nie płaci za klucz usera"). Reużywa istniejący `extractLastJsonCandidate` + `AiResolutionResultSchema.safeParse` do parsowania (ten sam defense-in-depth co dla Anthropic).

**Kontrakt**: `AiResolutionProviderConfig` rozszerzony o `provider?: 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible'` (**opcjonalne**, nie wymagane — korekta po plan-review: `tests/unit/lib/resolution/client.test.ts:15` ma `const config = { apiKey: 'sk-test' }` bez `provider`, użyte w 8 wywołaniach; pole wymagane rozjechałoby te testy bez potrzeby. Domyślnie `'anthropic'` gdy `undefined`, zgodnie z dotychczasowym anthropic-only zachowaniem modułu), `baseUrl?: string | null`, `requestTimeoutMs?: number | null`, `maxTokensOverride?: number | null` (patrz „Krytyczne szczegóły implementacji" — strukturalna zgodność z `VisionProviderConfig`, bez importu typu). `resolveBookViaAI` na starcie: `const provider = config.provider ?? 'anthropic'; if (provider !== 'anthropic') return resolveViaOpenAICompat(query, config)`. Nowa funkcja `resolveViaOpenAICompat`: `max_tokens: config.maxTokensOverride ?? MAX_TOKENS`, `messages: [{role:'system', content: AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT}, {role:'user', content: buildUserPrompt(query)}]`, opcjonalny `AbortController` timeout jak w Fazie 2. Błąd fetch/HTTP/abort → `{ ok:false, reason:'api_error', errorMessage }` (ten sam kształt co dzisiejszy Anthropic catch-block).

#### 3. `src/pages/api/detections/[id]/resolve.ts`

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: Zdjąć guard `providerConfig.provider !== 'anthropic'` (linie 84-92) — każdy provider z aktywnym kluczem może wywołać resolution. Przekazać pełny `providerConfig` (nie tylko `apiKey`/`model`/`keyId`) do `resolveBookViaAI`. Zapisać `provider` w `insertAudit`.

**Kontrakt**: Usuń blok `if (providerConfig.provider !== 'anthropic') { ... }`. Wywołanie `resolveBookViaAI(query, providerConfig)` (cały obiekt zamiast destrukturyzacji trzech pól — strukturalnie zgodny z rozszerzonym `AiResolutionProviderConfig` z Fazy 3.2). `insertAudit` +parametr `provider: string | null`, przekazywany jako `providerConfig.provider` w obu wywołaniach (`error` i `found`/`not_found`). Usuń nieaktualny komentarz przy linii 95-98 (`resolution_calls nie jest jeszcze w committowanym database.types.ts`) i spróbuj zdjąć `as any` z linii 98 (`const sb = locals.supabase as any`) skoro Faza 1.2 potwierdziła że typ już istnieje — jeśli mimo to coś nie domyka się (np. relacje FK), zostaw `as any` z komentarzem zamiast walczyć z tym w tym planie (poza zakresem).

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Nowe testy w `tests/unit/lib/resolution/client.test.ts` (mirror `vision/client.test.ts` openai-compat suite): happy path (`status:'found'`, `costUsd:0`, `searchCount:0`); malformed JSON → `parse_failure`; HTTP error / network error / timeout (AbortError) → `api_error`; brak `provider` w configu → fallback na `'anthropic'` (regresja 8 istniejących testów z Fazy 3, patrz plan-review F1)
- `tests/unit/pages/api/detections/resolve.test.ts` **nie istnieje dziś** (korekta po plan-review: katalog ma tylko `candidate.test.ts`/`history.test.ts`/`refine.test.ts`) — **stwórz od zera**: `openai_compatible` provider nie zwraca już `403 AI_RESOLUTION_PROVIDER_UNSUPPORTED` (usunięty guard), `resolution_calls.provider` zapisany poprawnie, plus happy-path smoke dla istniejącego zachowania Anthropic (żeby endpoint miał w ogóle pokrycie testowe, dziś ma zero)
- `npm run test`, `npm run typecheck`, `npm run lint` przechodzą

#### Weryfikacja ręczna:

- Manualny smoke z realnym self-hosted relayem: detekcja bez kandydatów → „Rozwiąż przez AI" → poprawny wynik z `RAV_LAPTOP::Qwen/Qwen3.6-27B` trafia do `book_candidates`
- Manualny smoke: detekcja z tytułem nieznanej/wymyślonej książki → potwierdzić że model zwraca `not_found` lub `found` z `null` w niepewnych polach, nie zmyślony ISBN

---

## Faza 4: UI

### Przegląd

Formularz kluczy dostaje pola timeout/max_tokens; DetectionReview przestaje twierdzić że resolution wymaga Anthropica i jest zawsze płatne, dodaje krótką informację o braku web-search dla nie-Anthropic providerów.

### Wymagane zmiany:

#### 1. `src/components/AccountIsland.tsx`

**Plik**: `src/components/AccountIsland.tsx`

**Cel**: Dodać pola `request_timeout_ms` (ms) i `max_tokens_override` do formularzy add (linie ~674-730) i edit (linie ~816-855) kluczy, widoczne tylko gdy `provider !== 'anthropic'` (analogicznie do dzisiejszego warunkowego `base_url`).

**Kontrakt**: Dwa nowe pola numeryczne w `addForm`/`editForm` state + odpowiadające `<input type="number">` z `data-testid` w konwencji istniejących (`account-keys-timeout-input`, `account-keys-max-tokens-input`), placeholder z sensowną sugestią (np. „domyślnie: bez limitu czasu / 2048-4096 tokenów"). POST/PATCH body +oba pola (`|| null` jak `model`/`base_url`).

#### 2. `src/components/DetectionReview.tsx`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: (a) Zaktualizować statyczny tekst `AiResolutionButton` tooltip (linia 157), 3× zduplikowany `ConfirmDialog` message (linie ~1569, ~1958, ~2302) i `busyLabel` (linia 983, „Rozwiązywanie przez AI (web search)...") — usunąć nieprawdziwe dla nie-Anthropic „wymaga aktywnego klucza Anthropic”/„Operacja jest płatna”/„(web search)”, zastąpić neutralnym sformułowaniem. (b) Dodać krótką informację (badge/tekst) widoczną gdy aktywny provider ≠ `anthropic`, że wynik może być mniej trafny dla niszowych wydań (brak web-search).

**Kontrakt**: Nowy lokalny stan (np. `activeProviderIsAnthropic: boolean | null`), wypełniany przez `fetch('/api/account/keys')` w `useEffect` przy mount (wzorzec z `PhotoUploader.tsx:284-290`, ale czytający `provider` aktywnego klucza zamiast tylko `is_active`). Tekst tooltipa/dialogu/busyLabel warunkowy: gdy `activeProviderIsAnthropic === false`, komunikat pomija „wymaga klucza Anthropic”/„płatna”/„(web search)” i dodaje jedno zdanie o braku web-search. `AI_RESOLUTION_PROVIDER_UNSUPPORTED` error-handling (linie ~1007-1010) staje się nieosiągalny po Fazie 3 (backend już nie zwraca tego kodu) — zostaw jako dead-but-harmless defensive branch (nie usuwaj, zero kosztu utrzymania, chroni przed przyszłą regresją) albo usuń jeśli lint/coverage go oflaguje jako martwy kod.

#### 3. `src/components/BookModal.tsx`

**Plik**: `src/components/BookModal.tsx`

**Cel**: `SOURCE_LABELS.ai_resolution` (linia 107, dziś `'AI (web search)'`) jest renderowany trwale dla każdej potwierdzonej książki z `source='ai_resolution'` — to pole w DB, nie stan sesji, więc etykieta nie może zależeć od aktywnego providera w momencie wyświetlania. Skoro `book_candidates.source` świadomie zostaje jednym enumem niezależnie od providera (decyzja z Fazy 3), etykieta musi być provider-neutralna, żeby nie kłamać dla wyników z `openai_compatible` (bez web search).

**Kontrakt**: Zmień `SOURCE_LABELS.ai_resolution` z `'AI (web search)'` na provider-neutralny tekst, np. `'AI (automatyczne rozwiązanie)'`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `tests/unit/components/AccountIsland.test.tsx` istnieje (293 linie) ale **nie ma dziś żadnego testu formularza add/edit klucza** (korekta po plan-review — `provider`/`base_url` pojawiają się tylko jako fixture, nie jako test UI) — dodaj nową `describe` sekcję pokrywającą nowe pola `request_timeout_ms`/`max_tokens_override` w obu formularzach
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` przechodzą
- `npm run test:e2e` — istniejące E2E dla `account-keys` i `detection-list-views`/resolution flow nadal zielone (regresja)

#### Weryfikacja ręczna:

- W przeglądarce: dodać klucz `openai_compatible` z ustawionym timeout/max_tokens, potwierdzić że wartości persystują po odświeżeniu
- W przeglądarce: z aktywnym kluczem `openai_compatible`, otworzyć detekcję bez kandydatów, potwierdzić że tooltip/dialog nie wspomina „Anthropic”/„płatna” i pokazuje informację o braku web-search

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych weryfikacji, zatrzymaj się tutaj po ręczne potwierdzenie od człowieka (Studio/przeglądarka/realny relay), zanim uznasz change za gotowy do `/10x-impl-review` i archiwizacji.

**Aneks (adaptacje literalne odkryte podczas ręcznej weryfikacji, commit `9e3cc2d`)**:
1. **Normalizacja `base_url`** (`src/lib/keys/schema.ts`) — user wpisał `base_url` z trailing `/v1` (częsty błąd, dostawcy często pokazują URL z tym sufiksem w dokumentacji), co powodowało 404 (`/v1/v1/...`) przy wywołaniach vision/resolution/probe. Dodano `.transform()` w Zod normalizujący trailing `/v1` i `/` przy zapisie klucza — jedno miejsce prawdy zamiast duplikowania strip-logiki w trzech konsumentach.
2. **Fix `vision_runs.model`** (`src/pages/api/photos/[id]/process.ts`) — pre-istniejący bug (niezwiązany bezpośrednio z tym planem, ale ujawniony przez BYOK): `vision_runs` był insertowany z hardcodowanym placeholderem `VISION_MODEL='claude-sonnet-4-6'` i nigdy nie aktualizowany po sukcesie, więc „Analiza kosztów” zawsze pokazywała błędny model dla nie-Anthropic providerów. UPDATE przy `status:'succeeded'` teraz nadpisuje `model: visionResult.model`.

Obie adaptacje zaaplikowane inline zgodnie z regułą CLAUDE.md „Adaptacje literalne wewnątrz fazy” — nie wymagały powrotu do `/10x-plan`.

---

## Strategia testowania

### Testy jednostkowe:

- `tests/unit/lib/vision/client.test.ts`: timeout (AbortController) + max_tokens override w openai-compat branchu
- `tests/unit/lib/resolution/client.test.ts`: nowa `describe` block dla openai-compat branchu — happy path, malformed JSON, HTTP error, timeout/AbortError, custom baseUrl
- `tests/unit/lib/resolution/prompt.test.ts` (jeśli istnieje analog dla vision prompt) lub inline w client.test.ts: nowy prompt eksportowany i niepusty
- `tests/unit/pages/api/detections/resolve.test.ts` (jeśli istnieje) lub odpowiednik: `openai_compatible` provider przechodzi guard, `resolution_calls.provider` zapisany
- `tests/unit/lib/keys/schema.test.ts` (jeśli istnieje): nowe pola walidowane poprawnie (zakres, nullable)

### Testy integracyjne:

- Brak nowych — real self-hosted relay nie jest dostępny w CI (poza zakresem, analogicznie do reguły „real vision tylko manual smoke")

### Kroki testowania ręcznego:

1. Dodać klucz BYOK `openai_compatible` wskazujący na realny self-hosted relay, ustawić jako aktywny
2. Wgrać zdjęcie, potwierdzić że vision przechodzi przez self-hosted model (koszt $0 w UI)
3. Znaleźć/wywołać detekcję bez kandydatów, kliknąć „Rozwiąż przez AI", potwierdzić poprawny wynik i wpis w `resolution_calls` z `provider='openai_compatible'`
4. Ustawić bardzo krótki `request_timeout_ms` na kluczu, potwierdzić że wolny model kończy się czytelnym błędem zamiast wieszać UI
5. Sprawdzić że budget policy (3/zdjęcie, 20/dzień) nadal egzekwowany identycznie jak dla Anthropic

## Uwagi dotyczące wydajności

Self-hosted modele "thinking" (Qwen3-family) mogą zużywać 1000+ tokenów na `reasoning_content` przed dojściem do odpowiedzi — `max_tokens_override` powinien być ustawiony odpowiednio wysoko (empirycznie: 3000-4500 wystarczyło na `RAV_LAPTOP::Qwen/Qwen3.6-27B` w 10-25s; `rav_lmstudio` node w testach usera nie zdążył w 120s nawet przy 4500 — user-facing dokumentacja/placeholder w UI powinna to sygnalizować, nie kod).

## Uwagi dotyczące migracji

Migracja czysto addytywna (nowe nullable kolumny) — brak ryzyka dla istniejących danych, brak potrzeby backfill.

## Referencje

- `src/lib/vision/client.ts:99-171` — wzorzec openai-compat branch do powielenia
- `src/lib/vision/AGENTS.md` — „Provider abstraction (S-33)"
- `src/lib/resolution/client.ts`, `src/lib/resolution/prompt.ts`, `src/lib/resolution/budgetPolicy.ts`
- `src/pages/api/detections/[id]/resolve.ts`
- `src/lib/keys/{getActiveProviderConfig,crypto,schema,probe}.ts`
- `src/pages/api/account/keys/{index,[id]}.ts`
- `supabase/migrations/{0016_user_api_keys,0027_ai_book_resolution_substrate}.sql`
- `tests/unit/lib/vision/client.test.ts` (linie 193-278 — openai-compat suite), `tests/unit/lib/resolution/client.test.ts`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku. Nie zmieniaj nazw tytułów kroków. Zobacz `references/progress-format.md`.

### Faza 1: Schema — config kluczy + telemetria providera

#### Automatyczne

- [x] 1.1 Migracja stosuje się czysto lokalnie — e8769a8
- [x] 1.2 Typecheck przechodzi — e8769a8
- [x] 1.3 Unit testy przechodzą — e8769a8
- [x] 1.4 Lint przechodzi — e8769a8

#### Ręczne

- [ ] 1.5 `supabase db push` po merge bez błędów w logu CI

### Faza 2: Vision konsumuje nowy config

#### Automatyczne

- [x] 2.1 Nowe testy timeout/max_tokens override w vision client.test.ts — df78155
- [x] 2.2 npm run test/typecheck/lint przechodzą — df78155

#### Ręczne

- [x] 2.3 Manualny smoke: krótki request_timeout_ms na wolnym modelu kończy się błędem zamiast wisieć

### Faza 3: Resolution — branch openai_compatible

#### Automatyczne

- [x] 3.1 Nowe testy openai-compat branch w resolution client.test.ts — cd75476
- [x] 3.2 Test: openai_compatible provider nie zwraca już 403 w resolve.ts + resolution_calls.provider zapisany — cd75476
- [x] 3.3 npm run test/typecheck/lint przechodzą — cd75476

#### Ręczne

- [x] 3.4 Manualny smoke: resolution przez realny self-hosted relay trafia do book_candidates
- [x] 3.5 Manualny smoke: nieznana/wymyślona książka → not_found lub found z null w niepewnych polach

### Faza 4: UI

#### Automatyczne

- [x] 4.1 Testy AccountIsland dla nowych pól (jeśli dotyczy) + typecheck/lint/build — 9e3cc2d
- [x] 4.2 npm run test:e2e zielony (regresja account-keys + resolution flow) — 9e3cc2d

#### Ręczne

- [x] 4.3 Przeglądarka: nowe pola formularza persystują
- [x] 4.4 Przeglądarka: tooltip/dialog dla openai_compatible bez „Anthropic”/„płatna”, z informacją o braku web-search
