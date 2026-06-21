# Potwierdzenie przed vision / rematch — Plan implementacji

## Przegląd

Kilka przycisków w UI wywołuje kosztowne operacje (API calls do Anthropic, nadpisanie wyników dopasowania) bez żadnego potwierdzenia. Użytkownik może je kliknąć przez pomyłkę. Dodajemy `ConfirmDialog` przed każdą taką akcją — wzorzec już istnieje w kodzie (rerun-vision, delete-photo mają go od dawna).

## Analiza stanu obecnego

**Bez potwierdzenia (do naprawy):**
- `PhotoListIsland.tsx:530` — "Uruchom vision" → `handleRunVision(id, false)` → `/api/photos/{id}/process`
- `PhotoListIsland.tsx:542` — "Ponów vision (nowy run)" → `handleRunVision(id, true)` — **UPS: już ma ConfirmDialog** (linia 623-637), ale tylko dla `isRerun=true`; "Uruchom vision" (isRerun=false, stage='uploaded') nie ma
- `PhotoListIsland.tsx:554` — "Uruchom match" → `handleRunMatch(id)` → `/api/photos/{id}/match-stream`
- `PhotoListIsland.tsx:566` — "Ponów match" → `handleRunMatch(id)` → jw.
- `DetectionReview.tsx:1224` — `RefineButton` onClick → `handleRefine()` → `/api/detections/{id}/refine` (płatne)
- `DetectionReview.tsx:1572` — jw. (widok table)
- `DetectionReview.tsx:1872` — jw. (widok tiles)

**Już mają potwierdzenie (nie ruszamy):**
- `PhotoListIsland.tsx:623-637` — "Ponów vision (nowy run)" ✅
- `PhotoListIsland.tsx:639-654` — "Usuń zdjęcie" ✅
- `DetectionReview.tsx:3078-3093` — "Ponów vision" (header pliku) ✅

**Poza zakresem (nie zmieniam):**
- "Szukaj po tytule" (rematch) — otwiera formularz, form = wystarczający friction
- PhotoUploader retry — kontekst błędu, user wie co robi

## Pożądany stan końcowy

Każde kliknięcie "Uruchom vision", "Uruchom match", "Ponów match" lub "Doprecyzuj odczyt" otwiera `ConfirmDialog` z tytułem i krótkim opisem. Dopiero po kliknięciu przycisku potwierdzenia akcja jest wykonywana.

## Czego NIE robimy

- Nie zmieniamy "Szukaj po tytule" (rematch form) — form jest już potwierdzeniem
- Nie zmieniamy PhotoUploader retry
- Nie refaktorujemy `useDetectionDecision` — dodajemy tylko stan `confirmRefine` i dialog

## Podejście

**PhotoListIsland** — trzy nowe stany `pendingVisionPhotoId`, `pendingMatchPhotoId` + dwa `ConfirmDialog` na końcu renderowania (analogicznie do istniejących). `handleRunVision(id, false)` i `handleRunMatch(id)` wyzwalamy dopiero z callbacku `onConfirm`.

**DetectionReview** — `useDetectionDecision` (linia 538) zwraca już `handleRefine`. Dodajemy state `confirmRefine` do hooka, zwracamy go. W każdym z 3 widoków: `onClick` na `RefineButton` zmienia na `setConfirmRefine(true)`, dodajemy `<ConfirmDialog>` wewnątrz widoku.

## Faza 1: PhotoListIsland — confirm dla vision i match

### Przegląd

Dodanie dwóch stanów pending i dwóch `ConfirmDialog` do PhotoListIsland. Bez zmian API, bez zmian handlersów.

### Wymagane zmiany

#### 1. Nowe stany

**Plik**: `src/components/PhotoListIsland.tsx`

**Cel**: Dwa nowe stany przechowujące id zdjęcia oczekującego na potwierdzenie.

**Kontrakt**:
```ts
const [pendingVisionPhotoId, setPendingVisionPhotoId] = useState<string | null>(null);
const [pendingMatchPhotoId, setPendingMatchPhotoId] = useState<string | null>(null);
```
Dodać obok istniejących `pendingRerunPhotoId` i `pendingDeletePhotoId` (linia ~49-50).

