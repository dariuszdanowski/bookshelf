# Progress Modal Plan implementacji

## Przegląd

Dodajemy blokujący modal postępu dla dwóch długich operacji: pipeline upload-vision-match
w `PhotoUploader` oraz ręczne rematch/refine w `DetectionReview`. Modal zastępuje subtelny
stan przycisku pełnoekranowym overlayem, który uniemożliwia przypadkową nawigację.

## Analiza stanu obecnego

**PhotoUploader.tsx:578–595** — ma już inline `progress-area` (spinner + `stageLabel[stage]`)
widoczny dla wszystkich etapów przetwarzania. User może mimo to kliknąć link nawigacyjny
w headerze, opuszczając stronę w trakcie trwającego fetch.

**DetectionReview.tsx (useDetectionDecision:537–785)** — hook ma `busy: boolean` ale obsługuje
nim WSZYSTKIE akcje (confirm, reject, rematch, refine). Tylko rematch i refine trwają
wystarczająco długo, by zasłużyć na modal. Pozostałe akcje (<1s) nie powinny pokazywać modalu.

**Istniejące modale** — 6 komponentów z identycznym wzorcem:
`useBodyScrollLock` + Escape-key + backdrop-click + `role="dialog"` + `aria-modal="true"`.
`ProgressModal` podąża tym samym wzorcem, z wyjątkiem: brak możliwości zamknięcia podczas
trwania operacji (Escape/backdrop dezaktywowane gdy `open=true`).

**E2E testid `progress-area`** — istnieje już w upload flow; używany w `camera-capture.spec.ts`
i `photo-dedup.spec.ts`. `ProgressModal` jest addytywny — nie usuwa istniejącego elementu,
tylko dodaje blocking overlay na wierzchu. Testy z `progress-area` nie zostają złamane.

## Pożądany stan końcowy

- Kliknięcie „Uruchom vision" lub wgranie zdjęcia → po wejściu w etap `processing`/`matching`
  pojawia się modal z opisem kroku i paskiem postępu; header/nawigacja są za overlayem.
- Kliknięcie „Szukaj" (rematch) lub „Ponów analizę" (refine) → natychmiast pojawia się modal.
- Po zakończeniu operacji (sukces lub błąd) modal znika samoczynnie; błędy obsługuje
  istniejący inline UI.
- Weryfikacja: `data-testid="progress-modal"` widoczny podczas operacji, niewidoczny po.

### Kluczowe odkrycia

- `PhotoUploader.tsx:413` — `isProcessing = ['uploading','recording','processing','matching'].includes(stage)` — modal potrzebny tylko dla `processing` + `matching`
- `DetectionReview.tsx:665` — `handleRematch`, `DetectionReview.tsx:710` — `handleRefine`; oba setują `busy=true`
- `useBodyScrollLock` — `src/components/useBodyScrollLock.ts` — gotowy hook do reużycia
- `stageLabel` w `PhotoUploader.tsx:415–424` — gotowe etykiety etapów do przekazania do modalu

## Czego NIE robimy

- Nie pokazujemy modalu dla `uploading`/`recording` (szybkie operacje <2s)
- Nie dodajemy procentowego paska postępu (API nie zwraca % ukończenia — streaming poza scope)
- Nie integrujemy z `PhotoListIsland` (row-level operations — follow-up slice)
- Nie piszemy error state w ProgressModal — błędy obsługuje istniejący inline UI
- Nie dorzucamy animowanego paska z customowymi keyframe'ami — `animate-pulse` z Tailwind wystarczy

## Podejście do implementacji

Nowy `ProgressModal` jako prosty komponent sterowany przez `open` i `label` — brak
wbudowanej logiki zamykania. Rodzic kontrolluje cykl życia przez `open={stage === 'processing' || stage === 'matching'}` / `open={busyLabel !== null}`. Komponent jest pasywny.

W `DetectionReview` zamiast rozszerzać `busy` (który obsługuje confirm/reject), dodajemy
`busyLabel: string | null` — null = brak modalu, string = pokaż modal z tym opisem. Tylko
`handleRematch` i `handleRefine` setują `busyLabel`, pozostałe akcje go nie dotykają.

## Krytyczne szczegóły implementacji

