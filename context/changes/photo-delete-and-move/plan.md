# Photo Delete and Move (z widoku /photos/[id]) — Plan implementacji

## Przegląd

Strona detalu zdjęcia `/photos/[id]` nie oferuje akcji DELETE ani MOVE, które istnieją
w `PhotoListIsland` na `/shelves/[id]`. User może się do niej dostać klikając „Otwórz review"
z listy zdjęć lub przez deep-link z karty książki. Chcemy wyrównać funkcjonalność —
delete i move dostępne zarówno w widoku listy jak i widoku detalu.

## Analiza stanu obecnego

**Istnieje (w PhotoListIsland na /shelves/[id]):**
- `DELETE /api/photos/{id}` → kaskada detections/book_candidates, SET NULL na shelf_entries/vision_runs
- `PATCH /api/photos/{id}` z `{shelf_id}` → zmiana półki
- UI: button „Usuń" (modal potwierdzenia + optimistic delete)
- UI: `<select>` „Przenieś na…" (otherShelves prop z SSR)

**Brakuje (na /photos/[id] w DetectionReview):**
- Żadnych akcji DELETE ani MOVE — strona oferuje wyłącznie operacje na detekcjach

**Dostępne w DetectionReview (bez zmian):**
- `photo` state (linia 2102): `PhotoDTO` zawiera `shelf_id: string` ✓
- `ConfirmDialog` już zaimportowany ✓
- `actionBusy` i `isBboxEditing` — gotowe flagi do blokowania przycisków ✓
- Endpoint `GET /api/shelves` zwraca `{ data: { shelves: ShelfDTO[] } }` ✓

## Pożądany stan końcowy

Widok `/photos/[id]` ma kompaktowy pasek akcji z przyciskami „Usuń zdjęcie" (z modalem
potwierdzenia) i „Przenieś na…" (select z innymi półkami zalogowanego usera). Akcje są
zablokowane podczas wizji/edycji ramek. Po delete → redirect do `/shelves/{shelfId}?tab=photos`.
Po move → redirect do `/shelves/{targetShelfId}?tab=photos`. E2E testy pokrywają oba scenariusze.

### Kluczowe odkrycia

- `PhotoDTO.shelf_id` istnieje w schema.ts:38 i jest zwracany przez GET /api/photos/[id]:69–78
- DetectionReview ma dostęp do `photo.shelf_id` gdy `photo !== null` — bez potrzeby nowych props
- `ConfirmDialog` importowany i używany w DetectionReview (np. rerun-vision confirm)
- `GET /api/shelves` jest dostępny i zwraca `{ data: { shelves: [{id, name, ...}] } }`
- `ShelfDTO` zawiera `id, name` — to wystarczy do dropdown

## Czego NIE robimy

- Nie refaktoryzujemy PhotoListIsland — duplikacja logiki w DetectionReview jest świadoma (inne UX)
- Nie multi-select delete/move — one-photo scope tej zmiany
- Nie przenosimy shelf_entries wraz z foto przy MOVE — shelf_id w shelf_entries nie zmienia się
  (książka należy do starej półki, zdjęcie trafia na nową; to obecne zachowanie backendu i jest OK)
- Nie zmieniamy shelves endpoint — jest i działa
- Nie modyfikujemy /photos/[id].astro — akcje w DetectionReview (React), nie w Astro SSR

## Podejście do implementacji

Dodajemy do `DetectionReview.tsx`:
1. Fetch listy półek przy montowaniu (single `GET /api/shelves`)
2. Stan `showDeleteConfirm`, `isDeleting`, `isMoving`
3. Handlery `handleDeletePhoto` i `handleMovePhoto(targetShelfId)`
4. UI: kompaktowy `<div data-testid="photo-management-bar">` renderowany gdy `photo !== null`,
   umieszczony **przed** `PhotoDetectionOverlay` i vision-run panel
5. ConfirmDialog dla delete (reuse istniejącego)

---

## Faza 1: Akcje delete i move w DetectionReview

