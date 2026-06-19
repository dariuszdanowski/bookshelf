# Match & Vision Progress (SSE) — Plan implementacji

## Przegląd

Dodajemy SSE streaming dla fazy **match** (dopasowywanie do baz książek).
Zamiast indeterminate ProgressModal, użytkownik widzi:
- Listę tytułów pojawiających się jeden po drugim (raw_title per detekcja)
- Determinate pasek postępu (X / total detekcji)

Faza **vision** (Claude Vision) pozostaje bez zmian — zwraca cały JSON naraz, brak możliwości progressive streaming bez zmiany wywołania LLM. Faza match (`match.ts` — prywatna `settledWithConcurrency` z MAX=5 concurrent) jest naturalnym miejscem: matchujemy detekcje kolejno, znamy N z góry.

## Analiza stanu obecnego

- **POST /api/photos/[id]/match**: synchroniczny endpoint, czeka na zmatchowanie wszystkich detekcji, zwraca `{ matched, rate_limited }`
- **`match.ts` → prywatna `settledWithConcurrency<T>(tasks, concurrency)`**: bounded concurrency MAX=5, worker pool pattern; `matchDetection(det: DetectionRow, catalog: ExistingBook[])` — sygnatura wewnętrzna; **`src/lib/matching/runner.ts` NIE ISTNIEJE** (plik zostanie stworzony w Fazie 1)
- **ProgressModal**: `{ open: boolean, label: string }` — indeterminate pulsujący pasek, brak tytułów, brak %
- **Brak SSE/EventSource** w projekcie (wszystkie callbacki synchroniczne fetch)
- **CF Workers**: native `ReadableStream` + `TextEncoder` → SSE out-of-the-box

Dotknięte pliki:
- `src/lib/matching/runner.ts` — NOWY PLIK: wyodrębnienie `settledWithConcurrency` + `matchDetection` z `match.ts`; dodanie `onProgress` callback; `match.ts` otrzymuje import refactor (endpoint behavior bez zmian)
- `src/pages/api/photos/[id]/match-stream.ts` — nowy GET SSE endpoint
- `src/components/ProgressModal.tsx` — rozszerzenie props
- `src/components/PhotoUploader.tsx` — EventSource zamiast fetch dla match
- `src/components/PhotoListIsland.tsx` — EventSource zamiast fetch dla runMatch
- `tests/e2e/upload-flow.spec.ts` (lub nowy spec) — testy SSE progress

## Pożądany stan końcowy

Po wdrożeniu:
- Upload zdjęcia → faza matching → ProgressModal pokazuje listę tytułów pojawiających się sukcesywnie + pasek X/N
- PhotoListIsland → „Dopasuj ponownie" → ten sam modal z live progress
- Istniejący POST /match zostaje (backwards compat), SSE to addytywna ścieżka
- Fallback: EventSource error (3×) → silent fallback do sync POST /match

### Kluczowe odkrycia

- `match.ts:settledWithConcurrency` używa worker pool (nie semaphore) z `Promise.allSettled` — po wyodrębnieniu do `runner.ts` i dodaniu optional `onProgress?`, każde zakończenie detekcji emituje event; JS single-threaded, `let completed = 0` + `++completed` bezpieczne bez Atomics
- EventSource wymaga GET; CF Workers wspierają `ReadableStream` w GET handler — standard pattern
- Matching jest idempotent (delete-then-insert per detection) — re-otwarcie SSE connection nie zostawia śmieciowych danych
- Cookie-based auth (`@supabase/ssr`) działa z EventSource: same-origin GET automatycznie wysyła cookies

## Czego NIE robimy

- SSE dla fazy **vision** (Claude Vision = 1 synchroniczny LLM call, cały JSON naraz)
- SSE dla **rematch/refine** w DetectionReview (1 detekcja — overhead bez sensu)
- WebSocket (unidirectional server→client; SSE wystarczy)
- Zmiany schematu DB
- Biblioteki SSE/reconnecting-eventsource (native EventSource wystarczy)
- Specjalna obsługa concurrent match runs (matching jest idempotent)