**ProgressModal musi dezaktywować Escape i backdrop-click gdy `open=true`.** Istniejące
modale ZAWSZE umożliwiają zamknięcie przez Escape — dla `ProgressModal` to odwrotność wzorca.
`useBodyScrollLock` wywołujemy z `open`, ale `useEffect` na Escape key można pominąć (lub
dodać listener który `.preventDefault()` bez zamykania). Sprawdź czy `useBodyScrollLock`
nie add'uje sam w sobie klawisza zamknięcia — z kodu hooków nie robi tego.

**Addytywne renderowanie w PhotoUploader.** Modal jest renderowany POZA istniejącym JSX
progress-area (nie zamiast niego). Istniejący `progress-area` na linii ~578 pozostaje
niezmieniony i jest widoczny za overlayem modalu. To celowe — nie łamiemy istniejących
testów E2E.

---

## Faza 1: Komponent ProgressModal

### Przegląd

Reużywalny, blokujący komponent overlay — nowy shared building block dla wszystkich
długich operacji.

### Wymagane zmiany

#### 1. Nowy komponent

**Plik**: `src/components/ProgressModal.tsx`

**Cel**: Wyświetla blokujący overlay z opisem kroku (`label`) i indeterminate paskiem postępu.
Nie może być zamknięty przez użytkownika gdy `open=true`.

**Kontrakt**:
```ts
interface ProgressModalProps {
  open: boolean;
  label: string;  // aktualny opis kroku, np. "Analiza vision (może zająć ~10s)..."
}
```

Wzorzec struktury (naśladuj istniejące modale, np. `ConfirmDialog.tsx`):
- `if (!open) return null`
- `useBodyScrollLock(open)`
- `fixed inset-0 z-50 flex items-center justify-center bg-black/60` — brak `onClick={onClose}` na backdropie
- Content: `rounded-xl bg-white dark:bg-gray-800 shadow-xl p-8 max-w-sm w-full mx-4 flex flex-col gap-4`
- `role="dialog"`, `aria-modal="true"`, `aria-label="Przetwarzanie..."`, `data-testid="progress-modal"`
- Spinner (`animate-spin`) + `<p data-testid="progress-modal-label">{label}</p>` + indeterminate bar (`animate-pulse`)
- Brak escape key listener (lub listener który nic nie robi) — odwrotność wzorca innych modali

**Indeterminate bar** (Tailwind built-in, bez custom keyframes):
```html
<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
  <div class="bg-blue-500 h-1.5 rounded-full animate-pulse w-full" />
</div>
```

### Kryteria sukcesu

#### Weryfikacja automatyczna

- TypeScript: `npm run typecheck` zielony
- Lint: `npm run lint` zielony

#### Weryfikacja ręczna

- Komponent izolowany: `<ProgressModal open={true} label="Test label" />` — modal widoczny, brak możliwości zamknięcia
- `<ProgressModal open={false} label="" />` — renderuje null

---

## Faza 2: Integracja z PhotoUploader

### Przegląd

Dodajemy `ProgressModal` do `PhotoUploader.tsx` blokujący nawigację podczas etapów
`processing` i `matching`. Istniejący `progress-area` pozostaje bez zmian.

### Wymagane zmiany

#### 1. Import i render w PhotoUploader

**Plik**: `src/components/PhotoUploader.tsx`

**Cel**: Dodać `<ProgressModal>` blokujący nawigację podczas etapów vision i matching.
Nie usuwać istniejącego `progress-area` (addytywne).

**Kontrakt**:
```tsx
// Dodać import
import ProgressModal from './ProgressModal';

// Dodać w JSX return, po istniejącym znaczniku głównym
<ProgressModal
  open={stage === 'processing' || stage === 'matching'}
  label={stageLabel[stage] ?? ''}
/>
```

`stageLabel` już istnieje w pliku (linia 415–424) — reużywamy bez zmian.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- TypeScript: `npm run typecheck` zielony
- Lint: `npm run lint` zielony
- Unit: `npm run test` zielony (brak unit testów dla PhotoUploader — nie ma regresji)
- E2E (pełne): `npm run test:e2e` zielony — szczególnie `upload-flow.spec.ts`,
  `camera-capture.spec.ts`, `photo-dedup.spec.ts` nie mogą regresować

#### Weryfikacja ręczna

- Po wgraniu zdjęcia i przejściu do etapu `processing`: modal widoczny z etykietą
  „Analiza vision (może zająć ~10s)..."
- Podczas etapu `matching`: modal widoczny z etykietą „Dopasowywanie do baz książek..."
- Po zakończeniu (redirect do `/photos/{id}`): modal zamknięty przed/podczas redirect
- Etapy `uploading`/`recording`: modal NIE jest widoczny, tylko inline progress-area

