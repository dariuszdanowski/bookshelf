# Camera Capture Implementation Plan

## Overview

Dodajemy do `/upload` możliwość robienia zdjęcia bezpośrednio z kamery — na telefonie
przez natywny aparat systemu (`capture="environment"`), na desktopie przez `getUserMedia`
z podglądem wideo inline. Wynik obu ścieżek to `File`, który wchodzi do istniejącego
`handleFile()` bez żadnych zmian API ani migracji DB.

## Current State Analysis

`PhotoUploader.tsx` ma:
- `<input type="file" accept="image/*" ref={fileInputRef}>` (linia ~459) — jedyna ścieżka
  pobrania pliku
- `handleFile(file: File)` — pipeline SHA-256 → check-hash → doUpload → processPhoto
- Drag-drop, progress states, error handling — wszystko gotowe

Brak jakichkolwiek odwołań do `getUserMedia` / `MediaDevices` w codebase.

## Desired End State

Użytkownik na `/upload` widzi dwa przyciski akcji: „Wybierz plik" (istniejący) i „Zrób
zdjęcie" (nowy). Na telefonie „Zrób zdjęcie" otwiera natywny aparat. Na desktopie (gdy
przeglądarka wspiera `getUserMedia`) otwiera inline podgląd kamery z przyciskiem
przechwycenia klatki. Po zrobieniu zdjęcia reszta flow (upload → vision → match) jest
identyczna jak przy wyborze pliku.

### Key Discoveries

- `handleFile(file: File)` w PhotoUploader.tsx jest punktem wejścia dla każdego pliku —
  camera capture może go wywołać bez zmian kontraktu
- `<input capture="environment">` to czysty HTML bez JS; na mobile otwiera kamera systemu
- `getUserMedia` wymaga HTTPS lub localhost — prod (CF Workers) i dev (localhost:4321) OK
- Playwright wspiera fake video device przez `--use-fake-device-for-media-stream` w
  chromium args lub `addInitScript` mock

## What We're NOT Doing

- Crop / zoom w podglądzie kamery
- Nagrywanie wideo
- Podgląd z tylnej kamery na desktopie (environment vs user constraint)
- Obsługa HEIC z kamery (istniejący pipeline już ma best-effort HEIC handling)
- Zmiana pipeline'u po stronie API (endpointy, DB — zero zmian)

## Implementation Approach

Trzy fazy:
1. **Mobile capture** — minimalna zmiana w PhotoUploader.tsx: nowy hidden input z
   `capture="environment"` + przycisk. Testowalne na telefonie lub przez DevTools `capture`.
2. **Desktop camera** — nowy `CameraPreview.tsx` (getUserMedia + video + canvas) wołany
   z PhotoUploader.tsx z feature-detect guard. Permission-denied handled inline.
3. **E2E** — testy obu ścieżek z Playwright fake-device / mock getUserMedia.

## Critical Implementation Details

- **Feature detection po hydratacji**: `navigator.mediaDevices` jest `undefined` w SSR
  (renderowanie server-side nie ma `window`). Sprawdzenie musi być w `useEffect` lub
  lazy-checked przy kliknięciu — nie na poziomie modułu.
- **Stream cleanup**: `getUserMedia` stream musi być zatrzymany (`track.stop()`) na
  unmount `CameraPreview` i po przechwyceniu klatki — inaczej wskaźnik kamery w OS
  pozostaje aktywny.
- **canvas → File**: `canvas.toBlob(blob => new File([blob], 'camera.jpg', { type: 'image/jpeg' }))`
  — callback-based; musi wywołać `handleFile(file)` wewnątrz callbacku.

---

## Phase 1: Mobile Capture Path

### Overview

Dodajemy „Zrób zdjęcie" przycisk do PhotoUploader.tsx wyzwalający ukryty
`<input type="file" capture="environment">`. Na mobilnych przeglądarkach otwiera natywny
aparat; na desktopie zachowuje się jak zwykły file picker (przeglądarka ignoruje
`capture` lub pokazuje opcje kamery/pliku). Reszta pipeline bez zmian.

### Changes Required

#### 1. PhotoUploader.tsx — nowy ref kamery + przycisk

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Dodaj ukryty `<input>` z `capture="environment"` obsługiwany przez nowy ref
`cameraInputRef`. Dodaj przycisk „Zrób zdjęcie" obok istniejącego „Wybierz plik", który
wyzwala `cameraInputRef.current?.click()`. Handler `onChange` jest ten sam co dla
`fileInputRef` — wyjmij go jako `handleFileInputChange(e)` i przypisz do obu inputów.

**Contract**:
```
cameraInputRef: React.RefObject<HTMLInputElement>
handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  → calls handleFile(e.target.files?.[0])
  → resets input value (umożliwia ponowny wybór tego samego pliku)

<input
  type="file" accept="image/*" capture="environment"
  ref={cameraInputRef}
  className="hidden"
  data-testid="camera-input"
  onChange={handleFileInputChange}
/>

<button data-testid="camera-capture-btn" onClick={() => cameraInputRef.current?.click()}>
  Zrób zdjęcie
</button>
```

