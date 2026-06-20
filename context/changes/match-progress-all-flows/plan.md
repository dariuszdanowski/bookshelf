# ProgressModal i pasek postępu we wszystkich flow vision+match — Plan implementacji

## Przegląd

Ujednolicenie UX: każdy flow uruchamiający vision i/lub matching pokazuje modal z krokami i paskiem postępu. Dotychczas tylko `PhotoListIsland` (zmiana `match-vision-progress-sse`) otrzymał 2-step modal; `PhotoUploader` i `DetectionReview` wciąż blokują użytkownika na statycznym labellu lub w ogóle bez modala.

## Analiza stanu obecnego

**`PhotoUploader.tsx`** (linia 227):
- Wywołuje `/api/photos/${id}/process` BEZ `?skipMatch=1` — backend robi vision + auto-match (~70s) jako jeden call.
- UI `ProgressModal` z 2 krokami (`stage='processing'/'matching'`) JUŻ ISTNIEJE i jest poprawny — implementacja jest gotowa.
- Po `/process` komponent wywołuje jeszcze `runMatch` (SSE `/match-stream`) — to powoduje **podwójne matchowanie**: raz cicho wewnątrz `/process`, raz jawnie przez SSE.
- Jedyna potrzebna zmiana: dodać `?skipMatch=1` do URL `/process` — wtedy faza `processing` trwa ~12s (samo vision), a SSE matching (~57s) działa w fazie `matching` z pełnym postępem.

**`DetectionReview.tsx` — `runRerunVision`** (linia 2295):
- Wywołuje `/process` (pełny pipeline, ~70s) + stary endpoint `/match` (nie-SSE, bez progress) + `window.location.reload()`.
- `actionBusyLabel` blokuje UI, ale modal ma tylko statyczny label przez cały czas (~70–80s).
- Żaden krok-wskaźnik (`steps`) nie jest przekazywany do `ProgressModal`.
- Potrzeba: podzielić na `/process?skipMatch=1` + SSE matching + 2-step modal.

**`DetectionReview.tsx` — `handleRerunMatch`** (linia 2351):
- Wywołuje SSE `/match-stream`, streaming do ProgressModal (`matchTitles`, `matchProgress`, `matchStats`, `currentItem`).
- Brakuje `steps` prop w `ProgressModal` (linia 2970) — nie ma wizualnego wskaźnika kroku.
- Minor: dodać `steps=[{label:'Dopasowywanie do baz książek', status:'active'}]`.

**`PhotoListIsland.tsx`** — już naprawiony w poprzednim slice'ie (`match-vision-progress-sse`). Nie wymaga zmian.

### Kluczowe odkrycia

- `PhotoUploader.tsx:754-771` — ProgressModal już renderuje 2 kroki zależne od `stage`; nie potrzeba nowych komponentów.
- `PhotoUploader.tsx:227` — jedyna linia do zmiany w source (dodać `?skipMatch=1`).
- `DetectionReview.tsx:2351` — `handleRerunMatch` to funkcja nieprzysiężona (nie-async); SSE logika zamknięta w `Promise` by-hand. Do wyekstrahowania jako `runSSEMatch(photoId): Promise<void>`.
- `DetectionReview.tsx:2295` — `runRerunVision` to `async function`; może `await runSSEMatch(photoId)` po sukcesie vision.
- `DetectionReview.tsx:2970-2977` — ProgressModal nie ma `steps`; `currentMatchItem` jest już przekazywany.
- Testy do aktualizacji: `PhotoUploader.test.tsx:305` (regex `\/process$` nie matchuje query stringa), `upload-flow.spec.ts:176,266`, `match-sse-progress.spec.ts:172,244` (glob pattern `**/process` nie matchuje `?skipMatch=1`), `manual-rematch.spec.ts:187` (brak mocka `match-stream`).

## Pożądany stan końcowy

Po implementacji:
- Kliknięcie „Analizuj" w `PhotoUploader` → modal otwiera się natychmiast z krokiem 1 „Analiza obrazu" (active, ~12s), następnie automatycznie przechodzi do kroku 2 „Dopasowywanie" z paskiem postępu i tytułami (~57s).
- Kliknięcie „Ponów vision" w `DetectionReview` → identyczny 2-step modal; po zakończeniu `window.location.reload()`.
- Kliknięcie „Ponów match" w `DetectionReview` → modal z jednym krokiem „Dopasowywanie" (active) + pasek postępu.
- Brak podwójnego matchowania — `/process?skipMatch=1` w obu komponentach.

## Czego NIE robimy