---

## Faza 3: Integracja z DetectionReview

### Przegląd

Dodajemy `busyLabel: string | null` do hooka `useDetectionDecision` w `DetectionReview.tsx`,
setowanego tylko przez `handleRematch` i `handleRefine`. `ProgressModal` renderowany
jest na poziomie komponentu z `open={busyLabel !== null}`.

### Wymagane zmiany

#### 1. Rozszerzenie hooka useDetectionDecision

**Plik**: `src/components/DetectionReview.tsx` (linie 537–785)

**Cel**: Dodać `busyLabel` do hooka, który oznacza wyłącznie wolne operacje (rematch, refine),
bez wpływu na istniejący `busy` sterujący disabled-stanem przycisków.

**Kontrakt** — rozszerzenie hook return:
```ts
// Dodać do useState w hooku
const [busyLabel, setBusyLabel] = useState<string | null>(null);

// W handleRematch (linia ~665): przed setBusy(true)
setBusyLabel('Szukam kandydatów w bazach książek...');
// W finally: setBusyLabel(null)

// W handleRefine (linia ~710): przed setBusy(true)
setBusyLabel('Analiza vision (ponowne skanowanie grzbietu)...');
// W finally: setBusyLabel(null)

// Hook zwraca busyLabel obok busy
return { ..., busy, busyLabel, ... };
```

#### 2. Render ProgressModal w DetectionReview

**Plik**: `src/components/DetectionReview.tsx` (komponent główny, poza hookiem)

**Cel**: Renderować `ProgressModal` sterowany przez `busyLabel` z hooka.

**Kontrakt**:
```tsx
// Import (jeśli nie ma)
import ProgressModal from './ProgressModal';

// W JSX komponentu nadrzędnego opartego na useDetectionDecision
const { busyLabel, ...rest } = useDetectionDecision(...);

// W return JSX:
<ProgressModal open={busyLabel !== null} label={busyLabel ?? ''} />
```

Upewnić się, że `ProgressModal` jest renderowany na poziomie komponentu z dostępem do
`busyLabel`, nie wewnątrz mapy po detekcjach (modal jest globalny dla całego review).

### Kryteria sukcesu

#### Weryfikacja automatyczna

- TypeScript: `npm run typecheck` zielony
- Lint: `npm run lint` zielony
- E2E: `npm run test:e2e` zielony — szczególnie `manual-rematch.spec.ts` i
  `force-refine.spec.ts` (lub odpowiedniki) nie mogą regresować

#### Weryfikacja ręczna

- Kliknięcie „Szukaj" w formularzu rematch: modal widoczny z „Szukam kandydatów..."
- Po zakończeniu rematch: modal znika, wyniki kandydatów odświeżone
- Kliknięcie „Ponów analizę" (refine): modal widoczny z „Analiza vision..."
- Przyciski confirm/reject: modal NIE pojawia się (tylko busy na przycisku)
- Na błąd (sieć/API): modal znika, inline errorMsg widoczny (istniejący mechanizm)

---

## Faza 4: Testy E2E

### Przegląd

Nowe testy weryfikujące pojawienie/zamknięcie modalu dla obu flow. Istniejące
testy upload-flow i rematch nie zmieniają się — są addytywne.

### Wymagane zmiany

#### 1. Testy upload flow

**Plik**: `tests/e2e/upload-flow.spec.ts`

**Cel**: Dodać asercję że `progress-modal` jest widoczny podczas etapów `processing`/`matching`
i niewidoczny po zakończeniu. Mock'owanie przez istniejący `page.route` wzorzec — bez realnego
vision API.

**Kontrakt** (nowe testy do dołożenia):
```ts
// Test: modal pojawia się podczas etapu processing
// - page.route('/api/photos/*/process', route => /* slow mock */)
// - po upload: await expect(page.getByTestId('progress-modal')).toBeVisible()
// - po zakończeniu: await expect(page.getByTestId('progress-modal')).not.toBeVisible()

// Test: label w modalu odpowiada etapowi
// - await expect(page.getByTestId('progress-modal-label')).toContainText('Analiza vision')
```

#### 2. Testy rematch flow

**Plik**: `tests/e2e/manual-rematch.spec.ts`

**Cel**: Dodać asercję że `progress-modal` jest widoczny podczas szukania kandydatów.

