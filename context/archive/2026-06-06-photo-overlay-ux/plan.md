# S-24: Lightbox zdjęcia w review — Implementation Plan

## Overview

Resztkowy zakres S-24 (zob. change.md): lightbox pełnoekranowy po kliknięciu zdjęcia
w `PhotoDetectionOverlay`. Toggle ramek i zoom/pan już istnieją — poza zakresem.

## Current State Analysis

- `PhotoDetectionOverlay` ([src/components/PhotoDetectionOverlay.tsx](src/components/PhotoDetectionOverlay.tsx)):
  viewport z pan-drag (`dragStateRef` — `startX/startY` na pointerdown), zoom kółkiem
  i przyciskami (1–4×), `showBoxes` toggle, tryby edycji (`isEditing`, `singleEditId`).
  Markery w trybie nie-edit mają `pointer-events-none` — klik trafia w `<img>`.
- bboxy znormalizowane 0..1 (`BboxCoords`) — pozycjonowanie procentowe nie wymaga
  pomiaru obrazu.
- Wzorce modali: `ConfirmDialog`, `BookModal` (React, Esc/backdrop close).

## Desired End State

Klik w zdjęcie (nie-edit, nie pan-drag) → modal `fixed inset-0` z obrazem
(`object-contain`, max viewport) + numerowane ramki wszystkich detekcji z bbox
(pozycjonowanie %). Esc / klik tła / ✕ zamyka. Tryby edycji nieaktywne w lightboxie
(read-only podgląd).

## What We're NOT Doing

- Toggle ramek (istnieje), zoom/pan w lightboxie, edycja bbox w lightboxie,
  fokus-sync z lightboxa do listy, zmiany API.

## Implementation Approach

Nowy mały komponent `PhotoLightbox` (render w `PhotoDetectionOverlay`), stan
`lightboxOpen` w overlay. Klik-vs-drag: porównanie współrzędnych click z
`dragStateRef.startX/startY` (próg 5 px).

## Phase 1: PhotoLightbox + trigger + testy

### Changes Required:

#### 1. PhotoLightbox

**File**: `src/components/PhotoLightbox.tsx` (nowy)

**Intent**: pełnoekranowy podgląd zdjęcia z ramkami; samodzielny, prezentacyjny.

**Contract**: props `{ photoUrl: string; detections: DetectionWithCandidatesDTO[]; focusedDetectionId?: string | null; onClose: () => void }`.
Renderuje `fixed inset-0 z-50 bg-black/80`; obraz `max-h/max-w` viewport, wrapper
`relative`; ramki = divy `absolute` z `left/top/width/height` w % bbox + numer
`position_index`; fokusowana ramka wyróżniona. Esc (keydown listener w useEffect),
klik tła i przycisk ✕ wołają `onClose`. `data-testid`: `photo-lightbox`,
`photo-lightbox-close`, `lightbox-marker-{position_index}`.

#### 2. Trigger w PhotoDetectionOverlay

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: klik w obraz otwiera lightbox; pan-drag nie otwiera.

**Contract**: stan `lightboxOpen`; `onClick` na `<img>`: aktywny tylko gdy
`!isEditing && !singleEditId`; odległość `(e.clientX,e.clientY)` od
`dragStateRef.current.startX/startY` < 5 px → `setLightboxOpen(true)`.
`cursor-zoom-in` na obrazie w trybie nie-edit. Render `<PhotoLightbox>` gdy open,
z `visibleDetections` (respektuje fokus S-18/S-37).

#### 3. Testy unit

**File**: `tests/unit/components/PhotoLightbox.test.tsx` (nowy) + rozszerzenie
`PhotoDetectionOverlay.test.tsx`

**Intent**: lightbox renderuje obraz + ramki, zamyka się (Esc/tło/✕); overlay
otwiera lightbox po kliku, nie otwiera w edit mode.

#### 4. E2E

**File**: `tests/e2e/photo-lightbox.spec.ts` (nowy)

**Intent**: golden path — review → klik zdjęcia → lightbox z ramkami → Esc zamyka;
w trybie edycji klik nie otwiera. Mock vision/API przez `page.route`
(wzorce z `book-to-detection-focus.spec.ts` — fixture photo_url = 1px PNG route).

### Success Criteria:

#### Automated Verification:

- Typecheck / Lint / Unit / E2E zielone

#### Manual Verification:

- Lightbox na realnym zdjęciu półki (user-only)

## Testing Strategy

Unit: render + interakcje zamknięcia + guard edit-mode. E2E: golden path + edit-guard.

## References

- Roadmapa S-24 (`context/foundation/roadmap.md:315-325` — nota alignment 2026-06-06)
- Pattern modala: `src/components/ConfirmDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>`.

### Phase 1: PhotoLightbox + trigger + testy

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck` — e12ee94
- [x] 1.2 Lint: `npm run lint` — e12ee94
- [x] 1.3 Unit: `npm run test` — e12ee94 (894/894)
- [x] 1.4 E2E: `npm run test:e2e` — e12ee94 (133 passed; lokalnie :4322, zob. S-37)

#### Manual

- [ ] 1.5 Lightbox na realnym zdjęciu półki (user-only)