- Nie zmieniamy `PhotoListIsland` — już naprawiony.
- Nie zmieniamy wyglądu `ProgressModal` komponentu — API jest wystarczające.
- Nie dodajemy progress-modalа do pozostałych form (confirm/bulk-accept) — one są szybkie.
- Nie zmieniamy `PhotoUploader` UI — tylko URL call w `processPhoto`.
- Nie refaktoryzujemy zarządzania stanem `DetectionReview` poza zakresem SSE/vision.

## Podejście do implementacji

Dwie fazy: najpierw `PhotoUploader` (jednolinijkowy fix + aktualizacje testów), potem `DetectionReview` (ekstrakcja SSE helpera + 2-step modal + testy). Fazy są niezależne, testowalne osobno.

## Krytyczne szczegóły implementacji

**Ekstrakcja SSE w DetectionReview**: `handleRerunMatch` jest nieprzysiężona — otwiera SSE i w listenerach zarządza stanem `actionBusy`/`actionBusyLabel`. Po refaktorze: wyekstrahować logikę SSE do `async function runSSEMatch(photoId: string): Promise<void>` (bez dotykania `actionBusy` wewnątrz — caller zarządza stanem). `handleRerunMatch` i `runRerunVision` stają się thin wrapperami: `setActionBusy(true); runSSEMatch(photoId).finally(() => setActionBusy(false))`. `runRerunVision` ustawia `rerunVisionPhase='vision'` przed `/process?skipMatch=1`, następnie `'matching'` przed `runSSEMatch`, a na końcu `null`.

**`steps` w ProgressModal DetectionReview**: Pojedynczy nowy stan `rerunVisionPhase: 'vision' | 'matching' | null`. `steps` prop:
```
steps={
  rerunVisionPhase !== null
    ? [
        { label: 'Analiza obrazu', status: rerunVisionPhase === 'vision' ? 'active' : 'done' },
        { label: 'Dopasowywanie do baz książek', status: rerunVisionPhase === 'matching' ? 'active' : 'pending' },
      ]
    : actionBusy
    ? [{ label: 'Dopasowywanie do baz książek', status: 'active' as const }]
    : undefined
}
```

**Glob `**` vs URL predicate w Playwright**: wzorzec `**/api/photos/${id}/process` nie matchuje query stringa `?skipMatch=1` — update do predicate `(url) => url.pathname === ...` (precedens: `shelf-photo-pipeline-ui.spec.ts` naprawiony w bieżącej sesji).

---

## Faza 1: PhotoUploader — fix `/process?skipMatch=1` + testy

### Przegląd

Eliminacja podwójnego matchowania i prawidłowe rozłożenie ~70s między krok 1 (vision, ~12s) i krok 2 (SSE matching, ~57s). UI modala w `PhotoUploader` jest już gotowe — jedyna zmiana w source to jeden znak (`?skipMatch=1`).

### Wymagane zmiany

#### 1. `src/components/PhotoUploader.tsx`

**Plik**: `src/components/PhotoUploader.tsx`

**Cel**: Wyeliminować podwójne matchowanie i sprawić, żeby faza `processing` (krok 1 modala) trwała ~12s zamiast ~70s.

**Kontrakt**: Zmienić linię 227 z `/api/photos/${photoId}/process` na `/api/photos/${photoId}/process?skipMatch=1`. Bez innych zmian w tym pliku.

#### 2. `tests/unit/components/PhotoUploader.test.tsx`

**Plik**: `tests/unit/components/PhotoUploader.test.tsx`

**Cel**: Zaktualizować filtr processCalls który używa anchoru `$` — po zmianie URL regex `\/process$` przestaje matchować `\/process?skipMatch=1`.

**Kontrakt**: Linia 305 — zmienić `/\/process$/` na `/\/process/` (lub `/\/process\b/` jeśli potrzebna precyzja). Nie zmieniać asercji `toHaveLength(1)`.

#### 3. `tests/e2e/upload-flow.spec.ts`

**Plik**: `tests/e2e/upload-flow.spec.ts`

**Cel**: Route mock dla `/process` nie matchuje query stringa — zaktualizować do URL predicate function (precedens z `shelf-photo-pipeline-ui.spec.ts`).

**Kontrakt**: Linie 176 i 265-266 — zamienić `page.route(`**/api/photos/${PHOTO_ID}/process`, ...)` na `page.route((url) => url.pathname === `/api/photos/${PHOTO_ID}/process`, ...)`.

#### 4. `tests/e2e/match-sse-progress.spec.ts`

**Plik**: `tests/e2e/match-sse-progress.spec.ts`

