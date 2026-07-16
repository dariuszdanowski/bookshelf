# search_book tool dla AI-resolution (openai_compatible/openai/openrouter) — Plan implementacji

## Przegląd

Rozszerzamy `resolveBookViaAI` (`src/lib/resolution/client.ts`) o pętlę tool-calling dla
gałęzi `provider !== 'anthropic'` (`openai`, `openrouter`, `openai_compatible`). Dziś ta
gałąź odpowiada wyłącznie z wiedzy treningowej modelu, zero weryfikacji. Nowe narzędzie
`search_book` owija istniejący, gotowy silnik `findBookCandidates` (Google Books + Open
Library + Biblioteka Narodowa) i pozwala modelowi samodzielnie zdecydować, kiedy i jak
szukać — analogicznie do natywnego `web_search` już używanego dla Anthropic.

## Analiza stanu obecnego

- `resolveViaOpenAICompat` (`client.ts:107-193`) wykonuje **jedno** zapytanie
  `POST {baseUrl}/v1/chat/completions` bez `tools`, parsuje odpowiedź przez
  `extractLastJsonCandidate` + `AiResolutionResultSchema.safeParse`. `costUsd`/`searchCount`
  zawsze `0`.
- Gałąź Anthropic (`resolveBookViaAI`, linie 195-254) ma wzorzec do naśladowania: natywny
  tool `web_search_20250305` z `max_uses: MAX_WEB_SEARCH_USES` (=3), `searchCount` liczony z
  `response.usage.server_tool_use.web_search_requests`.
- `findBookCandidates(rawTitle, rawAuthor, rawIsbn, opts)` (`src/lib/matching/findCandidates.ts:29-133`)
  jest czystą funkcją (bez DB), już używaną przez rematch i ręczną identyfikację — bezpieczna
  do wywołania in-process z pętli tool-calling.
- `resolve.ts` (endpoint) woła `resolveBookViaAI({rawTitle, rawAuthor}, providerConfig)` i
  konsumuje `AiResolutionOutcome` — kontrakt wyjściowy (`ok`/`result`/`model`/`costUsd`/
  `searchCount`/`latencyMs`) **nie zmienia się**, więc endpoint nie wymaga żadnej modyfikacji.
- Test suite (`tests/unit/lib/resolution/client.test.ts`) już ma osobny `describe` dla
  gałęzi `openai_compatible` (linie 176-302) z `vi.stubGlobal('fetch', ...)` — wzorzec do
  rozszerzenia, nie zastępowania.

### Kluczowe odkrycia:

- `resolveBookViaAI` dispatchuje po `config.provider` (linia 199-200) — jedyny punkt
  wejścia, sygnatura zostaje identyczna, więc `resolve.ts` i wszystkie inne wywołania są
  nietknięte.
- Zod (`zod@^4`) jest już importowany w module sąsiednim (`schema.ts`) — nowy schemat
  argumentów narzędzia idzie tam samo, konwencja repo (Zod dla każdego external I/O).
- `AiResolutionResultSchema` jest provider-agnostyczny — kształt finalnej odpowiedzi modelu
  się nie zmienia niezależnie od tego, ile rund tool-calling poprzedziło odpowiedź.

## Pożądany stan końcowy

Gdy aktywny klucz BYOK usera to `openai_compatible`/`openai`/`openrouter` i AI-resolution
(`POST /api/detections/:id/resolve`) jest wołane dla detekcji bez kandydatów (lub ze słabym
matchem), model dostaje możliwość wywołania `search_book` (owiniętego
`findBookCandidates`) zamiast zgadywać wyłącznie z pamięci. Serwery bez wsparcia
function-calling nadal działają identycznie jak dziś (fallback bez `tools`, zero regresji).

Weryfikacja: rozszerzone testy jednostkowe pokrywają happy path (0 rund — model odpowiada
od razu), multi-round (1-3 rundy `search_book`), przekroczenie limitu rund, fallback na
HTTP 400, równoległe `tool_calls` w jednej rundzie, oraz regresję istniejącego zachowania
(brak wsparcia `tools`). Manualny smoke test na żywym modelu przez cf-llm-relay potwierdza
end-to-end działanie (user-only).