## Podejście do implementacji

Backend-first: najpierw SSE endpoint (weryfikowalny przez curl), potem UI.
ProgressModal extend na środku (izolowana zmiana, żaden istniejący caller nie psuje się).
FE EventSource na końcu, po walidacji endpointu.

## Krytyczne szczegóły implementacji

- `onProgress` w runner.ts musi być wywołany PO `matchDetection()` ale WEWNĄTRZ `try` bloku (przed `finally semaphore.release()`), żeby kolejność events odpowiadała kolejności zakończeń detekcji, nie kolejności startów.
- SSE event format: **dwa `\n`** po `data:` linii (`\n\n`) — standard wymaga pustej linii między eventami. Jeden `\n` = brak wysłania eventu.
- Astro handler dla GET SSE musi zwrócić `new Response(readableStream, headers)` — helpery `apiResponse/apiError` z `response.ts` zwracają `Response` z body JSON, nie stream; nie używać ich w match-stream.ts.
- ProgressModal: gdy `progress` prop jest obecny, bar musi być `position: relative` z inner div `width: X%`; jeśli X=0 (total=0, edge case) → renderuj indeterminate fallback zamiast 0% baru.

---

## Faza 1: Backend — runner.ts + match-stream endpoint

### Przegląd

Dodajemy opcjonalny callback do runnera i nowy GET SSE endpoint. Istniejący POST /match zostaje bez zmian.

### Wymagane zmiany

#### 1.1 `src/lib/matching/runner.ts`

**Cel**: NOWY PLIK — wyodrębnić `settledWithConcurrency<T>` + `matchDetection` z `match.ts` do `src/lib/matching/runner.ts`; dodać opcjonalny `onProgress` callback; zaktualizować `match.ts` do importu (import refactor — endpoint behavior bez zmian).

**Kontrakt**:
```ts
// Typy z match.ts (przenieść do runner.ts lub importować z match.ts):
// DetectionRow: { id: string; raw_title: string | null; raw_author: string | null; position_index: number; status: string }
// ExistingBook: { isbn_13: string | null; title: string; authors: string[] }
// MatchResult: { detectionId: string; candidateId?: string; status: 'matched' | 'rate_limited' | 'no_match'; ... }

export type MatchProgressEvent = {
  index: number;       // 1-based, kolejność zakończenia
  total: number;       // łączna liczba detekcji wejściowych
  detectionId: string;
  title: string;       // raw_title detekcji (może być '' gdy null)
};

export type OnMatchProgressFn = (event: MatchProgressEvent) => void;

// Wyodrębnione z match.ts (dotychczas prywatne):
export async function settledWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]>

// Wyeksportowana wersja matchDetection z optional onProgress:
export async function runMatchingWithProgress(
  detectionRows: DetectionRow[],
  catalog: ExistingBook[],
  concurrency: number,
  onProgress?: OnMatchProgressFn,
): Promise<PromiseSettledResult<MatchResult>[]>
```

Implementacja `runMatchingWithProgress`: licznik `let completed = 0`; każde zadanie = `() => matchDetection(det, catalog).then(r => { onProgress?.({ index: ++completed, total: detectionRows.length, detectionId: det.id, title: det.raw_title ?? '' }); return r; })`.

`match.ts` zastępuje lokalną `settledWithConcurrency` importem z runner; wywołuje `runMatchingWithProgress(detectionRows, catalog, MATCH_CONCURRENCY)` — bez `onProgress`.

#### 1.2 `src/pages/api/photos/[id]/match-stream.ts`

**Cel**: Nowy GET endpoint emitujący SSE stream — auth-guard (jak match.ts), ładuje pending/matched detekcje, wywołuje `runMatchingConcurrent` z `onProgress`, każde zakończenie → chunk do streamu.