### Success Criteria

#### Automated Verification

- `npm run typecheck` — brak błędów TypeScript
- `npm run lint` — brak lint errors
- `npm run test` — istniejące unit testy zielone (brak nowych unit testów w tej fazie)

#### Manual Verification

- Otwórz `/upload` na desktop: widać dwa przyciski „Wybierz plik" i „Zrób zdjęcie"
- Kliknięcie „Zrób zdjęcie" otwiera file picker (desktop zachowanie — `capture` ignorowany)
- Na mobile (DevTools → Mobile emulation): `capture="environment"` widoczny w DOM

---

## Phase 2: Desktop Camera (getUserMedia + CameraPreview)

### Overview

Nowy komponent `CameraPreview.tsx` — inline podgląd kamery z `<video>` i przyciskiem
„Zrób zdjęcie" + „Anuluj". PhotoUploader.tsx sprawdza `navigator.mediaDevices?.getUserMedia`
po hydratacji i jeśli dostępne — kliknięcie „Zrób zdjęcie" otwiera CameraPreview zamiast
`cameraInputRef.click()`. Po przechwyceniu klatki: canvas → blob → File → `handleFile()`.

### Changes Required

#### 1. CameraPreview.tsx — nowy komponent

**File**: `src/components/CameraPreview.tsx`

**Intent**: Komponent zarządzający cyklem życia kamery: mount → getUserMedia → podgląd
`<video>` → przechwycenie → canvas.toBlob → onCapture(file). Sprzątanie streamu na unmount
i po capture. Permission-denied renderuje error inline. Anuluj wzywa onCancel + stop stream.

**Contract**:
```ts
interface CameraPreviewProps {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

// test-ids: camera-preview, camera-preview-video,
//           camera-preview-take, camera-preview-cancel,
//           camera-preview-error
```

Flow: `useEffect` → `getUserMedia({ video: { facingMode: 'environment' } })` →
`videoRef.current.srcObject = stream` → on tak: show video + buttons; on błąd:
`setError(e.name === 'NotAllowedError' ? 'permission' : 'unavailable')`.

Capture: `canvas.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)` →
`canvas.toBlob(blob => onCapture(new File([blob!], 'camera.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.85)`.

Cleanup: `return () => stream?.getTracks().forEach(t => t.stop())` w useEffect dependency array.

#### 2. PhotoUploader.tsx — integracja CameraPreview

**File**: `src/components/PhotoUploader.tsx`

**Intent**: Dodaj stan `cameraOpen: boolean` i `supportsDesktopCamera: boolean` (wyznaczany
w `useEffect` po hydratacji). Gdy `supportsDesktopCamera` i `cameraOpen` — renderuj
`<CameraPreview>` inline (zamiast standardowego drag-drop area). Przycisk „Zrób zdjęcie"
po kliknięciu: jeśli `supportsDesktopCamera` → setCameraOpen(true), else → cameraInputRef.click().

**Contract**:
```ts
const [cameraOpen, setCameraOpen] = useState(false);
const [supportsDesktopCamera, setSupportsDesktopCamera] = useState(false);

useEffect(() => {
  setSupportsDesktopCamera(
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}, []);

// handleCameraCapture: (file: File) => { setCameraOpen(false); handleFile(file); }
// handleCameraCancel: () => setCameraOpen(false)
```

Gdy `cameraOpen`: renderuj `<CameraPreview onCapture={handleCameraCapture} onCancel={handleCameraCancel} />`
zamiast strefy drag-drop. Przycisk „Zrób zdjęcie" disabled gdy `stage !== 'idle'`.

### Success Criteria

#### Automated Verification

- `npm run typecheck` — brak błędów TypeScript
- `npm run lint` — brak lint errors
- `npm run test` — istniejące testy zielone

#### Manual Verification

- Desktop Chrome na `/upload`: kliknięcie „Zrób zdjęcie" otwiera inline podgląd kamery
- Przeglądarka pyta o uprawnienie do kamery
- Po akceptacji: widać podgląd live w `<video>`
- Przycisk „Zrób zdjęcie" w CameraPreview → canvas snapshot → wraca do formularza z
  plikiem gotowym do uploadu (reszta pipeline uruchamia się normalnie)
- Odmowa uprawnienia: widać komunikat błędu zamiast podglądu
- Przycisk „Anuluj" zamyka CameraPreview bez uploadu
- Wskaźnik kamery w OS gaśnie po zamknięciu (stream zatrzymany)

---

## Phase 3: E2E Tests

### Overview

Testy Playwright pokrywające oba happy-paths i edge-case permission-denied. Mobile path
testowany przez kliknięcie przycisku i weryfikację obecności elementu z `capture`.
Desktop path wymaga fake-device (`--use-fake-device-for-media-stream`) i `addInitScript`
mockującego `getUserMedia`.

### Changes Required

#### 1. playwright.config.ts — chromium args dla fake camera

**File**: `playwright.config.ts`

**Intent**: Dodaj do projektu chromium `use.launchOptions.args` flagę
`--use-fake-device-for-media-stream` i `--use-fake-ui-for-media-stream` — pozwala Playwright
emulować kamerę bez real hardware i automatycznie akceptuje permission dialog.