### Przegląd

Dodanie stanu, logiki i UI do DetectionReview.tsx. Nowy pasek "photo-management-bar"
renderowany gdy foto jest załadowane, z dwoma akcjami: move select i delete button.

### Wymagane zmiany

#### 1. `src/components/DetectionReview.tsx` — nowy stan

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Dodać stan i fetchowanie listy półek do komponentu DetectionReview (główna funkcja komponentu, ~linia 2100+).

**Kontrakt**:
```ts
// Nowe stany (w okolicach linii 2100–2110, obok istniejących useState)
const [allShelves, setAllShelves] = useState<Array<{id: string; name: string}> | null>(null);
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [isDeleting, setIsDeleting] = useState(false);
const [isMoving, setIsMoving] = useState(false);
```

Fetch półek w `useEffect` (po `photo` state się pojawi):
```ts
// Po załadowaniu foto — fetch półek (lazy: po co ładować wcześniej)
useEffect(() => {
  if (!photo) return;
  fetch('/api/shelves')
    .then((r) => r.json())
    .then((res) => {
      const list = res?.data?.shelves ?? [];
      // filtruj aktualną półkę
      setAllShelves(list.filter((s: {id: string}) => s.id !== photo.shelf_id));
    })
    .catch(() => setAllShelves([]));
}, [photo?.shelf_id]);
```

#### 2. `src/components/DetectionReview.tsx` — handlery akcji

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Dodać dwie funkcje obsługi: usuń zdjęcie i przenieś na inną półkę.

**Kontrakt** (dodać przy istniejących handlerach, np. po `handleRerunVisionClick`):
```ts
async function handleDeletePhoto() {
  if (!photo) return;
  setIsDeleting(true);
  try {
    const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    window.location.href = `/shelves/${photo.shelf_id}?tab=photos`;
  } catch {
    setIsDeleting(false);
    // można tu dodać toast — na razie console.error
    console.error('[DetectionReview] delete photo failed');
  }
}

async function handleMovePhoto(targetShelfId: string) {
  if (!photo) return;
  setIsMoving(true);
  try {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shelf_id: targetShelfId }),
    });
    if (!res.ok) throw new Error('move failed');
    window.location.href = `/shelves/${targetShelfId}?tab=photos`;
  } catch {
    setIsMoving(false);
    console.error('[DetectionReview] move photo failed');
  }
}
```

#### 3. `src/components/DetectionReview.tsx` — UI photo-management-bar

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Wyrenderować kompaktowy pasek akcji zdjęcia (delete + move), widoczny gdy `photo !== null`,
umieszczony w JSX przed `<PhotoDetectionOverlay>` (tj. zaraz po ewentualnych early returns loading/error).

**Kontrakt**:
- `data-testid="photo-management-bar"` na wrappującym `<div>`
- Move `<select>`:
  - `data-testid="move-photo-select"` 
  - `value=""` (reset po każdym MOVE)
  - `disabled={isMoving || isDeleting || actionBusy || isBboxEditing || !allShelves?.length}`
  - `onChange={(e) => void handleMovePhoto(e.target.value)}`
  - Opcja placeholder: `"Przenieś na…"` (value="", disabled)
  - Opcje: `allShelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)`
- Delete `<button>`:
  - `data-testid="delete-photo-button"`
  - `disabled={isDeleting || isMoving || actionBusy || isBboxEditing}`
  - `onClick={() => setShowDeleteConfirm(true)}`
  - Label: „Usuń" / „Usuwam…" gdy isDeleting
  - Style: czerwono-obwódkowy, jak w PhotoListIsland
- `<ConfirmDialog>` dla delete:
  - `open={showDeleteConfirm}`
  - `data-testid="photo-delete-confirm"`
  - `onConfirm={() => { setShowDeleteConfirm(false); void handleDeletePhoto(); }}`
  - `onCancel={() => setShowDeleteConfirm(false)}`
  - Treść: informacja ile detekcji zostanie usuniętych (`detections.length`)
  - data-testid przycisku OK: `"photo-delete-confirm-ok"`