**Kontrakt**:
```ts
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => { ... };

// SSE events (każdy zakończony DWOMA \n):
// event: progress\ndata: {"index":1,"total":5,"title":"Harry Potter","detectionId":"..."}\n\n
// event: progress\ndata: {"index":2,"total":5,...}\n\n
// ...
// event: done\ndata: {"matched":5,"rate_limited":0}\n\n
// LUB (przy błędzie):
// event: error\ndata: {"message":"...","code":"INTERNAL_ERROR"}\n\n

// Response:
// Content-Type: text/event-stream
// Cache-Control: no-cache
// Connection: keep-alive
// (NIE: Cache-Control: private, no-store — SSE nie jest per-user cacheable w tym sensie)

// Auth (jak match.ts — identyczna kolejność guardów):
//   1. parseUuidParam(params.id) → 404 na bad UUID
//   2. if (!locals.user) → 401 UNAUTHENTICATED
//   3. profiles.ai_enabled check → 403 AI_DISABLED (jak match.ts:182-194)
// Detections (jak match.ts — scoped do latestRun):
//   4. Pobierz latestRun = vision_runs WHERE photo_id = $id AND status = 'succeeded'
//      ORDER BY created_at DESC LIMIT 1 → 404 NOT_FOUND jeśli brak
//   5. Pobierz detectionRows WHERE vision_run_id = latestRun.id AND status != 'rejected'
//   6. Preload catalog = books WHERE user_id = user.id (dla duplicate check w matchDetection)
//   7. Jeśli 0 detekcji: emit done{matched:0,rate_limited:0} + close stream
```

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Lint: `npm run lint` — brak nowych błędów
- Typecheck: `npm run typecheck` — `runMatchingConcurrent` z 2 callersami (match.ts bez onProgress, match-stream.ts z onProgress) — oba poprawne typy

#### Weryfikacja ręczna

- `curl -N http://localhost:4321/api/photos/{uuid}/match-stream` → widoczne SSE chunki `event: progress` pojawiające się sukcesywnie, na koniec `event: done`
- GET z bad UUID → 404 (nie 500)
- GET bez auth cookie → 401

**Uwaga**: Po Fazie 1 zweryfikuj curl przed przejściem do Fazy 2.

---

## Faza 2: ProgressModal — rozszerzenie UI

### Przegląd

Extend istniejącego ProgressModal o opcjonalne props `titles` i `progress`. Istniejące callery (bez nowych props) nie wymagają zmian — zachowanie indeterminate.

### Wymagane zmiany

#### 2.1 `src/components/ProgressModal.tsx`

**Cel**: Dodać opcjonalne props dla determinate paska i listy tytułów; zachować backwards compat dla callerów bez tych props.

**Kontrakt**:
```ts
type Props = {
  open: boolean;
  label: string;
  // Nowe opcjonalne:
  titles?: string[];                          // lista raw_title, pojawia się sukcesywnie
  progress?: { current: number; total: number }; // X/N — gdy present → determinate bar
};
```

UI gdy `progress` present:
- Determinate bar: outer `div` `relative`, inner `div` `transition-all duration-300` `width: ${(current/total)*100}%`
- Edge case `total === 0`: renderuj indeterminate (pulsujący) zamiast 0% baru
- Text pod barem: `${current} / ${total} dopasowane`

UI gdy `titles` present i `titles.length > 0`:
- Scrollable list (max-h ~160px, overflow-y-auto) pod paskiem
- Każdy tytuł w osobnym wierszu (truncate dla długich)
- Nowe tytuły dołączane na dole; lista auto-scrolluje do ostatniego

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Typecheck: nowe props w typie bez `any`
- Lint: brak nowych błędów
- Istniejące callery (PhotoUploader, PhotoListIsland, DetectionReview bez nowych props) — brak TS errors

#### Weryfikacja ręczna