## Czego NIE robimy

- Propozycje 2-6 z dokumentu źródłowego (few-shot z `corrections`, embeddingi, LLM-arbiter
  kandydatów, skanowanie ISBN, trwała historia prób `match_attempts`) — osobne, przyszłe
  change'y.
- Gałąź Anthropic (`resolveBookViaAI` dla `provider === 'anthropic'`) — bez zmian, ma już
  natywny `web_search`.
- Zmiana kontraktu `AiResolutionOutcome`, `AiResolutionResultSchema` ani endpointu
  `resolve.ts` — pozostają identyczne.
- `budgetPolicy.ts` (`AI_RESOLUTION_BUDGET_LIMITS`) — bez zmian; dodatkowe rundy
  `search_book` w ramach jednego wywołania `resolveBookViaAI` liczą się jako 1 wywołanie do
  budżetu (jak dziś), nie N.
- Konfigurowalny per-user limit rund tool-calling — `MAX_TOOL_ROUNDS` jest stałą modułową,
  tak jak `MAX_WEB_SEARCH_USES` dla Anthropic.

## Podejście do implementacji

Rozszerzamy istniejącą `resolveViaOpenAICompat` w miejscu (nie nowa funkcja/plik) o pętlę
zapytanie→ewentualne `tool_calls`→wywołanie `findBookCandidates`→dołożenie wyniku jako
wiadomość `role: 'tool'`→kolejne zapytanie, aż model odpowie bez `tool_calls` albo limit rund
zostanie osiągnięty. Fallback na serwer bez wsparcia `tools` jest wykrywany tylko na
pierwszym requeście (HTTP 400) i przełącza na dokładnie dzisiejszą, jednostrzałową ścieżkę.

## Krytyczne szczegóły implementacji

- **Sekwencjonowanie pętli**: historia wiadomości rośnie jako
  `[system, user, assistant(tool_calls), tool, tool, ..., assistant(tool_calls), tool, ...]`.
  Po `MAX_TOOL_ROUNDS` rundach zawierających `tool_calls`, ostatni request idzie **bez** pola
  `tools` — wymusza to na modelu odpowiedź tekstową zamiast kolejnego wywołania narzędzia
  (analogicznie do naturalnego wyczerpania `max_uses` po stronie Anthropic). Jeśli mimo to
  finalna odpowiedź się nie parsuje → `reason: 'parse_failure'`, nie osobny kod błędu.
- **Zasięg fallbacku bez `tools`**: dotyczy WYŁĄCZNIE pierwszego requestu w danym wywołaniu
  `resolveBookViaAI` (przed jakimkolwiek `tool_calls`). HTTP 400 w trakcie pętli (po co
  najmniej jednej udanej rundzie z `tools`) NIE triggeruje fallbacku — traktowany jak dziś,
  jako `api_error`, bo serwer już potwierdził wsparcie `tools` wcześniej w tej samej sesji.
- **Równoległe `tool_calls`**: jedna odpowiedź modelu może zawierać tablicę `tool_calls`
  (niektóre serwery OpenAI-compat zwracają >1 na turę). Każdy element wymaga osobnej
  wiadomości `{role: 'tool', tool_call_id, content}` w tej samej kolejności co
  `tool_calls[]` — pominięcie któregokolwiek `tool_call_id` łamie kontrakt formatu OpenAI
  chat completions (serwer odrzuci kolejny request).
- **Błędne argumenty tool-call**: gdy `JSON.parse(tool_call.function.arguments)` albo
  `SearchBookToolArgsSchema.safeParse` zawiedzie, NIE przerywaj całego wywołania — zwróć
  modelowi `{role: 'tool', content: '{"error": "invalid arguments"}'}` dla tego konkretnego
  `tool_call_id`, pozwalając mu spróbować ponownie w kolejnej rundzie (mieści się w
  `MAX_TOOL_ROUNDS`).