Wizualnie pasek powinien być subtelny (szare tło, small text), nie dominować nad detekcjami.
Wzorzec stylów: skopiować z PhotoListIsland (linia 607–615 i 582–604 w PhotoListIsland.tsx).

### Kryteria sukcesu

#### Weryfikacja automatyczna

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit testy: `npm run test`
- Build: `npm run build`

#### Weryfikacja ręczna

- Na `/photos/{id}`: pasek z przyciskiem „Usuń" i selectem „Przenieś na…" jest widoczny
- Delete: pojawia się modal potwierdzenia → po OK redirect do `/shelves/{shelfId}?tab=photos`
- Move: wybranie półki → redirect do `/shelves/{targetId}?tab=photos`
- Podczas trwania vision (`actionBusy=true`): przyciski zablokowane

---

## Faza 2: E2E testy

### Przegląd

Nowy plik spec z dwoma testami dla operacji delete i move na widoku `/photos/[id]`.
Mock całej warstwy API (bez realnych wywołań).

### Wymagane zmiany

#### 1. `tests/e2e/photo-delete-and-move.spec.ts` — nowy plik

**Plik**: `tests/e2e/photo-delete-and-move.spec.ts`

**Cel**: Pokrycie E2E: (a) usunięcie zdjęcia z /photos/[id] → redirect do półki, (b) przeniesienie zdjęcia z /photos/[id] → redirect do nowej półki.

**Kontrakt** — struktura testów:

```ts
import { test, expect } from '@playwright/test';

const PHOTO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SHELF_A_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SHELF_B_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

// Mock photo GET response (PhotoDTO)
const MOCK_PHOTO_RESPONSE = {
  data: {
    photo: { id: PHOTO_ID, shelf_id: SHELF_A_ID, status: 'processed', ... },
    photo_url: '/api/photos/${PHOTO_ID}/image',
    detections: [],
    vision_run: null,
    costs_total_usd: null,
  }
};

// Mock shelves GET response (dla dropdown)
const MOCK_SHELVES_RESPONSE = {
  data: {
    shelves: [
      { id: SHELF_A_ID, name: 'Półka A', ... },
      { id: SHELF_B_ID, name: 'Półka B', ... },
    ]
  }
};

// Pomocnik setup: mock photo + shelves
async function setupPhotoPage(page: Page) {
  await page.route(`**/api/photos/${PHOTO_ID}`, (r) =>
    r.fulfill({ status: 200, body: JSON.stringify(MOCK_PHOTO_RESPONSE) })
  );
  await page.route('**/api/shelves', (r) =>
    r.fulfill({ status: 200, body: JSON.stringify(MOCK_SHELVES_RESPONSE) })
  );
  // Blokuj vision/match/image calls, żeby strona się nie zawiesiła
  await page.route(`**/api/photos/${PHOTO_ID}/image**`, (r) =>
    r.fulfill({ status: 200, contentType: 'image/jpeg', body: '' })
  );
}

test('usuwa zdjęcie z /photos/[id] → redirect do półki', async ({ page }) => {
  await setupPhotoPage(page);
  
  await page.route(`**/api/photos/${PHOTO_ID}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 200, body: JSON.stringify({ data: { deleted: true } }) });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify(MOCK_PHOTO_RESPONSE) });
    }
  });
  
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('photo-management-bar')).toBeVisible();
  
  await page.getByTestId('delete-photo-button').click();
  await expect(page.getByTestId('photo-delete-confirm')).toBeVisible();
  await page.getByTestId('photo-delete-confirm-ok').click();
  
  await page.waitForURL(`/shelves/${SHELF_A_ID}?tab=photos`);
});