- ProgressModal z `progress={{ current: 3, total: 5 }}` → pasek na 60%, tekst „3 / 5 dopasowane"
- ProgressModal z `titles={["Harry Potter", "Solaris"]}` → lista widoczna
- ProgressModal bez nowych props → zachowanie identyczne jak przed zmianą (indeterminate pasek)

---

## Faza 3: Frontend — EventSource integration

### Przegląd

PhotoUploader i PhotoListIsland zastępują sync fetch dla fazy match EventSource do `/match-stream`. Fallback: 3 błędy EventSource → sync POST `/match`.

### Wymagane zmiany

#### 3.1 `src/components/PhotoUploader.tsx`

**Cel**: Zastąpić sync fetch w fazie matching EventSource otwieranym na `/api/photos/{photoId}/match-stream`; akumulować tytuły i progress w state; przekazywać do ProgressModal.

**Kontrakt**:

Nowy state (lokalny w komponencie lub w istniejącym reducer):
```ts
matchTitles: string[]         // reset do [] przy starcie każdej operacji match
matchProgress: { current: number; total: number } | null  // null = indeterminate
```

Logika:
- `runMatch(photoId)`:
  1. Ustaw `matchTitles = []`, `matchProgress = null`, `stage = 'matching'`
  2. Otwórz `new EventSource(\`/api/photos/${photoId}/match-stream\`)`
  3. `source.addEventListener('progress', e => { const d = JSON.parse(e.data); setMatchTitles(prev => [...prev, d.title]); setMatchProgress({ current: d.index, total: d.total }); })`
  4. `source.addEventListener('done', e => { source.close(); /* proceed jak po sync match */ })`
  5. `source.onerror`: `retryCount++`; po 3 błędach: `source.close()`, fallback do `fetch('/api/photos/${photoId}/match', { method: 'POST' })`
- ProgressModal gdy `stage === 'matching'`: `titles={matchTitles} progress={matchProgress ?? undefined}`

#### 3.2 `src/components/PhotoListIsland.tsx`

**Cel**: To samo dla `runMatch(photoId)` w liście zdjęć.

**Kontrakt**: Identyczny pattern EventSource jak w PhotoUploader. State `matchTitles` i `matchProgress` per-photo (lub globalne dla aktualnie procesowanego). Po `done` event → `fetchPhotos()` refresh jak po sync fetch.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Typecheck: nowe state vars poprawnie typowane
- Lint: brak nowych błędów
- E2E z mock SSE: `npm run test:e2e` — upload-flow spec zielony

#### Weryfikacja ręczna

- Upload zdjęcia → faza matching → ProgressModal pokazuje tytuły pojawiające się jeden po drugim + determinate pasek
- PhotoListIsland → „Dopasuj ponownie" → ten sam modal z live progress
- Symulacja błędu SSE (block request w DevTools) → fallback do sync match, modal zamyka się normalnie

---

## Faza 4: E2E tests

### Przegląd

Dodanie/aktualizacja testów Playwright weryfikujących SSE progress w modalu. Mock SSE przez `page.route()` — zero realnych API calls.

### Wymagane zmiany

#### 4.1 `tests/e2e/upload-flow.spec.ts` (lub nowy `match-sse-progress.spec.ts`)

**Cel**: Weryfikacja że modal wyświetla tytuły i determinate pasek podczas fazy match z SSE.

**Kontrakt**:

Mock SSE w `page.route`:
```ts
await page.route('**/api/photos/*/match-stream', async route => {
  const events = [
    'event: progress\ndata: {"index":1,"total":3,"title":"Harry Potter","detectionId":"det-1"}\n\n',
    'event: progress\ndata: {"index":2,"total":3,"title":"Solaris","detectionId":"det-2"}\n\n',
    'event: progress\ndata: {"index":3,"total":3,"title":"Diuna","detectionId":"det-3"}\n\n',
    'event: done\ndata: {"matched":3,"rate_limited":0}\n\n',
  ].join('');
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    body: events,
  });
});
```