- **`searchCount` audytu**: liczy faktyczne wywołania `findBookCandidates` (sumę po
  wszystkich rundach, licząc równoległe `tool_calls` osobno), nie liczbę requestów HTTP —
  spójne znaczeniowo z `web_search_requests` w gałęzi Anthropic.
- **Limit równoległych `tool_calls` w jednej rundzie**: `MAX_PARALLEL_TOOL_CALLS = 3` (nowa
  stała modułowa, symetryczna do `MAX_TOOL_ROUNDS`). Serwer może zwrócić więcej niż jeden
  `tool_call` w jednej turze — bez górnego limitu worst-case liczby wywołań
  `findBookCandidates` w JEDNEJ rundzie byłby nieograniczony, co unieważniałoby szacunek „do
  9 dodatkowych wywołań zewnętrznych" z § Uwagi dotyczące wydajności (ten szacunek zakłada 1
  `search_book` na rundę). Elementy `tool_calls[]` powyżej limitu w danej rundzie NIE wołają
  `findBookCandidates` — dostają wiadomość `{role: 'tool', tool_call_id, content:
  '{"error": "too many parallel tool calls in one round, max 3"}'}`, tak samo jak przy
  błędnych argumentach (patrz wyżej), pozwalając modelowi zredukować liczbę wywołań w
  kolejnej rundzie zamiast twardego błędu całego wywołania.
- **Timeout per request, nie per pętla**: dzisiejszy kod tworzy jeden `AbortController` +
  `setTimeout` na całe (pojedyncze) wywołanie `fetch`. W pętli tool-callingu KAŻDY fetch
  (initial + każda kolejna runda) dostaje własny, świeży `AbortController`/`setTimeout` —
  `AbortController.abort()` można wywołać tylko raz, więc reużycie jednego kontrolera na
  wiele requestów w pętli by się nie skalowało. `config.requestTimeoutMs` jest więc budżetem
  PER REQUEST, nie budżetem na całą pętlę — teoretyczny worst-case całego wywołania
  `resolveViaOpenAICompat` to do `(MAX_TOOL_ROUNDS + 1) × requestTimeoutMs` (przy domyślnym
  braku override i typowych wartościach to nieistotne w praktyce; przy skrajnym
  `requestTimeoutMs` bliskim maksimum schematu, 300 000 ms, wynosi to teoretycznie do 20
  minut — nierealistyczne dla usera, ale warto mieć świadomość tej górnej granicy).

## Faza 1: Kontrakt narzędzia, prompt i pętla tool-calling

### Przegląd

Dodajemy definicję narzędzia `search_book`, nowy wariant systemowego promptu i przepisujemy
`resolveViaOpenAICompat` na pętlę tool-calling z fallbackiem — bez zmiany publicznego API
modułu.

### Wymagane zmiany:

#### 1. Nowy wariant promptu

**Plik**: `src/lib/resolution/prompt.ts`