**Contract**:
```ts
// W projekcie 'chromium' (istniejący):
use: {
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
}
```

#### 2. camera-capture.spec.ts — nowy spec

**File**: `tests/e2e/camera-capture.spec.ts`

**Intent**: Spec pokrywający:
- (1) Przycisk „Zrób zdjęcie" widoczny na stronie upload
- (2) Mobile path: kliknięcie przycisku gdy `supportsDesktopCamera=false` → input z
  `capture="environment"` jest w DOM
- (3) Desktop path: po `addInitScript` mockującym `getUserMedia` → kliknięcie → CameraPreview
  widoczny → kliknięcie „Zrób zdjęcie" → modal znika, pipeline startuje (weryfikacja przez
  request do `/api/photos` lub zmianę stage label)
- (4) Przycisk „Anuluj" w CameraPreview → zamknięcie bez uploadu
- (5) Permission-denied: mock `getUserMedia` rzucający `NotAllowedError` → error message widoczny

Wszystkie testy mockują `/api/shelves`, `/api/account/keys`, `/api/photos`, `/api/photos/*/process`
przez `page.route`. Zero realnych vision calls.

### Success Criteria

#### Automated Verification

- `npm run test:e2e -- --grep "camera-capture"` — wszystkie testy zielone
- `npm run typecheck` — brak błędów
- `npm run lint` — brak lint errors
- `npm run test` — istniejące unit testy zielone

#### Manual Verification

- Pełne `npm run test:e2e` przechodzi (brak regresji w innych specach)
- Na telefonie (real device lub BrowserStack): „Zrób zdjęcie" otwiera aparat systemowy

---

## Testing Strategy

### Unit Tests

Nie dodajemy osobnych unit testów dla komponentów kamery — logika jest minimalna
(getUserMedia → srcObject → toBlob), pokryta E2E z fake-device.

### E2E Tests

Patrz Phase 3. Kluczowe edge case'y:
- `getUserMedia` unavailable (HTTP, stary browser) → fallback do `<input capture>`
- Permission denied → error message
- Anulowanie podglądu → brak side-effectów

### Manual Testing Steps

1. Desktop Chrome: otwórz `/upload`, kliknij „Zrób zdjęcie", zaakceptuj kamerę
2. Zrób zdjęcie, weryfikuj że pipeline startuje (Wgrywanie..., Analiza...)
3. Odmawiaj uprawnienia → sprawdź komunikat błędu
4. Kliknij „Anuluj" → podgląd znika, form dostępny
5. Na mobile: „Zrób zdjęcie" → natywna aplikacja aparatu

## Performance Considerations

- `getUserMedia` stream zatrzymywany natychmiast po capture (nie blokuje pipeline)
- Canvas snapshot to `jpeg/0.85` — zmniejsza wagę vs raw frame
- Nie renderujemy CameraPreview dopóki `cameraOpen=true` (lazy mount)

## References

- Roadmap: `context/foundation/roadmap.md` (S-42)
- PhotoUploader: `src/components/PhotoUploader.tsx`
- Podobne E2E mocking: `tests/e2e/upload-flow.spec.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Mobile Capture Path

#### Automated

- [x] 1.1 npm run typecheck — brak błędów TypeScript — 4fdc30f
- [x] 1.2 npm run lint — brak lint errors — 4fdc30f
- [x] 1.3 npm run test — istniejące unit testy zielone — 4fdc30f

#### Manual

- [x] 1.4 Widoczne dwa przyciski: „Wybierz plik" i „Zrób zdjęcie" — 4fdc30f
- [x] 1.5 Kliknięcie „Zrób zdjęcie" na desktop otwiera file picker — 4fdc30f
- [x] 1.6 input[capture="environment"] obecny w DOM — 4fdc30f

### Phase 2: Desktop Camera (getUserMedia + CameraPreview)

#### Automated

- [x] 2.1 npm run typecheck — brak błędów TypeScript
- [x] 2.2 npm run lint — brak lint errors
- [x] 2.3 npm run test — istniejące unit testy zielone

#### Manual

- [x] 2.4 Desktop Chrome: „Zrób zdjęcie" → inline podgląd kamery
- [x] 2.5 Po akceptacji uprawnienia: live video widoczny
- [x] 2.6 Capture → file pojawia się w pipeline (Wgrywanie...)
- [x] 2.7 Odmowa uprawnienia → komunikat błędu inline
- [x] 2.8 „Anuluj" zamyka podgląd bez uploadu
- [x] 2.9 Wskaźnik kamery gaśnie po zamknięciu

### Phase 3: E2E Tests

#### Automated

- [ ] 3.1 npm run test:e2e --grep camera-capture — testy zielone
- [ ] 3.2 npm run typecheck — brak błędów
- [ ] 3.3 npm run lint — brak lint errors
- [ ] 3.4 npm run test — istniejące unit testy zielone
- [ ] 3.5 Pełne npm run test:e2e — brak regresji

#### Manual

- [ ] 3.6 Na telefonie (real device): „Zrób zdjęcie" otwiera aparat systemowy