test('przenosi zdjęcie z /photos/[id] → redirect do nowej półki', async ({ page }) => {
  await setupPhotoPage(page);
  
  await page.route(`**/api/photos/${PHOTO_ID}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 200, body: JSON.stringify({ data: { ...MOCK_PHOTO_RESPONSE.data.photo, shelf_id: SHELF_B_ID } }) });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify(MOCK_PHOTO_RESPONSE) });
    }
  });
  
  await page.goto(`/photos/${PHOTO_ID}`);
  await expect(page.getByTestId('photo-management-bar')).toBeVisible();
  
  const moveSelect = page.getByTestId('move-photo-select');
  await expect(moveSelect).toBeVisible();
  await moveSelect.selectOption(SHELF_B_ID);
  
  await page.waitForURL(`/shelves/${SHELF_B_ID}?tab=photos`);
});
```

Wzorzec teardown/storageState: reuse `auth.setup.ts` (standardowe dla wszystkich speców E2E).

### Kryteria sukcesu

#### Weryfikacja automatyczna

- E2E lokalne: `npm run test:e2e -- --grep "usuwa zdjęcie\|przenosi zdjęcie"`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Pełne E2E: `npm run test:e2e`

#### Weryfikacja ręczna

- Testy zielone lokalnie bez `test.skip`
- Brak regresji w istniejących specs (`photos-crud.spec.ts`, `shelf-photo-pipeline-ui.spec.ts`)

---

## Strategia testowania

### Testy automatyczne (E2E mock)

- `photo-delete-and-move.spec.ts` — 2 nowe testy z mockami API
- Wzorzec: `page.route` intercept (bez realnych Supabase calls)
- storageState: reuse globalny user z `auth.setup.ts`

### Testowanie ręczne

1. Otwórz `/photos/{id}` dla istniejącego zdjęcia
2. Sprawdź widoczność paska (move select + delete button)
3. Kliknij „Usuń" → modal → OK → redirect do półki z zakładką Zdjęcia
4. Otwórz inne zdjęcie → wybierz inną półkę w select → redirect do nowej półki
5. Sprawdź że zdjęcie zniknęło ze starej półki (zakładka Zdjęcia)
6. Na półce docelowej: zdjęcie pojawia się w zakładce Zdjęcia

## Referencje

- PhotoListIsland.tsx: linie 582–616 — wzorzec move select i delete button
- DetectionReview.tsx: linia 2102 — `photo` state; linia 2750+ — główny render
- `src/lib/photos/schema.ts`:38 — PhotoDTO z `shelf_id`
- `src/pages/api/photos/[id].ts`:426–494 — DELETE handler
- `src/pages/api/photos/[id].ts`:322–412 — PATCH handler
- `src/pages/api/shelves/index.ts` — GET /api/shelves → `{ data: { shelves: ShelfDTO[] } }`
- `tests/e2e/photos-crud.spec.ts` — wzorzec mock dla photo delete (istniejący test)

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Akcje delete i move w DetectionReview

#### Automatyczne

- [x] 1.1 Typecheck zielony: `npm run typecheck` — 7a86633
- [x] 1.2 Lint zielony: `npm run lint` — 7a86633
- [x] 1.3 Unit testy zielone: `npm run test` — 7a86633
- [x] 1.4 Build zielony: `npm run build` — 7a86633

#### Ręczne

- [x] 1.5 Pasek akcji widoczny na /photos/[id] — 7a86633
- [x] 1.6 Delete → modal → OK → redirect do /shelves/{shelfId}?tab=photos — 7a86633
- [x] 1.7 Move → select półka → redirect do /shelves/{targetId}?tab=photos — 7a86633
- [x] 1.8 Przyciski zablokowane podczas actionBusy — 7a86633

### Faza 2: E2E testy

#### Automatyczne

- [x] 2.1 E2E test delete zielony: `npm run test:e2e -- --grep "usuwa zdjęcie"`
- [x] 2.2 E2E test move zielony: `npm run test:e2e -- --grep "przenosi zdjęcie"`
- [x] 2.3 Brak regresji w istniejących E2E: `npm run test:e2e`
- [x] 2.4 Typecheck zielony po dodaniu spec
- [x] 2.5 Lint zielony po dodaniu spec