**Cel**: To samo co upload-flow — route mocks dla `/process` nie matchują `?skipMatch=1`.

**Kontrakt**: Linie 172 i 244 — zamienić glob pattern na URL predicate `(url) => url.pathname === ...`.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npx vitest run tests/unit/components/PhotoUploader.test.tsx` — wszystkie testy zielone
- `npx playwright test tests/e2e/upload-flow.spec.ts tests/e2e/match-sse-progress.spec.ts` — zielone

#### Weryfikacja ręczna

- Upload zdjęcia: modal otwiera się natychmiast po kliknięciu „Analizuj", krok 1 „Analiza obrazu" jest active przez ~12s, następnie automatycznie krok 2 „Dopasowywanie do baz książek" z paskiem postępu

---

## Faza 2: DetectionReview — 2-step modal + SSE refactor

### Przegląd

Refaktoryzacja `DetectionReview.tsx`: ekstrakcja SSE logiki do shared helper, `runRerunVision` dostaje split vision + SSE chain, ProgressModal dostaje `steps` prop.

### Wymagane zmiany

#### 1. `src/components/DetectionReview.tsx` — nowy stan

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Śledzić fazę rerun-vision żeby ProgressModal wiedział który krok jest aktywny.

**Kontrakt**: Dodać stan po linii 2124 (`matchSourceRef`):
```ts
const [rerunVisionPhase, setRerunVisionPhase] = useState<'vision' | 'matching' | null>(null);
```

#### 2. `src/components/DetectionReview.tsx` — ekstrakcja `runSSEMatch`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Wyekstrahować SSE logikę z `handleRerunMatch` do reużywalnego async helpera, żeby `runRerunVision` mógł go `await`ować.

**Kontrakt**: Nowa funkcja `async function runSSEMatch(photoId: string): Promise<void>` zawierająca obecną logikę `Promise<void>` z `handleRerunMatch` (EventSource, addEventListener progress/done/error, fallback do `/match`). Funkcja zarządza stanem `matchTitles`, `matchProgress`, `matchStats`, `currentMatchItem` ale NIE dotyka `actionBusy`/`actionBusyLabel` — caller jest właścicielem tych stanów.

Przykładowa sygnatura:
```ts
async function runSSEMatch(photoId: string): Promise<void> {
  // ... istniejąca logika Promise z handleRerunMatch ...
}
```

#### 3. `src/components/DetectionReview.tsx` — `handleRerunMatch` jako wrapper

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: `handleRerunMatch` staje się thin wrapperem wokół `runSSEMatch` — zachowuje dotychczasowy API (setActionBusy, actionBusyLabel, reload).

**Kontrakt**: `handleRerunMatch` wywołuje:
1. `setActionBusyLabel('Dopasowywanie do baz książek...')` + reset match states
2. `setActionBusy(true)`
3. `runSSEMatch(photoId).then(() => window.location.reload()).catch(...).finally(() => { setActionBusyLabel(null); setActionBusy(false); })`

#### 4. `src/components/DetectionReview.tsx` — `runRerunVision` z SSE chain

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Podzielić obecne ~70s na 2 fazy z progresem: vision (~12s) + SSE matching (~57s).

**Kontrakt**: Zmienić `runRerunVision` (linia 2295) na:
1. `setRerunVisionPhase('vision')` + `setActionBusyLabel('Analiza vision...')` + `setActionBusy(true)`
2. `fetch(/process?skipMatch=1)` — obsługa błędów bez zmian (409, 429, 403 NO_API_KEY, !ok)
3. Po sukcesie: `setRerunVisionPhase('matching')` + reset match states
4. `await runSSEMatch(photoId)`
5. `window.location.reload()`
6. `finally: setRerunVisionPhase(null)` + `setActionBusyLabel(null)` + `setActionBusy(false)`

Stary `/match` fallback call (linia 2324) usunąć — `runSSEMatch` ma własny SSE-error fallback.

#### 5. `src/components/DetectionReview.tsx` — ProgressModal `steps`

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Pokazać wskaźnik kroków w modalu — 2 kroki dla rerun-vision, 1 krok dla rerun-match-only.

**Kontrakt**: Aktualizacja ProgressModal (linia 2970) — dodać `steps` prop:
```tsx
steps={
  rerunVisionPhase !== null
    ? [
        { label: 'Analiza obrazu', status: rerunVisionPhase === 'vision' ? 'active' : 'done' },
        { label: 'Dopasowywanie do baz książek', status: rerunVisionPhase === 'matching' ? 'active' : 'pending' },
      ]
    : actionBusy
    ? [{ label: 'Dopasowywanie do baz książek', status: 'active' as const }]
    : undefined
}
```

#### 6. `tests/e2e/manual-rematch.spec.ts`

**Plik**: `tests/e2e/manual-rematch.spec.ts`

**Cel**: Test „progress modal: widoczny podczas toolbar rerun match" (linia 187) mockuje tylko `/match` (fallback) ale nie `/match-stream` — po refaktorze `handleRerunMatch` próbuje SSE najpierw. Dodać mock `match-stream` który jest przetrzymywany (held) tak jak `/match`.

**Kontrakt**: W teście (linia 187) dodać `page.route(`**/api/photos/${PHOTO_ID}/match-stream`, ...)` z held promise (tak jak `/match`). Alternatywnie: zamienić held `/match` na held `match-stream` — `match-stream` jest teraz primary path. Zweryfikować że asercja modal + reload nadal przechodzą.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npx vitest run` — suite bez regresji (brak nowych failów w DetectionReview)
- `npx playwright test tests/e2e/manual-rematch.spec.ts` — zielone
- `npx playwright test tests/e2e/shelf-photo-pipeline-ui.spec.ts` — zielone (smoke na DetectionReview panel test 3.10)
- `npm run typecheck` — brak błędów TypeScript