**Cel**: Dodać `AI_RESOLUTION_OPENAI_COMPAT_TOOLS_SYSTEM_PROMPT` — wariant instruujący model
o dostępności narzędzia `search_book` zamiast "Nie masz dostępu do internetu". Ten sam
kształt JSON wyjściowego i te same reguły anty-halucynacyjne co istniejący
`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT`, styl instrukcji użycia narzędzia 1:1 z
`AI_RESOLUTION_SYSTEM_PROMPT` (linia 17: "spróbuj innej odmiany tytułu, samego autora, czy
tytuł+wydawnictwo").

**Kontrakt**: Nowy eksportowany `const string`, obok istniejących dwóch promptów. Istniejący
`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT` zostaje bez zmian (używany w ścieżce fallback).

#### 2. Kontrakt narzędzia i schemat argumentów

**Plik**: `src/lib/resolution/client.ts`

**Cel**: Zdefiniować stałą narzędzia w formacie OpenAI function-calling i Zod schemat do
walidacji argumentów zwróconych przez model przed wywołaniem `findBookCandidates`.

**Kontrakt**:

```ts
const SearchBookToolArgsSchema = z.object({
  title: z.string().min(1),
  author: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
});

const SEARCH_BOOK_TOOL = {
  type: 'function',
  function: {
    name: 'search_book',
    description:
      'Szuka książki po tytule/autorze/ISBN w Google Books, Open Library i Bibliotece ' +
      'Narodowej. Zwraca do 8 najlepiej dopasowanych kandydatów z tytułem, autorami, ' +
      'ISBN, wydawcą, rokiem wydania i wynikiem dopasowania (0-1).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tytuł książki (może pochodzić z zaszumionego OCR)' },
        author: { type: ['string', 'null'], description: 'Autor, jeśli znany' },
        isbn: { type: ['string', 'null'], description: 'ISBN-10 lub ISBN-13, jeśli znany' },
      },
      required: ['title'],
    },
  },
} as const;

const MAX_TOOL_ROUNDS = 3;
const MAX_PARALLEL_TOOL_CALLS = 3;
```

Import `findBookCandidates` z `../matching/findCandidates`; import `z` z `zod`.

**Logging**: każda runda zawierająca `tool_calls` loguje
`console.log('[resolution:openai-compat:tool-call]', { round, toolCallCount })` (analogicznie
do istniejących `console.log`/`console.error` w tym pliku, np. linia 176 `raw-response`) —
wymagane, żeby manualny smoke test (Faza 2, krok 2.4) miał w logach konkretny dowód, że
`search_book` faktycznie zostało wywołane, a nie tylko generyczny finalny `raw-response`.

#### 3. Pętla tool-calling w `resolveViaOpenAICompat`

**Plik**: `src/lib/resolution/client.ts`

**Cel**: Zastąpić dzisiejsze pojedyncze wywołanie `fetch` pętlą: pierwszy request z
`tools: [SEARCH_BOOK_TOOL]` i nowym promptem; jeśli `message.tool_calls` obecne, wywołaj
`findBookCandidates` dla każdego, dołóż wyniki jako wiadomości `role: 'tool'`, powtórz aż do
`MAX_TOOL_ROUNDS`; ostatni ewentualny request idzie bez `tools`. Fallback na HTTP 400
pierwszego requestu = retry bez `tools` (dzisiejsze zachowanie, bez zmian poza tym że to
teraz jawna ścieżka fallback zamiast jedynej ścieżki).

**Kontrakt**: Sygnatura `resolveViaOpenAICompat(query, config): Promise<AiResolutionOutcome>`
bez zmian. Wewnętrznie: lokalne typy dla wiadomości/`tool_calls` w formacie OpenAI chat
completions (`role: 'system'|'user'|'assistant'|'tool'`, `tool_calls?: {id, type: 'function',
function: {name, arguments}}[]`). Format wyniku narzędzia przekazywany modelowi: okrojone
pola z `ScoredCandidate` (`title, authors, isbn10, isbn13, publisher, publishedYear,
matchScore`) — nie `coverUrl`/`description`, jak ustalono w tabeli decyzji. Gdy
`findBookCandidates` zwróci `candidates: []` i `rateLimited: true`, dołączyć do JSON-a
zwracanego modelowi pole `rateLimited: true` zamiast samej pustej tablicy — pozwala modelowi
odróżnić „nie znaleziono" od „źródło chwilowo niedostępne, spróbuj innej frazy w kolejnej
rundzie" (bez tego rozróżnienia model może przedwcześnie zwrócić `not_found`, mimo że problem
jest przejściowy). Licznik
`searchCount` sumuje faktyczne wywołania `findBookCandidates` (zob. § Krytyczne szczegóły
implementacji). `costUsd` zostaje `0` (bez zmian — `findBookCandidates` jest darmowe,
płatny jest wyłącznie klucz LLM usera).

### Kryteria sukcesu:

#### Automatyczne:

- `npm run typecheck` przechodzi
- `npm run lint` przechodzi
- `npm run build` przechodzi (Cloudflare adapter, brak `process.env`/Node-only API w nowym kodzie)