Asercje:
- Po starcie fazy matching: `getByText('Harry Potter')` → widoczny w modalu
- `getByText('Solaris')` → widoczny
- Pasek postępu: `getByRole('progressbar')` lub dedicated testid — widoczny i nie-indeterminate
- Po `done`: modal zamknięty, flow kontynuuje normalnie (redirect do /photos/{id})

Fallback test (opcjonalny):
```ts
await page.route('**/api/photos/*/match-stream', route => route.abort());
// Upewnij się że istniejący mock /api/photos/*/match (POST) jest aktywny
// Assert: modal zamknął się, flow kontynuuje
```

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run test:e2e` — wszystkie uploady/match E2E zielone
- `npm run typecheck` — brak errors
- `npm run lint` — brak errors

#### Weryfikacja ręczna

- Pełny golden path: upload → analiza vision → matching z SSE progress (tytuły + pasek) → redirect do DetectionReview
- Istniejące testy photo-crud, manual-rematch — brak regresji

---

## Strategia testowania

### Testy jednostkowe

- runner.ts: test że `onProgress` jest wołane N razy dla N detekcji z poprawnymi `index` i `title`
- ProgressModal: snapshot/component test z `titles` + `progress` props

### Testy E2E

- Upload flow z mock SSE → tytuły i progress w modalu
- Fallback: SSE abort → sync match → modal zamknięty

### Testy ręczne

1. Upload zdjęcia z kilkoma książkami → obserwuj ProgressModal podczas fazy matching
2. Kliknij „Dopasuj ponownie" w PhotoListIsland → ten sam modal
3. DevTools → Network → block `/match-stream` → weryfikuj fallback sync match

## Referencje

- Poprzedni slice (progress-modal): `context/archive/progress-modal/`
- Runner: `src/lib/matching/runner.ts`
- Match endpoint: `src/pages/api/photos/[id]/match.ts`
- ProgressModal: `src/components/ProgressModal.tsx`

---

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu.

### Faza 1: Backend — runner.ts + match-stream endpoint

#### Automatyczne

- [x] 1.1 Lint: `npm run lint` — brak nowych błędów (runner.ts + match-stream.ts) — 733289a
- [x] 1.2 Typecheck: `npm run typecheck` — oba callery runMatchingConcurrent poprawne — 733289a

#### Ręczne

- [ ] 1.3 curl GET /match-stream → widoczne SSE chunki sukcesywnie + done
- [ ] 1.4 curl GET z bad UUID → 404; bez cookie → 401

### Faza 2: ProgressModal — rozszerzenie UI

#### Automatyczne

- [x] 2.1 Typecheck: nowe props bez `any`, istniejące callery bez TS errors
- [x] 2.2 Lint: brak nowych błędów

#### Ręczne

- [ ] 2.3 Modal z `progress={{ current: 3, total: 5 }}` → 60% pasek, „3 / 5 dopasowane"
- [ ] 2.4 Modal bez nowych props → zachowanie identyczne z poprzednią wersją

### Faza 3: Frontend — EventSource integration

#### Automatyczne

- [ ] 3.1 Typecheck: nowe state vars poprawnie typowane (PhotoUploader + PhotoListIsland)
- [ ] 3.2 Lint: brak nowych błędów
- [ ] 3.3 E2E z mock SSE: `npm run test:e2e` → upload-flow zielony

#### Ręczne

- [ ] 3.4 Upload → faza matching → tytuły pojawiają się + determinate pasek
- [ ] 3.5 PhotoListIsland → „Dopasuj" → ten sam modal z live progress
- [ ] 3.6 DevTools block /match-stream → fallback sync match, flow kontynuuje

### Faza 4: E2E tests

#### Automatyczne

- [ ] 4.1 `npm run test:e2e` — nowe SSE progress testy zielone
- [ ] 4.2 Brak regresji w photo-crud, manual-rematch

#### Ręczne

- [ ] 4.3 Pełny golden path: upload → analiza vision → SSE matching → DetectionReview