**Kontrakt** (nowe testy do dołożenia):
```ts
// Test: modal pojawia się po kliknięciu Szukaj
// - page.route('/api/detections/*/rematch', route => /* mock */)
// - klik Szukaj: await expect(page.getByTestId('progress-modal')).toBeVisible()
// - po zakończeniu: await expect(page.getByTestId('progress-modal')).not.toBeVisible()
```

Stosować wzorzec: `page.route` mock + `waitForResponse` przed asercją visibility.
Reużyć istniejące `storageState` i fixtures z tych spec'ów.

### Kryteria sukcesu

#### Weryfikacja automatyczna

- E2E: `npm run test:e2e` zielony — wszystkie 4 nowe testy zielone
- Istniejące testy: `upload-flow.spec.ts`, `camera-capture.spec.ts`, `photo-dedup.spec.ts`,
  `manual-rematch.spec.ts` bez regresji

#### Weryfikacja ręczna

- Dev server na :4321: upload flow pokazuje modal blokujący nawigację header
- Link w headerze podczas processing: kliknięcie nie powoduje nawigacji (modal blokuje)
- Rematch: modal widoczny, brak możliwości zamknięcia przez Escape/click

---

## Strategia testowania

### Testy jednostkowe

Brak — `ProgressModal` nie ma logiki biznesowej. Coverage przez E2E.

### Testy E2E

- `upload-flow.spec.ts` — modal appearance/disappearance podczas processing + matching
- `manual-rematch.spec.ts` — modal podczas rematch search

### Kroki testowania ręcznego

1. Wgraj zdjęcie w upload flow → zweryfikuj modal z etykietą vision pojawia się, blokuje header
2. Podczas modalu kliknij link „Półki" lub „Biblioteka" → nawigacja NIE następuje
3. Po redirect do `/photos/{id}`: modal niewidoczny
4. Na stronie detections: kliknij „Szukaj" (rematch) → modal widoczny z „Szukam kandydatów..."
5. Po zakończeniu rematch: modal znika, lista kandydatów zaktualizowana
6. Kliknij confirm/reject: brak modalu (tylko disabled przyciski)

## Referencje

- Wzorzec modalny: `src/components/ConfirmDialog.tsx` (najprostszy modal w projekcie)
- Scroll lock hook: `src/components/useBodyScrollLock.ts`
- Stage labels: `src/components/PhotoUploader.tsx:415–424`
- Istniejący progress-area: `src/components/PhotoUploader.tsx:578–595`
- Hook z busy: `src/components/DetectionReview.tsx:537–785`

## Postęp

> Konwencja: `- [ ]` oczekujące, `- [x]` wykonane. Dołącz ` — <commit sha>` po zakończeniu kroku.

### Faza 1: Komponent ProgressModal

#### Automatyczne

- [x] 1.1 `npm run typecheck` zielony po dodaniu `ProgressModal.tsx` — d7a0430
- [x] 1.2 `npm run lint` zielony — d7a0430

#### Ręczne

- [x] 1.3 ProgressModal renderuje overlay i blokuje zamknięcie przez Escape/backdrop — d7a0430

### Faza 2: Integracja z PhotoUploader

#### Automatyczne

- [x] 2.1 `npm run typecheck` zielony
- [x] 2.2 `npm run lint` zielony
- [x] 2.3 `npm run test:e2e` zielony — upload-flow, camera-capture, photo-dedup bez regresji

#### Ręczne

- [x] 2.4 Modal widoczny podczas processing/matching, niewidoczny podczas uploading/recording
- [x] 2.5 Kliknięcie linku nawigacyjnego podczas modalu nie powoduje nawigacji

### Faza 3: Integracja z DetectionReview

#### Automatyczne

- [x] 3.1 `npm run typecheck` zielony — 9c8d7ca
- [x] 3.2 `npm run lint` zielony — 9c8d7ca
- [x] 3.3 `npm run test:e2e` zielony — manual-rematch bez regresji — 9c8d7ca

#### Ręczne

- [x] 3.4 Modal widoczny podczas rematch, niewidoczny po zakończeniu
- [x] 3.5 Modal widoczny podczas refine, niewidoczny po zakończeniu
- [x] 3.6 Confirm/reject nie triggeruje modalu

### Faza 4: Testy E2E

#### Automatyczne

- [x] 4.1 Nowe testy upload-flow (modal visibility) zielone — 9c8d7ca
- [x] 4.2 Nowe testy manual-rematch (modal visibility) zielone — 9c8d7ca
- [x] 4.3 `npm run test:e2e` — pełny suite zielony — 9c8d7ca