#### Weryfikacja ręczna

- `/photos/[id]` → kliknij „Ponów vision (nowy run)" → modal z 2 krokami: krok 1 „Analiza obrazu" active ~12s, automatycznie krok 2 „Dopasowywanie do baz książek" z paskiem postępu → reload po zakończeniu
- `/photos/[id]` → kliknij „Ponów match" → modal z 1 krokiem „Dopasowywanie" + pasek postępu → reload

---

## Strategia testowania

### Testy jednostkowe

- `PhotoUploader.test.tsx` — aktualizacja regex `\/process$` → `\/process` (1 linia)
- `DetectionReview` unit tests — jeśli istnieją testy `runRerunVision`/`handleRerunMatch`, zaktualizować mocki dla SSE

### Testy E2E

- `upload-flow.spec.ts` — URL predicate dla `/process` (2 miejsca)
- `match-sse-progress.spec.ts` — URL predicate dla `/process` (2 miejsca)
- `manual-rematch.spec.ts` — dodać/zaktualizować mock `match-stream` dla testu progress-modal

### Kroki weryfikacji ręcznej

1. Upload flow: pełny happy path z widocznym 2-step modal
2. DetectionReview rerun-vision: 2-step modal działa, reload po zakończeniu
3. DetectionReview rerun-match: 1-step modal z paskiem postępu, reload po zakończeniu
4. Sprawdź że nie ma podwójnego matchowania w logu Network DevTools (tylko jedno `/process?skipMatch=1` + jedno `/match-stream` per run)

## Referencje

- Poprzedni slice (pattern do naśladowania): `context/changes/match-vision-progress-sse/plan.md`
- PhotoUploader ProgressModal: `src/components/PhotoUploader.tsx:754-771`
- DetectionReview ProgressModal: `src/components/DetectionReview.tsx:2970-2977`
- PhotoListIsland runVision (wzorzec do naśladowania): `src/components/PhotoListIsland.tsx:226-271`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: PhotoUploader — fix skipMatch + testy

#### Automatyczne

- [x] 1.1 `npx vitest run tests/unit/components/PhotoUploader.test.tsx` — zielone — c2f9e61
- [x] 1.2 `npx playwright test tests/e2e/upload-flow.spec.ts tests/e2e/match-sse-progress.spec.ts` — zielone (adaptacja: 3-step modal + waitForRequest w teście) — c2f9e61

#### Ręczne

- [ ] 1.3 Upload flow: 2-step modal — krok 1 „Analiza obrazu" ~12s, krok 2 „Dopasowywanie" z paskiem postępu

### Faza 2: DetectionReview — SSE refactor + 2-step modal

#### Automatyczne

- [x] 2.1 `npx vitest run` — brak nowych failów
- [x] 2.2 `npx playwright test tests/e2e/manual-rematch.spec.ts` — zielone
- [x] 2.3 `npx playwright test tests/e2e/shelf-photo-pipeline-ui.spec.ts` — zielone (adaptacja: URL predicate dla /process w uploadAndGetToReviewPage)
- [x] 2.4 `npm run typecheck` — brak błędów

#### Ręczne

- [ ] 2.5 DetectionReview „Ponów vision": 2-step modal, krok 1 active ~12s → krok 2 z paskiem → reload
- [ ] 2.6 DetectionReview „Ponów match": 1-step modal z paskiem postępu → reload