#### 2. Zmiana onClick przycisków

**Plik**: `src/components/PhotoListIsland.tsx`

**Cel**: Przyciski otwierają dialog zamiast od razu wywoływać akcję.

**Kontrakt**:
- Linia ~530 `onClick={() => handleRunVision(photo.id, false)}` → `onClick={() => setPendingVisionPhotoId(photo.id)}`
- Linia ~554 `onClick={() => handleRunMatch(photo.id)}` (stage=`vision_done`) → `onClick={() => setPendingMatchPhotoId(photo.id)}`
- Linia ~566 `onClick={() => handleRunMatch(photo.id)}` (stage=`match_done|confirmed`) → `onClick={() => setPendingMatchPhotoId(photo.id)}`

#### 3. Dwa ConfirmDialog

**Plik**: `src/components/PhotoListIsland.tsx`

**Cel**: Dwa dialogi po istniejących (linia ~655), przed `<ProgressModal>`.

**Kontrakt**:
```tsx
<ConfirmDialog
  open={pendingVisionPhotoId != null}
  title="Uruchomić vision?"
  message="Zdjęcie zostanie przeanalizowane przez AI. Operacja zajmie kilka sekund i zużyje środki API."
  confirmLabel="Uruchom vision"
  cancelLabel="Anuluj"
  testIdPrefix="photo-vision-confirm"
  onCancel={() => setPendingVisionPhotoId(null)}
  onConfirm={() => {
    if (!pendingVisionPhotoId) return;
    const id = pendingVisionPhotoId;
    setPendingVisionPhotoId(null);
    void handleRunVision(id, false);
  }}
/>
<ConfirmDialog
  open={pendingMatchPhotoId != null}
  title="Uruchomić dopasowanie?"
  message="Obecne wyniki dopasowania zostaną nadpisane."
  confirmLabel="Uruchom match"
  cancelLabel="Anuluj"
  testIdPrefix="photo-match-confirm"
  onCancel={() => setPendingMatchPhotoId(null)}
  onConfirm={() => {
    if (!pendingMatchPhotoId) return;
    const id = pendingMatchPhotoId;
    setPendingMatchPhotoId(null);
    void handleRunMatch(id);
  }}
/>
```

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run typecheck` — brak błędów
- `npm run lint` — brak błędów
- `npm run test` — 845 testów zielone

#### Weryfikacja ręczna

- Kliknięcie "Uruchom vision" otwiera dialog (nie triggeruje od razu)
- Anuluj zamyka dialog bez akcji
- Potwierdź triggeruje vision
- Kliknięcie "Uruchom match" / "Ponów match" otwiera dialog
- Analogiczne zachowanie

---

## Faza 2: DetectionReview — confirm dla refine + E2E

### Przegląd

Dodanie stanu `confirmRefine` do `useDetectionDecision`, zwrócenie go z hooka, podłączenie w 3 widokach + ConfirmDialog. Nowy spec E2E weryfikuje dialogi.

### Wymagane zmiany

#### 1. Stan w useDetectionDecision

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Hook zarządza stanem dialogu — jedno miejsce dla wszystkich 3 widoków.

**Kontrakt**: Wewnątrz `function useDetectionDecision` (linia 538) dodać:
```ts
const [confirmRefine, setConfirmRefine] = useState(false);
```
I zwrócić z obiektu na końcu hooka (linia ~772):
```ts
confirmRefine,
setConfirmRefine,
```

#### 2. Destructure w 3 widokach

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Każdy widok pobiera nowe wartości z hooka.

**Kontrakt**: W każdym z 3 wywołań `useDetectionDecision` (linie 838, 1378, 1653) dodać `confirmRefine, setConfirmRefine` do destructuringu.

#### 3. Zmiana onClick RefineButton (×3)

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Kliknięcie otwiera dialog zamiast od razu wołać API.

**Kontrakt**: W każdym z 3 widoków zmienić:
```tsx
// linie 1224, 1572, 1872
onClick={() => void handleRefine()}
→
onClick={() => setConfirmRefine(true)}
```

#### 4. ConfirmDialog w każdym widoku (×3)

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Dialog tuż za RefineButton, wewnątrz komponentu widoku.

**Kontrakt**: Po `<RefineButton ... />` w każdym widoku dodać:
```tsx
<ConfirmDialog
  open={confirmRefine}
  title="Doprecyzować odczyt?"
  message="Uruchomi ponowną analizę AI grzbietu tej książki. Operacja jest płatna."
  confirmLabel="Doprecyzuj"
  cancelLabel="Anuluj"
  testIdPrefix="refine-confirm"
  onCancel={() => setConfirmRefine(false)}
  onConfirm={() => {
    setConfirmRefine(false);
    void handleRefine();
  }}
