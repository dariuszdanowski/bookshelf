# AI book resolution fallback (S-50) — Plan implementacji

## Przegląd

Dodajemy trzeci, ostatni poziom kaskady dopasowania książek: gdy strukturalne źródła (Google Books / OpenLibrary / Biblioteka Narodowa, `findBookCandidates`) **oraz** istniejący word-level fallback (S-48) nie znajdą kandydata z `matchScore >= MATCH_MID (0.55)`, użytkownik może ręcznie uruchomić rozwiązanie przez AI — Claude z narzędziem `web_search`, opłacane własnym kluczem Anthropic (BYOK). Wynik wraca jako zwykły `book_candidates` (source `ai_resolution`), przechodzi przez ten sam `scoreCandidate()` co każdy inny kandydat i tę samą ścieżkę accept/reject w review.

Motywacja (test #153, 2026-07-12): OCR czasem gubi liczbę/odmianę w tytule (np. „Złodziej książek" zamiast „Złodzieje książek") — keyword-search źródeł strukturalnych (zwłaszcza BN) zwraca wtedy zupełnie inne wyniki, a word-level fallback nie pomaga bez autora. Web search radzi sobie z tym naturalnie, bez budowania własnego stemmera.

## Analiza stanu obecnego

- Kaskada matchingu (`src/lib/matching/findCandidates.ts::findBookCandidates`) woła GB/OL/BN równolegle, potem word-level fallback (S-48, gdy `top.matchScore < MATCH_MID` i jest `rawAuthor`), zwraca posortowaną listę `ScoredCandidate[]`. Gdy nic nie przejdzie progu `SEARCH_MIN_SCORE=0.25`, detekcja zostaje ze statusem `pending` i zerem `book_candidates` — **nie ma dedykowanego statusu „nierozwiązana"**.
- Istnieje gotowy, jednokrotnie-per-detekcja wzorzec zewnętrznego rozwiązania: `POST /api/detections/[id]/rematch` (`src/pages/api/detections/[id]/rematch.ts`) — woła `findBookCandidates` z ręcznie podanym tytułem/autorem, stosuje **conservative-replace guard** (`CONSERVATIVE_REPLACE_MARGIN=0.08` z `fallbackPolicy.ts`), usuwa stare i wstawia nowe `book_candidates`, aktualizuje status detekcji. To jest bezpośredni szablon dla nowego endpointu.
- BYOK: `getActiveProviderConfig(supabase, userId)` (`src/lib/keys/getActiveProviderConfig.ts`) zwraca odszyfrowany aktywny klucz (≤1 aktywny/user, partial unique index w `user_api_keys`). Vision (`src/lib/vision/client.ts`) ma **wyspecjalizowaną pod obraz** abstrakcję providera (branch `if (config.provider !== 'anthropic')`, nie generyczny klient) — nowy moduł resolution potrzebuje własnego, analogicznego, ale nieobrazowego wywołania SDK.
- **Zero precedensu `web_search` w kodzie** — to pierwsze użycie tool-use Anthropic w tym repo poza samym Zod-parsowaniem tekstu.
- **Guardrail kosztowy nie istnieje w runtime.** `daily_vision_budget_usd` jest tylko w `docs/prd.md`, nigdy niezaimplementowany. Najbliższy precedens, `fallbackPolicy.ts::REFINE_BUDGET_LIMITS`/`shouldTriggerRefine`, jest **martwym kodem** — zdefiniowany i przetestowany jednostkowo, ale nigdy niewpięty do `refine.ts` (który importuje z tego pliku tylko `CONSERVATIVE_REPLACE_MARGIN` i `classifyCropQuality`). Guardrail dla tego slice'a trzeba faktycznie wpiąć, nie tylko skopiować wzorzec.
- Koszty istniejących operacji AI są audytowane w dedykowanych tabelach per-operację (`vision_runs`, `refine_calls`) z `user_id` (NOT NULL, FK CASCADE), `photo_id`/`detection_id` (nullable, FK **SET NULL** — S-30, żeby koszt przeżył DELETE zdjęcia) i `api_key_id` (nullable, FK SET NULL — M27, atrybucja per klucz). `GET /api/account/stats` sumuje te tabele osobno (`total_vision_cost_usd`, `total_refine_cost_usd`) przez wspólny helper `selectCosts()`.
- `book_candidates.source` i `corrections.correction_type` to **CHECK constraints**, nie wolny tekst. Precedens rozszerzenia: `0017_book_candidates_national_library.sql` (source) i `0008_catalog_read_and_telemetry.sql` (correction_type) — oba `drop`+`add constraint` po nazwie znalezionej dynamicznie przez `pg_constraint`/`pg_get_constraintdef` (odporne na auto-nazewnictwo).
- UI ma gotowy wzorzec dla płatnych, manualnie wyzwalanych operacji AI (S-35): `ConfirmDialog` (generyczny modal) + `RefineButton` (widoczny cost-hint tekst/tooltip „dodatkowa analiza AI — płatne", ⚠ dla niepewnych przypadków) + `REFINE_ROLLOUT_MODE = 'manual_only'`. Jest też istniejący, **darmowy** escape-hatch: `WebSearchButton` — link `<a target="_blank">` do Google, zero kosztu, zero AI. Nowa funkcja jest kolejnym, płatnym stopniem eskalacji, nie zamiennikiem tego linku.
- `ApiErrorCode` (`src/lib/http/response.ts`) to zamknięta unia rozszerzana per-slice; obecnie zawiera już `AI_DISABLED`/`NO_API_KEY` z S-33.

## Pożądany stan końcowy

Na karcie detekcji bez żadnych kandydatów (po wyczerpaniu kaskady + word-fallbacku) użytkownik widzi przycisk „Rozwiąż przez AI". Kliknięcie pokazuje dialog potwierdzenia kosztu; po potwierdzeniu system woła Claude z `web_search` używając aktywnego klucza Anthropic użytkownika, a wynik (jeśli znaleziony i wystarczająco pewny) trafia do `book_candidates` i przechodzi przez zwykły flow accept/reject. Operacja jest ograniczona budżetem (per zdjęcie / per dzień), niedostępna dla kluczy innych niż Anthropic (z jasnym komunikatem), a każde wywołanie (sukces, brak wyniku, błąd) zostawia ślad kosztowy w nowej tabeli audytu, widoczny też w sumarycznych statystykach `/account`.

Weryfikacja: nowe testy jednostkowe (parsowanie Zod, budżet) i E2E (mock `page.route`, **nigdy realny Anthropic call w automatach**) zielone; ręczny smoke z prawdziwym kluczem na jednej testowej detekcji.

## Czego NIE robimy

- Batchowania wielu detekcji w jednym wywołaniu AI (roadmapowa opcja B) — świadomie odsunięte, patrz uzasadnienie w brief.
- Automatycznego triggera wewnątrz `/process` lub `/match` — wyłącznie manualny przycisk per detekcja.
- Wsparcia dla providerów innych niż `anthropic` (OpenAI/OpenRouter/openai_compatible) — `web_search` to narzędzie Anthropic-specific, ścieżka OpenAI-compatible w tym repo to surowy `fetch` bez tool-use.
- Rozszerzania modelu `user_api_keys` o „drugi, zawsze-dostępny klucz Anthropic niezależny od aktywnego" — użytkownik z aktywnym kluczem innym niż Anthropic dostaje czytelny komunikat 403 i musi przełączyć aktywny klucz w `/account`, jeśli chce użyć tej funkcji.
- Nowego statusu DB dla detekcji „nierozwiązana" — trigger wykrywany po `status='pending' AND count(book_candidates)=0`, tak jak dziś.
- Dashboardu/panelu admina do monitorowania zagregowanego kosztu wszystkich userów — tylko per-user `/account`.

## Podejście do implementacji

Pięć faz, rosnąco: schemat → czysty moduł domenowy (bez I/O poza SDK) → endpoint API (spina moduł z DB/BYOK/budżetem) → UI → testy. Każda faza ma normalny zestaw automatycznych kryteriów sukcesu; zgodnie z ustaloną konwencją projektu **implementacja przechodzi przez wszystkie fazy bez zatrzymywania się na ręczną weryfikację pośrodku** — pełna manualna weryfikacja (Supabase Studio, przeglądarka, jeden realny smoke-test z kluczem Anthropic) odbywa się raz, na końcu całego slice'a, przez użytkownika.

## Krytyczne szczegóły implementacji

- **`web_search` server tool i liczenie kosztu web-search**: Claude API z narzędziem `web_search` (typ narzędzia `web_search_20250305`, `name: 'web_search'`, opcjonalny `max_uses`) zwraca w odpowiedzi obok zwykłych `usage.input_tokens`/`usage.output_tokens` licznik wykonanych wyszukiwań w `usage.server_tool_use.web_search_requests`. Zweryfikowane bezpośrednio w zainstalowanej paczce (`@anthropic-ai/sdk@^0.106.0`, `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:805,1000,1589,1829-1837`) — pole jest w pełni typowane (`ServerToolUsage.web_search_requests: number`, `Usage.server_tool_use: ServerToolUsage | null`), więc wystarczy zwykłe optional chaining: `usage.server_tool_use?.web_search_requests ?? 0`, bez `as any`. Cena: `$3/1M input + $15/1M output` (te same stałe co `vision/client.ts::COST_IN_PER_M/COST_OUT_PER_M`, zduplikowane lokalnie w `resolution/client.ts` — moduły domenowe w tym repo nie współdzielą stałych między `src/lib/<domain>/`) + `$0.01` za każde wykonane wyszukiwanie (`COST_PER_WEB_SEARCH`).
- **Ekstrakcja finalnej odpowiedzi**: odpowiedź z `web_search` toolem zawiera blok(i) `server_tool_use`/`web_search_tool_result` obok zwykłych `text` bloków — do parsowania Zod bierzemy WYŁĄCZNIE połączone `text` bloki (ten sam `extractText()`-owy wzorzec co `vision/client.ts:59-64`), nie próbujemy interpretować surowych wyników wyszukiwania.
- **Server-side floor na confidence**: nawet gdy Claude zwróci `status:'found'`, jeśli `confidence < 0.5` traktuj jak `not_found` (nie insertuj candidate) — obrona przed niskopewną halucynacją prześlizgującą się przez JSON-schemę mimo instrukcji promptu „nie zgaduj". Sam `confidence` z AI nigdy nie zasila `match_score` w `book_candidates` — ten zawsze liczony przez `scoreCandidate(detection, candidate)` (ta sama formuła co reszta kaskady), AI-owe `confidence` służy wyłącznie do bramki found/not_found.
- **`shouldReplace` w tym endponcie jest zawsze `true`**: przycisk jest widoczny wyłącznie gdy `book_candidates.length === 0` dla danej detekcji, więc `existingTopScore` zawsze `null` — insert, nie replace. Mimo to reużyj identycznej struktury delete-then-insert co `rematch.ts` dla spójności kodu (nie specjalnego case'a "insert-only").
- **Lazy import SDK obowiązkowy**: `src/lib/vision/client.ts:1-5,27-30` dynamicznie importuje `@anthropic-ai/sdk` wewnątrz funkcji async, bo statyczny import psuje Vite SSR pre-bundling w Cloudflare Workers. `resolution/client.ts` musi powtórzyć dokładnie ten wzorzec, inaczej build padnie.

## Faza 1: Schemat i typy

### Przegląd

Migracja dodająca tabelę audytu kosztów `resolution_calls` i rozszerzająca dwa istniejące CHECK constrainty; rozszerzenie `ApiErrorCode` i `BookCandidate['source']`.

### Wymagane zmiany:

#### 1. Migracja substratu

**Plik**: `supabase/migrations/0027_ai_book_resolution_substrate.sql`

**Cel**: Nowa tabela audytu kosztów dla wywołań AI-resolution (mirror `refine_calls`, ale z `photo_id`/`detection_id` nullable + `api_key_id` od startu — bez potrzeby późniejszej migracji SET NULL jak w S-30/M27). Rozszerzenie `book_candidates.source` o `'ai_resolution'` i `corrections.correction_type` o `'ai_resolution_not_found'`.

**Kontrakt**: `resolution_calls(id uuid pk, user_id uuid not null fk auth.users on delete cascade, photo_id uuid null fk photos on delete set null, detection_id uuid null fk detections on delete set null, api_key_id uuid null fk user_api_keys on delete set null, model text, status text not null check (status in ('found','not_found','error')), search_count int, cost_usd numeric(10,6), latency_ms int, created_at timestamptz not null default now())`. RLS: `for all using (user_id = auth.uid())` (identyczna z `refine_calls`). Indeksy: `resolution_calls_user_id_created_at_idx on (user_id, created_at)` (dla dziennego budżetu), `resolution_calls_photo_id_idx`, `resolution_calls_detection_id_idx`, `resolution_calls_api_key_id_idx where api_key_id is not null`.

Rozszerzenie constraintów: dokładnie wzorzec `do $$ ... select conname from pg_constraint where ... contype='c' and pg_get_constraintdef ilike '%source%'/'%correction_type%' ... drop constraint ... $$; alter table ... add constraint ... check (... in (..., 'ai_resolution'))` / `(..., 'ai_resolution_not_found')` — patrz `0017_book_candidates_national_library.sql` i `0008_catalog_read_and_telemetry.sql` jako źródło dosłownego SQL do podążenia.

#### 2. Dostęp do `resolution_calls` bez blokowania się na regeneracji typów

**Plik**: brak edycji w tej fazie — dotyczy sposobu pisania kodu w Fazie 3

**Cel**: `src/lib/db/database.types.ts` jest **committowany do gita** (nie gitignored — `git ls-files` to potwierdza), ale CI job `verify` (lint/typecheck/build) nigdy nie uruchamia lokalnej Supabase, więc typecheck polega wyłącznie na committowanej wersji tego pliku. Regeneracja wymaga żywego stacku (WSL), który bywa AV-blocked (patrz memory). Ugruntowany wzorzec repo dla świeżo dodanych tabel/kolumn (`account/stats.ts:29,40-41`, `photos/[id]/costs.ts:37-51`, insert `api_key_id` w M27 `process.ts`/`refine.ts`) to **`(locals.supabase as any)` + defensywny retry na kod błędu `42703`/`PGRST204`** zamiast blokowania fazy na regeneracji typów.

**Kontrakt**: Faza 3 (`resolve.ts`, rozszerzenie `stats.ts`/`costs.ts`) konsumuje `resolution_calls` przez `(locals.supabase as any).from('resolution_calls')...`, z tym samym wzorcem defensywnego retry co `account/stats.ts::selectCosts()` (spróbuj z pełną listą kolumn, na błąd `42703` — undefined_column — spróbuj węższej listy). Regenerację i commit `database.types.ts` z pełnym typowaniem (lokalnie w WSL, `supabase migration up` → generator typów) potraktuj jako opcjonalny follow-up `chore:` commit po zweryfikowaniu, że lokalny stack jest dostępny — nie jako blocker Fazy 1.

#### 3. Rozszerzenie kontraktu błędów API

**Plik**: `src/lib/http/response.ts`

**Cel**: Dwa nowe kody błędów specyficzne dla tej funkcji.

**Kontrakt**: dodaj do unii `ApiErrorCode`: `'AI_RESOLUTION_PROVIDER_UNSUPPORTED'` (aktywny klucz istnieje, ale `provider !== 'anthropic'`) i `'RESOLUTION_BUDGET_EXCEEDED'` (limit dzienny/per-zdjęcie wyczerpany). Nie usuwaj/zmieniaj istniejących wartości.

#### 4. Rozszerzenie typu `BookCandidate['source']`

**Plik**: `src/lib/books/schema.ts`

**Cel**: Dopuść `'ai_resolution'` jako czwarte źródło kandydata.

**Kontrakt**: `export type BookCandidate = { source: 'google_books' | 'open_library' | 'national_library' | 'ai_resolution'; ... }`. `BookCandidateDTOSchema.source` jest już `z.string()` (generyczny) — bez zmian. **Nie wymaga** bumpa `CACHE_KEY_VERSION` w `apiCache.ts` (S-51) — ten cache dotyczy wyłącznie odpowiedzi GB/OL/BN z `findCandidates.ts`; moduł resolution nie przechodzi przez `apiCache.ts`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- Migracja aplikuje się czysto lokalnie: `supabase migration up` (WSL) bez błędów
- `npx wrangler types && astro check` przechodzi (nowe typy DB widoczne)
- `npm run lint` przechodzi
- `npm run build` przechodzi

---

## Faza 2: Moduł `src/lib/resolution/`

### Przegląd

Czysty moduł domenowy (żadnego dostępu do `env`/DB — klucz i config zawsze przez parametr, analogicznie do `src/lib/vision/AGENTS.md` § Provider abstraction) realizujący pojedyncze wywołanie Claude z `web_search` i walidację wyniku.

### Wymagane zmiany:

#### 1. Prompt systemowy

**Plik**: `src/lib/resolution/prompt.ts`

**Cel**: System prompt instruujący Claude, by przeszukał sieć (przez `web_search`) w poszukiwaniu konkretnej książki na podstawie zaszumionego (OCR) tytułu/autora, i zwrócił WYŁĄCZNIE finalny JSON zgodny ze schematem — żadnego dodatkowego tekstu poza blokiem JSON. Zawiera tę samą zasadę co `vision/prompt.ts`: „nie zgaduj — brak pewnego trafienia to `not_found`, nie najlepsze przybliżenie".

**Kontrakt**: `export const AI_RESOLUTION_SYSTEM_PROMPT: string`, `export const AI_RESOLUTION_PROMPT_VERSION = 'v1'`.

#### 2. Zod schema wyniku

**Plik**: `src/lib/resolution/schema.ts`

**Cel**: Walidacja ustrukturyzowanej odpowiedzi Claude.

**Kontrakt**:
```ts
export const AiResolutionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    title: z.string().min(1).max(300),
    authors: z.array(z.string()).default([]),
    isbn10: z.string().nullable(),
    isbn13: z.string().nullable(),
    publisher: z.string().nullable(),
    publishedYear: z.number().int().nullable(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ status: z.literal('not_found'), reason: z.string().nullable() }),
]);
export type AiResolutionResult = z.infer<typeof AiResolutionResultSchema>;
```

#### 3. Klient wywołujący Claude

**Plik**: `src/lib/resolution/client.ts`

**Cel**: Zbuduj request z `tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]`, tekstowym promptem użytkownika złożonym z `raw_title`/`raw_author`/opcjonalnego `publisher` detekcji; sparsuj finalną odpowiedź, policz koszt.

**Kontrakt**: `export type AiResolutionProviderConfig = { apiKey: string; model?: string | null; keyId?: string | null }` (świadomie tylko `anthropic` — bez pola `provider`, w przeciwieństwie do `VisionProviderConfig`, bo cała funkcja istnieje tylko dla tego jednego providera). `export async function resolveBookViaAI(query: { rawTitle: string; rawAuthor: string | null; publisher?: string | null }, config: AiResolutionProviderConfig): Promise<{ ok: true; result: AiResolutionResult; model: string; costUsd: number; searchCount: number; latencyMs: number } | { ok: false; reason: 'parse_failure' | 'api_error'; latencyMs: number; errorMessage?: string }>`. Lazy `import('@anthropic-ai/sdk')` — patrz „Krytyczne szczegóły implementacji".

#### 4. Polityka budżetu

**Plik**: `src/lib/resolution/budgetPolicy.ts`

**Cel**: Analogicznie do `matching/fallbackPolicy.ts::REFINE_BUDGET_LIMITS`, ale **faktycznie wołane** z endpointu (Faza 3) — nie martwy kod.

**Kontrakt**:
```ts
export const AI_RESOLUTION_BUDGET_LIMITS = {
  maxCallsPerPhoto: 3,
  maxCallsPerUserAction: 1,
  maxCallsPerDay: 20,
} as const;
export type AiResolutionBudgetState = { callsForPhoto: number; callsForDay: number };
export function isAiResolutionBudgetAvailable(state: AiResolutionBudgetState): boolean;
```

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint` i `astro check` przechodzą
- Nowe testy jednostkowe dla `schema.ts` (found/not_found/malformed) i `budgetPolicy.ts` (progi graniczne) zielone — patrz Faza 5

---

## Faza 3: API endpoint + atrybucja kosztu w `/account`

### Przegląd

Endpoint spinający moduł `resolution/` z DB, BYOK i budżetem; rozszerzenie agregacji kosztów o nową tabelę.

### Wymagane zmiany:

#### 1. Endpoint rozwiązania

**Plik**: `src/pages/api/detections/[id]/resolve.ts`

**Cel**: `POST /api/detections/[id]/resolve` (bez body) — dla podanej detekcji: auth guard → `ai_enabled` guard (wzorzec z `process.ts`) → pobierz detekcję (musi zawierać `photo_id`, `raw_title`, `raw_author`) → `getActiveProviderConfig`; brak klucza → `NO_API_KEY` 403 (istniejący kod); klucz istnieje ale `provider !== 'anthropic'` → nowy `AI_RESOLUTION_PROVIDER_UNSUPPORTED` 403 z `message` wskazującym `/account` → policz budżet (`COUNT(*) FROM resolution_calls WHERE user_id=? AND created_at >= <początek dzisiejszego dnia UTC>` dla `callsForDay`, `WHERE photo_id=?` dla `callsForPhoto`) → `isAiResolutionBudgetAvailable` fałsz → `RESOLUTION_BUDGET_EXCEEDED` 429 → `resolveBookViaAI(...)` → zawsze insert audytowy do `resolution_calls` (status `found`/`not_found`/`error`, `cost_usd`, `search_count`, `api_key_id: providerConfig.keyId`) → gałąź `found` (z floor `confidence>=0.5`, patrz „Krytyczne szczegóły"): zbuduj `BookCandidate`-kształt (`source:'ai_resolution'`, `externalId: `ai-resolution:${detectionId}``), policz `scoreCandidate(detection, candidate)`, insert `book_candidates`, `detections.status='matched'` → gałąź `not_found`/niska pewność: insert `corrections(correction_type:'ai_resolution_not_found', detection_id, original_raw_title)`, status detekcji bez zmian (`pending`) → response `{ applied, detection, candidates: BookCandidateDTO[], duplicate }` (identyczny kształt co `rematch.ts`, plus `resolution: { status: 'found'|'not_found', reason? }`) → gałąź `api_error` (błąd sieciowy/Anthropic, nie parse failure): insert `resolution_calls(status:'error')` → `apiError({code:'INTERNAL_ERROR', status:500, message:'Błąd wywołania AI. Spróbuj ponownie.'})`.

**Kontrakt**: response envelope identyczny z `rematch.ts` (`apiResponse`/`apiError`, `Cache-Control: private, no-store` z defaultów). `duplicate` liczone przez istniejący `checkCatalogDuplicate` (ten sam import co w `rematch.ts`). Wszystkie zapytania do `resolution_calls` przez `(locals.supabase as any)` + defensywny retry na `42703` (patrz Faza 1 punkt 2) — ta tabela nie będzie w committowanym `database.types.ts` do czasu osobnej regeneracji.

#### 2. Atrybucja w statystykach konta

**Plik**: `src/pages/api/account/stats.ts`

**Cel**: Dołącz `resolution_calls` do sumowania kosztów tak samo jak `vision_runs`/`refine_calls` (istniejący helper `selectCosts()` i pętla agregująca `costByKey`).

**Kontrakt**: response zyskuje `total_resolution_cost_usd: number` i `resolution_call_count: number`; per-klucz agregacja (`costByKey`) obejmuje też te wiersze.

#### 3. Atrybucja w kosztach per-zdjęcie

**Plik**: `src/pages/api/photos/[id]/costs.ts`

**Cel**: Dla pełnej spójności między widokiem zbiorczym (`/account`) i per-zdjęciowym popoverem (`CostPanel.tsx`) dołącz `resolution_calls` tym samym wzorcem co istniejący blok `refine_calls` w tym pliku (`(locals.supabase as any)`, `.eq('photo_id', photoId)`, graceful degrade na błąd relacji — `costs.ts:47-51` już ma ten wzorzec dla `refine_calls`, powtórz analogicznie).

**Kontrakt**: response zyskuje `resolution_calls: Array<{id, detection_id, model, cost_usd, latency_ms, status, created_at}>` i `totals.resolution_cost_usd`; `totals.grand_total_usd` obejmuje też tę sumę.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check`, `npm run build` przechodzą
- Cała istniejąca suita Vitest nadal zielona (brak regresji w `rematch`/`process`/`account/stats` przez reużyte importy)

#### Weryfikacja ręczna:

- Z prawdziwym kluczem Anthropic: wywołanie `resolve` na detekcji bez kandydatów zwraca sensowny wynik (found albo jawny not_found), wpis w `resolution_calls` ma realny `cost_usd` > 0, a zarówno `GET /api/account/stats` (`total_resolution_cost_usd`) jak i `GET /api/photos/[id]/costs` (`totals.resolution_cost_usd`) odzwierciedlają ten koszt

---

## Faza 4: UI — DetectionReview + AccountIsland + CostPanel

### Przegląd

Przycisk wyzwalający, dialog potwierdzenia, obsługa wszystkich ścieżek odpowiedzi; wyświetlenie skumulowanego kosztu.

### Wymagane zmiany:

#### 1. Przycisk i wiring w review

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Nowy komponent `AiResolutionButton` (obok `RefineButton`/`WebSearchButton`, ten sam wizualny idiom: label + widoczny/tooltipowy cost-hint), renderowany w kartach/kaflach/liście WYŁĄCZNIE gdy `candidates.length === 0` (nie wymaga `bbox`, w przeciwieństwie do `RefineButton` — to wywołanie tekstowe, nie crop). Klik → `ConfirmDialog` (wzorzec identyczny z istniejącym `confirmRefine` w tym pliku: `title="Rozwiązać przez AI?"`, `message` z jawną informacją o koszcie i wymogu klucza Anthropic, `confirmLabel="Rozwiąż przez AI"`) → po potwierdzeniu `POST /api/detections/[id]/resolve` → sukces: odśwież kartę detekcji tym samym mechanizmem co `handleRematch` (nowy kandydat pojawia się w liście) → `403 AI_RESOLUTION_PROVIDER_UNSUPPORTED`/`NO_API_KEY`: toast z linkiem do `/account` → `429 RESOLUTION_BUDGET_EXCEEDED`: toast informujący o dziennym limicie → odpowiedź z `resolution.status==='not_found'`: toast „AI nie znalazła dopasowania — wpisz książkę ręcznie" (bez nowego kandydata, karta zostaje w dotychczasowym stanie).

**Kontrakt**: `handleAiResolve(detectionId: string): Promise<void>` w tej samej konwencji co istniejący `handleRematch`/`handleRefine` (busy state per detekcja, error state, re-fetch po sukcesie).

#### 2. Wyświetlenie kosztu — widok zbiorczy (`/account`)

**Plik**: `src/components/AccountIsland.tsx`

**Cel**: Dodaj wiersz „AI-resolution" obok istniejących „Vision:"/„Refine:" (ok. L602-617) korzystających z `total_vision_cost_usd`/`total_refine_cost_usd`.

**Kontrakt**: konsumuje nowe pola `total_resolution_cost_usd`/`resolution_call_count` z Fazy 3.2 (`StatsData` type rozszerzony o te pola), ten sam layout co istniejące wiersze; suma w nagłówku (`stats.total_vision_cost_usd + stats.total_refine_cost_usd`) rozszerzona o `+ stats.total_resolution_cost_usd`.

#### 3. Wyświetlenie kosztu — widok per-zdjęcie

**Plik**: `src/components/CostPanel.tsx`

**Cel**: Dodaj trzeci blok wierszy (obok istniejących `filteredVision`/`filteredRefine`) dla `resolution_calls` z Fazy 3.3 — ten sam wizualny idiom (ikona + etykieta + koszt), włączony do `filteredTotal`/`filteredCount`.

**Kontrakt**: `CostData` type rozszerzony o `resolution_calls: ResolutionCall[]`; `totals` rozszerzone o `resolution_cost_usd`.

#### 4. Etykieta źródła w podglądzie książki

**Plik**: `src/components/BookModal.tsx`

**Cel**: Dopisz `ai_resolution: 'AI (web search)'` do `SOURCE_LABELS` (ok. L62-66) — bez tego wpisu modal pokazuje surowy string `ai_resolution` zamiast czytelnej etykiety (graceful fallback już istnieje, to tylko dopracowanie).

**Kontrakt**: jeden nowy wpis w istniejącej mapie `Record<string, string>`.

#### 5. Dokumentacja algorytmu

**Plik**: `docs/algorytm-matchingu.md`

**Cel**: Dopisz „Etap 5 — AI resolution fallback" po istniejącym „Etap 4 — Słowny fallback OCR" (S-48), opisując warunek wyzwolenia (manualny, `candidates.length===0`), `web_search`, koszt, budżet.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run lint`, `astro check` przechodzą
- Istniejące testy jednostkowe/E2E dotykające `DetectionReview.tsx`/`AccountIsland.tsx`/`CostPanel.tsx` nadal zielone

---

## Faza 5: Testy

### Przegląd

Vitest dla logiki czystej (schema/budżet), Playwright dla pełnego flow UI z zamockowanym `page.route` — **nigdy realny Anthropic call w automatach** (twarda zasada CLAUDE.md).

### Wymagane zmiany:

#### 1. Testy jednostkowe schematu i budżetu

**Plik**: `tests/unit/lib/resolution/schema.test.ts`

**Cel**: `AiResolutionResultSchema` akceptuje poprawne `found`/`not_found`, odrzuca malformed (brak `title`, `confidence` poza `[0,1]`, nieznany `status`).

**Plik**: `tests/unit/lib/resolution/budgetPolicy.test.ts`

**Cel**: `isAiResolutionBudgetAvailable` — dokładnie na granicy (`callsForPhoto === maxCallsPerPhoto` → false), poniżej → true, niezależność obu liczników.

#### 2. E2E golden + edge paths

**Plik**: `tests/e2e/ai-book-resolution.spec.ts`

**Cel**: Playwright z `page.route('**/api/detections/*/resolve', ...)` mockującym odpowiedzi. Scenariusze: (a) przycisk widoczny tylko gdy brak kandydatów; (b) dialog potwierdzenia pojawia się i blokuje wysyłkę do kliknięcia confirm; (c) sukces — mock `found` → nowa karta kandydata pojawia się w review; (d) `not_found` — toast, brak nowego kandydata; (e) `403 AI_RESOLUTION_PROVIDER_UNSUPPORTED` — toast z linkiem do `/account`; (f) `429 RESOLUTION_BUDGET_EXCEEDED` — toast limitu.

**Kontrakt**: `workers: 1` (seryjnie, współdzielony user w storageState — konwencja repo), lokatory `getByRole`/`getByTestId`.

### Kryteria sukcesu:

#### Weryfikacja automatyczna:

- `npm run test:unit` — nowe testy zielone, cała suita (845+) bez regresji
- `npm run test:e2e` — nowy spec zielony, pełen przebieg bez nowych flaków
- `npm run lint && astro check && npm run build` — czysto

#### Weryfikacja ręczna:

- Pełny golden path w przeglądarce z prawdziwym kontem: detekcja bez kandydatów → „Rozwiąż przez AI" → potwierdzenie → wynik (found lub not_found) zgodny z oczekiwaniem, koszt widoczny w `/account`
- Przełączenie aktywnego klucza na OpenAI w `/account` → przycisk daje czytelny komunikat zamiast cichego błędu

---

## Strategia testowania

### Testy jednostkowe:

- Parsowanie Zod (`AiResolutionResultSchema`): found/not_found/malformed
- `isAiResolutionBudgetAvailable`: granice per-photo i per-day niezależnie

### Testy integracyjne / E2E:

- Pełny UI flow z mockiem sieci (żadnego realnego wywołania Claude)
- Wszystkie kody błędów (403 provider, 429 budget) mają widoczną, zrozumiałą reprezentację w UI

### Kroki testowania ręcznego:

1. Detekcja bez kandydatów (np. po ręcznym wyczyszczeniu `book_candidates` na testowym zdjęciu) → kliknij „Rozwiąż przez AI" → potwierdź w dialogu
2. Sprawdź w Supabase Studio: nowy wiersz `resolution_calls` z realnym `cost_usd`, ew. nowy wiersz `book_candidates` z `source='ai_resolution'`
3. Sprawdź `/account`: koszt uwzględniony w sumie
4. Przełącz aktywny klucz na provider inny niż Anthropic, spróbuj ponownie → czytelny komunikat, brak wywołania sieciowego

## Uwagi dotyczące wydajności

Pojedyncze wywołanie `web_search` z `max_uses: 3` ogranicza liczbę faktycznych wyszukiwań w jednym callu; guardrail budżetowy (3/zdjęcie, 20/dzień) chroni przed przypadkowym runaway (np. wielokrotne kliknięcia) — nie przed pojedynczym drogim wywołaniem.

## Uwagi dotyczące migracji

Migracja czysto addytywna (nowa tabela + rozszerzone CHECKi) — brak ryzyka dla istniejących danych. Deploy przez istniejący `deploy.yml` migrate-first krok (automatyczny `supabase db push` po merge do main).

## Referencje

- Roadmap: `context/foundation/roadmap.md` (S-50, wiersz 81)
- Wzorzec endpointu: `src/pages/api/detections/[id]/rematch.ts`
- Wzorzec kosztowy: `supabase/migrations/0012_refine_calls.sql`, `0015_vision_cost_preservation.sql`, `0020_runs_api_key_attribution.sql`
- Wzorzec rozszerzenia CHECK: `supabase/migrations/0017_book_candidates_national_library.sql`, `0008_catalog_read_and_telemetry.sql`
- Wzorzec UI kosztowy: `src/components/DetectionReview.tsx` (`RefineButton`, `ConfirmDialog` użycie ok. L1278-1290)
- Wzorzec vision-provider (lazy import, cost calc): `src/lib/vision/client.ts`, `src/lib/vision/AGENTS.md`
- Budżet (martwy kod, wzorzec do naśladowania z faktycznym wpięciem): `src/lib/matching/fallbackPolicy.ts`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Schemat i typy

#### Automatyczne

- [x] 1.1 Migracja aplikuje się czysto lokalnie — d63b12d
- [x] 1.2 `npx wrangler types && astro check` przechodzi — d63b12d
- [x] 1.3 `npm run lint` przechodzi — d63b12d
- [x] 1.4 `npm run build` przechodzi — d63b12d

### Faza 2: Moduł `src/lib/resolution/`

#### Automatyczne

- [x] 2.1 `npm run lint` i `astro check` przechodzą — 44dbd52
- [x] 2.2 Nowe testy jednostkowe `schema.ts`/`budgetPolicy.ts` zielone — 44dbd52

### Faza 3: API endpoint + atrybucja kosztu w `/account`

#### Automatyczne

- [x] 3.1 `npm run lint`, `astro check`, `npm run build` przechodzą — 07de548
- [x] 3.2 Cała istniejąca suita Vitest nadal zielona — 07de548

#### Ręczne

- [ ] 3.3 Realny smoke z kluczem Anthropic — `resolution_calls`/`book_candidates`/`/account/stats` poprawne

### Faza 4: UI — DetectionReview + AccountIsland + CostPanel

#### Automatyczne

- [ ] 4.1 `npm run lint`, `astro check` przechodzą
- [ ] 4.2 Istniejące testy `DetectionReview`/`CostPanel` nadal zielone

### Faza 5: Testy

#### Automatyczne

- [ ] 5.1 `npm run test:unit` — nowe + cała suita zielone
- [ ] 5.2 `npm run test:e2e` — nowy spec zielony, brak nowych flaków
- [ ] 5.3 `npm run lint && astro check && npm run build` czysto

#### Ręczne

- [ ] 5.4 Pełny golden path w przeglądarce (prawdziwe konto)
- [ ] 5.5 Przełączenie klucza na non-Anthropic → czytelny komunikat