#### Ręczne:

- Brak — ta faza nie zmienia zachowania widocznego dla usera bez testów z Fazy 2 (patrz niżej,
  weryfikacja funkcjonalna jest w Fazie 2 razem z testami).

---

## Faza 2: Testy jednostkowe + manualny smoke test

### Przegląd

Rozszerzamy `tests/unit/lib/resolution/client.test.ts` (`describe('resolveBookViaAI —
openai_compatible branch')`) o pełne pokrycie nowej pętli tool-calling, mockując `fetch` z
sekwencją odpowiedzi (`tool_calls` → tool response → final) oraz mockując moduł
`../matching/findCandidates` (czysta funkcja, łatwa do zamockowania przez `vi.mock`).

### Wymagane zmiany:

#### 1. Testy jednostkowe pętli tool-calling

**Plik**: `tests/unit/lib/resolution/client.test.ts`

**Cel**: Pokryć każdy branch z § Krytyczne szczegóły implementacji tak, by regresja w
przyszłości była wyłapana automatem, nie manualnym smoke testem.

**Kontrakt**: Nowe `it(...)` w istniejącym `describe('resolveBookViaAI — openai_compatible
branch')`, wzorując się na istniejącym stylu (`vi.stubGlobal('fetch', ...)` z sekwencją
`mockResolvedValueOnce`). Dodać `vi.mock('../../../../src/lib/matching/findCandidates', ...)`
z `vi.hoisted` (wzorzec już użyty dla `@anthropic-ai/sdk` na górze pliku, linia 4-11), żeby
kontrolować zwracane kandydaty bez realnych wywołań Google Books/OL/BN. Przypadki do
pokrycia:
- happy path bez tool_calls (model odpowiada od razu, zero rund — regresja dzisiejszego
  zachowania, już częściowo pokryta istniejącymi testami, ale zweryfikować że nadal
  przechodzi z nowym promptem/kodem),
- 1 runda: `tool_calls` → `search_book` → finalna odpowiedź `found`,
- multi-round (2-3 rundy, różne warianty zapytania między rundami),
- przekroczenie `MAX_TOOL_ROUNDS`: finalny request bez `tools`, sprawdzić że
  `body.tools === undefined` w ostatnim wywołaniu `mockFetch`,
- fallback na HTTP 400 pierwszego requestu → retry bez `tools`, sukces na drugiej próbie,
- HTTP 400 w trakcie pętli (po udanej rundzie z `tools`) → `api_error`, NIE fallback,
- równoległe `tool_calls` (2 elementy w jednej odpowiedzi) → 2 wiadomości `role: 'tool'` w
  kolejnym requeście, w tej samej kolejności,
- przekroczenie `MAX_PARALLEL_TOOL_CALLS` w jednej rundzie (np. 4 równoległe `tool_calls`)
  → elementy powyżej limitu dostają `{"error": "too many parallel tool calls..."}` zamiast
  wywołania `findBookCandidates`, pętla kontynuuje,
- błędne argumenty tool-call (JSON invalid / Zod fail) → wiadomość `tool` z `{"error": ...}`,
  pętla kontynuuje zamiast crashować,
- `searchCount` w wyniku odpowiada liczbie faktycznych wywołań `findBookCandidates`, nie
  liczbie requestów HTTP.

### Kryteria sukcesu:

#### Automatyczne:

- `npx vitest run tests/unit/lib/resolution/client.test.ts` — wszystkie nowe i istniejące
  testy przechodzą
- `npm run test` (pełna suita) — brak regresji w innych plikach
- `npm run typecheck` i `npm run lint` przechodzą

#### Ręczne:

- Manualny smoke test na żywym modelu przez cf-llm-relay (np. model z tool-calling
  serwowany przez lokalny LM Studio) na przykładzie książki nieznajdywanej przez GB/OL/BN —
  potwierdzić że `search_book` jest faktycznie wywoływane i finalna odpowiedź ma sensowny
  `confidence`/wynik (user-only, zob. CLAUDE.md § manual verification)