/>
```

#### 5. Import ConfirmDialog w DetectionReview (jeśli brak)

**Plik**: `src/components/DetectionReview.tsx`

**Cel**: Sprawdzić czy ConfirmDialog jest już importowany; jeśli nie — dodać.

**Kontrakt**: Grep na `import.*ConfirmDialog` — dodać jeśli brak.

#### 6. Testy E2E

**Plik**: `tests/e2e/confirm-vision-rematch.spec.ts` (nowy)

**Cel**: Weryfikacja że dialogi pojawiają się i blokują/przepuszczają akcję.

**Kontrakt**: Spec pokrywa:
- `run-vision-${PHOTO_ID}` click → dialog widoczny → anuluj → API nie wywołane
- `run-vision-${PHOTO_ID}` click → dialog widoczny → potwierdź → API wywołane
- `run-match-${PHOTO_ID}` click → dialog widoczny → anuluj → API nie wywołane
- Refine button click (w /photos/[id] z DetectionReview) → dialog widoczny → anuluj
- Wszystkie endpointy mockowane przez `page.route()`

### Kryteria sukcesu

#### Weryfikacja automatyczna

- `npm run typecheck` — brak błędów
- `npm run lint` — brak błędów
- `npm run test` — zielone
- `npm run test:e2e -- --grep "confirm-vision-rematch"` — nowe testy zielone

#### Weryfikacja ręczna

- "Doprecyzuj odczyt" w widoku kart → dialog
- "Doprecyzuj odczyt" w widoku tabeli → dialog
- "Doprecyzuj odczyt" w widoku kafelków → dialog
- Każdy dialog: Anuluj nie triggeruje API, Potwierdź triggeruje

---

## Strategia testowania

### E2E (spec: `confirm-vision-rematch.spec.ts`):
- 4 testy: confirm + cancel dla vision, confirm + cancel dla match (PhotoListIsland)
- 2 testy: confirm + cancel dla refine (DetectionReview)
- Wszystkie API mockowane przez `page.route((url) => url.pathname === '...', handler)`

## Referencje

- `ConfirmDialog`: `src/components/ConfirmDialog.tsx:1-84`
- Wzorzec rerun-vision: `PhotoListIsland.tsx:623-637`
- Wzorzec delete: `PhotoListIsland.tsx:639-654`
- `useDetectionDecision`: `DetectionReview.tsx:538`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: PhotoListIsland — confirm vision/match

#### Automatyczne

- [x] 1.1 typecheck zielony
- [x] 1.2 lint zielony
- [x] 1.3 unit testy zielone
- [x] 1.4 "Uruchom vision" → dialog
- [x] 1.5 "Uruchom match" / "Ponów match" → dialog

#### Ręczne

- [ ] 1.4 "Uruchom vision" → dialog
- [ ] 1.5 "Uruchom match" / "Ponów match" → dialog

### Faza 2: DetectionReview — confirm refine + E2E

#### Automatyczne

- [ ] 2.1 typecheck zielony
- [ ] 2.2 lint zielony
- [ ] 2.3 unit testy zielone
- [ ] 2.4 E2E `confirm-vision-rematch.spec.ts` zielone

#### Ręczne

- [ ] 2.5 "Doprecyzuj odczyt" w 3 widokach → dialog