- Regresja: ten sam smoke test na serwerze/modelu bez wsparcia `tools` (jeśli dostępny) —
  potwierdzić że fallback bez zmiany zachowania nadal działa

**Uwaga implementacyjna**: Po zakończeniu tej fazy i przejściu wszystkich automatycznych
weryfikacji, zatrzymaj się tutaj po ręczne potwierdzenie smoke testu, zanim change zostanie
uznany za gotowy do `/10x-archive`.

---

## Strategia testowania

### Testy jednostkowe:

- Wszystkie przypadki z Fazy 2 (patrz wyżej) — mock `fetch` + mock `findBookCandidates`,
  zero realnych wywołań sieciowych.

### Testy integracyjne:

- Brak — moduł nie dotyka DB ani Supabase, `resolve.ts` (konsument) nie zmienia kontraktu.

### Kroki testowania ręcznego:

1. Skonfigurować w `/account/keys` aktywny klucz `openai_compatible` wskazujący na model z
   tool-calling (np. przez cf-llm-relay).
2. Wgrać zdjęcie z książką, której tytuł/autor po OCR nie znajduje kandydata w GB/OL/BN
   (żeby odblokować przycisk AI-resolution).
3. Wywołać `POST /api/detections/:id/resolve` przez UI, obserwować logi
   (`[resolution:openai-compat:*]`) potwierdzające wywołanie `search_book`.
4. Sprawdzić że wynikowy `book_candidate` ma sensowne dane i `resolution_calls.search_count`
   > 0.

## Uwagi dotyczące wydajności

Dodatkowa latencja (2-4 rundy zamiast 1 zapytania) — akceptowalne, bo to ostatni poziom
kaskady matchingu (rzadko wołany, tylko gdy GB/OL/BN nic nie znalazły, budżetowany
`maxCallsPerPhoto: 3` / `maxCallsPerDay: 20`). Przy 3 rundach × `MAX_PARALLEL_TOOL_CALLS = 3`
`search_book` w każdej rundzie to worst-case do 27 wywołań `findBookCandidates` (do 81
dodatkowych wywołań zewnętrznych GB/OL/BN równolegle per `search_book`) na jedno
AI-resolution — znacznie więcej niż naiwny szacunek „9" przy założeniu 1 wywołania na rundę.
Limit równoległości (§ Krytyczne szczegóły implementacji) trzyma ten worst-case
ograniczonym i przewidywalnym zamiast nieograniczonym; nadal warto mieć na uwadze przy
ewentualnym tuningu limitów w przyszłości.

## Uwagi dotyczące migracji

Brak — zero zmian schematu DB, zero zmian kontraktu endpointu. Deploy jest czystym code
change w `src/lib/resolution/`.

## Referencje

- Dokument źródłowy: `modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md`
  (Propozycja 1)
- Gałąź Anthropic (wzorzec tool-calling z `web_search`): `src/lib/resolution/client.ts:195-254`
- Silnik wyszukiwania do owinięcia: `src/lib/matching/findCandidates.ts:29-133`
- Poprzedni change w tym module: `context/archive/2026-07-14-resolution-openai-compatible-provider/`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Kontrakt narzędzia, prompt i pętla tool-calling

#### Automatyczne

- [x] 1.1 `npm run typecheck` przechodzi
- [x] 1.2 `npm run lint` przechodzi
- [x] 1.3 `npm run build` przechodzi

### Faza 2: Testy jednostkowe + manualny smoke test

#### Automatyczne

- [ ] 2.1 `npx vitest run tests/unit/lib/resolution/client.test.ts` zielone
- [ ] 2.2 `npm run test` (pełna suita) zielone
- [ ] 2.3 `npm run typecheck` i `npm run lint` przechodzą

#### Ręczne

- [ ] 2.4 Smoke test na żywym modelu przez cf-llm-relay potwierdza wywołanie `search_book`
- [ ] 2.5 Regresja: fallback bez `tools` nadal działa na serwerze/modelu bez wsparcia
