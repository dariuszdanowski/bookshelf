# Interaktywny edytor bbox — Implementation Plan

## Overview

Dodanie trybu interaktywnej edycji ramek detekcji (bbox) bezpośrednio na zdjęciu półki w widoku review (`/photos/[id]`). Użytkownik może rysować nowe ramki, przesuwać/skalować istniejące i usuwać błędne, a następnie zatwierdzić zmiany jednym przyciskiem. Efektem jest pełny zestaw poprawionych bbox-ów, na których można uruchomić istniejący Refine (OCR fragmentu) per detekcja. „Re-analiza vision rozszerzona" (cały kadr z hints) — osobny slice.

## Current State Analysis

- `PhotoDetectionOverlay` (`src/components/PhotoDetectionOverlay.tsx`) — display-only; ma zoom/pan/focus, renderuje numerowane ramki, toggle visibility. **Brak edycji.**
- Bbox w DB: 4 kolumny `numeric(5,4)` nullable w `detections`; zmapowane do `{ x1,y1,x2,y2 } | null` w `DetectionWithCandidatesDTO` (`src/lib/photos/schema.ts:61`).
- **Istniejący Refine** (`POST /api/detections/[id]/refine`): działa bez zmian — po tym sliceu użytkownik może refine'ować też nowo narysowane ramki (gdy bbox jest w DB).
- **Brak endpointów mutujących bbox**: żadnego `PATCH bbox`, żadnego `POST nowa detekcja`.
- `classifyCropQuality` (`src/lib/matching/fallbackPolicy`) — blokuje Refine dla poziomych/cienkich bboxów; będzie reużyta jako badge w edit mode.
- `raw_title text` w `detections` bez `NOT NULL` → nullable; nowa detekcja może mieć pusty tytuł.
- `correction_type: 'reject'` w `corrections` (używany przez `reject.ts:66`) — telemetria dla usuniętych detekcji; reużywamy endpoint as-is.
- `vision_run_id NOT NULL` w `detections` (migracja 0007) — ograniczenie dla nowych detekcji (rozwiązanie: serwer pobiera najnowszy `vision_run_id` z `vision_runs` dla danego foto).
- **Testy**: `tests/unit/components/PhotoDetectionOverlay.test.tsx`, `tests/e2e/overlay-zoom-pan.spec.ts` (251 linii).

## Desired End State

User wchodzi w `/photos/[id]`, klika "Edytuj ramki" → overlay przechodzi w edit mode: resetuje zoom do 1×, pokazuje narzędzia edycji. Może:
- narysować nową ramkę (click+drag na pustym obszarze),
- zmienić rozmiar istniejącej (drag 8 uchwytów) lub przesunąć (drag po wnętrzu markera),
- usunąć ramkę (przycisk × na markerze).

Po kliknięciu "Zastosuj zmiany": batch API call persystuje wszystkie zmiany (PATCH istniejące, POST nowe, POST reject usuniętych). Nowe detekcje pojawiają się w liście review jako `status='pending'`, pusty tytuł — użytkownik może kliknąć Refine na każdej z nich. Anuluj cofa do normalnego widoku bez zmian w DB.

**Weryfikacja**: `npm run typecheck && npm run lint && npm run test && npm run test:e2e` zielone; manualnie (user-only) ramki po Apply persystują po reloadzie; Refine na nowej ramce daje wynik OCR.

### Key Discoveries

- `refine.ts` działa bez zmian — wystarczy że bbox jest w DB przed kliknięciem Refine (`src/pages/api/detections/[id]/refine.ts:125`)
- `reject.ts` działa bez zmian — reużywamy do "usuń ramkę" (correction_type='reject') (`src/pages/api/detections/[id]/reject.ts:66`)
- Zoom reset w edit mode eliminuje problem konwersji pointer-coords z przestrzeni scaled viewport — `src/components/PhotoDetectionOverlay.tsx` (scale state)
- `vision_run_id` lookup: `SELECT id FROM vision_runs WHERE photo_id=$id ORDER BY created_at DESC LIMIT 1` — bez nowej migracji
- `DetectionWithCandidatesDTO` dla nowej detekcji: `candidates: [], duplicate: null` → UI pokazuje "brak matchu, wpisz ręcznie" — poprawny stan przed Refine
- `BboxCoords` type dziś inline (`:61`) — wydzielamy jako nazwany eksport żeby `BboxEditSet` mógł go reużyć

## What We're NOT Doing

- Re-analiza vision rozszerzona (cały kadr z hints do LLM) — osobny slice
- Zoom/pan w trybie edycji (zoom reset na wejście)
- Rotation/skew bboxów — zawsze pełny prostokąt osi-aligned
- Multi-select / kopiowanie bboxów
- Undo/redo (stan edycji to prosty akumulator zmian per session)
- Modyfikacje `reject.ts` / `refine.ts` / `confirm.ts` — reużywamy as-is
- Zmiany pipeline vision/match

## Implementation Approach

Trzy atomowe fazy: **API** (bez UI) → **Overlay edit mode** (bez integracji z Review) → **Review integration + Apply + E2E**. Backend-first: endpointy gotowe zanim UI zacznie ich używać.

## Critical Implementation Details

- **Zoom reset w edit mode**: wejście w edit mode ustawia `scale = 1` i wyłącza scroll-to-zoom. Dzięki temu pointer events w przestrzeni container = znormalizowane coords × wymiary (bez skalowania). Uproszczenie kosztem braku edycji przy dużym zoom w MVP; architektonicznie odwracalne (Phase 2 overlay).
- **vision_run_id dla nowej detekcji**: `POST /api/photos/[id]/detections` query: `SELECT id FROM vision_runs WHERE photo_id = $photo_id ORDER BY created_at DESC LIMIT 1`. Brak wyników → 400 `VALIDATION_ERROR` ("Foto nie zostało przetworzone przez vision"). Semantycznie: user rozszerza istniejącą sesję analizy.
- **Promise.allSettled w Apply**: handler `onApplyEdits` używa `Promise.allSettled` — częściowe niepowodzenie nie cofa reszty; błędy raportowane zbiorczo (liczba nieudanych), sukcesy aplikowane do lokalnego stanu.
- **Zod cross-field validation**: oba nowe endpointy walidują `x1 < x2 && y1 < y2` przez `.refine()`; bbox 0-area odrzucany na etapie walidacji (nie DB).

---

## Phase 1: API — PATCH bbox + POST nowa detekcja

### Overview

Dwa nowe endpointy; zero zmian w istniejących. Testy jednostkowe przed UI.

### Changes Required:

#### 1. Shared types `BboxCoords` + `BboxEditSet`

**File**: `src/lib/photos/schema.ts`

**Intent**: Wydzielić `BboxCoords` jako nazwany eksport (dziś inline w polach DTO) i dodać `BboxEditSet` — kontrakt między overlay a review dla operacji Apply.

**Contract**:
```typescript
export type BboxCoords = { x1: number; y1: number; x2: number; y2: number };

export type BboxEditSet = {
  updated: Array<{ detectionId: string; bbox: BboxCoords }>;
  removed: Array<{ detectionId: string }>;
  added: Array<{ bbox: BboxCoords }>;
};
```
Pola `DetectionDTO.bbox` i `DetectionWithCandidatesDTO.bbox` zamienić na `BboxCoords | null` (identyczny runtime shape).

#### 2. Endpoint PATCH bbox

**File**: `src/pages/api/detections/[id]/bbox.ts` (nowy)

**Intent**: Zaktualizować współrzędne bbox istniejącej detekcji bez dotykania innych pól (raw_title, status, candidates); zwrócić zaktualizowany id + bbox.

**Contract**: `PATCH` only. `export const prerender = false`. Auth check (401) → `parseUuidParam` (404) → Zod `UpdateBboxSchema`:
```typescript
const UpdateBboxSchema = z.object({
  bbox: z.object({ x1: z.number().min(0).max(1), y1: z.number().min(0).max(1),
                   x2: z.number().min(0).max(1), y2: z.number().min(0).max(1) })
}).refine(d => d.bbox.x1 < d.bbox.x2 && d.bbox.y1 < d.bbox.y2, {
  message: 'x1 < x2 i y1 < y2 wymagane'
});
```
→ `supabase.from('detections').update({ bbox_x1, bbox_y1, bbox_x2, bbox_y2 }).eq('id', id).select('id')` (RLS-respecting client); brak rowów → 404. Zwraca `200 { data: { id, bbox } }`. Błędy DB → 500 + console.error.

#### 3. Endpoint POST nowa detekcja

**File**: `src/pages/api/photos/[id]/detections.ts` (nowy)

**Intent**: Stworzyć nową detekcję z bbox narysowaną przez usera; `raw_title=''`, `status='pending'`, `vision_run_id` z ostatniego vision run foto.

**Contract**: `POST` only. `export const prerender = false`. Auth check → `parseUuidParam` photo id → verify photo ownership (`maybeSingle`, 404 jeśli nie) → Zod `CreateDetectionSchema` (jak BboxCoordsSchema + cross-field refine) → `SELECT id FROM vision_runs WHERE photo_id=$id ORDER BY created_at DESC LIMIT 1` (brak → 400 VALIDATION_ERROR "Foto nie zostało przetworzone przez vision") → `SELECT COALESCE(MAX(position_index),0)+1 AS next FROM detections WHERE photo_id=$id` → `INSERT INTO detections(photo_id, position_index, raw_title, raw_author, vision_confidence, spine_color, status, bbox_x1, bbox_y1, bbox_x2, bbox_y2, vision_run_id)` → zwraca `200 { data: DetectionWithCandidatesDTO }` z `candidates: [], duplicate: null`.

#### 4. Unit testy — PATCH bbox

**File**: `tests/unit/pages/api/detections/id/bbox.test.ts` (nowy)

**Intent**: Happy path (PATCH updates bbox, zwraca 200 + `{ id, bbox }`) + 404 gdy detekcja nie istnieje + 400 gdy x1 >= x2 + 401 bez auth.

**Contract**: Standard pattern projektu — `makeContext()` / `vi.fn().mockResolvedValue(...)`. Mock `supabase.from('detections').update().eq().select()` → `{ data: [{ id }], error: null }` (happy) i `{ data: [], error: null }` (404).

#### 5. Unit testy — POST detections

**File**: `tests/unit/pages/api/photos/id/detections.test.ts` (nowy)

**Intent**: Happy path (zwraca DetectionWithCandidatesDTO) + 400 gdy brak vision_runs + 400 invalid bbox (x1 >= x2) + 404 gdy foto nie istnieje + 401 bez auth.

**Contract**: Mock `vision_runs` query (happy → `[{ id: 'vr-1' }]`, brak → `[]`). Mock `detections` MAX query. Mock INSERT → nowy detection row.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony — `BboxCoords`, `BboxEditSet` poprawnie eksportowane i użyte
- `npm run lint` zielony
- `npm run test` zielony — nowe testy `bbox.test.ts` + `detections.test.ts` + wszystkie istniejące bez regresji

#### Manual Verification:

- (brak — czysto kontraktowe, pokryte automatami)

**Implementation Note**: Brak manualnej bramki — po zielonych automatach przejdź do Phase 2.

---

## Phase 2: PhotoDetectionOverlay edit mode

### Overview

Overlay zyskuje tryb edycji: rysowanie nowych bbox, resize/move istniejących, usuwanie. Callback `onApplyEdits` komunikuje zmiany do rodzica po kliknięciu "Zastosuj zmiany". Brak zmian w `DetectionReview` w tej fazie.

### Changes Required:

#### 1. Nowe props i wewnętrzny akumulator zmian

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: Rozszerzyć props o kontrolę trybu edycji i callback Apply; dodać wewnętrzny akumulator zmian (nie DB) który zbiera edycje sesji.

**Contract**: Nowe props:
```typescript
isEditing?: boolean;
onEditingChange?: (v: boolean) => void;
onApplyEdits?: (changes: BboxEditSet) => Promise<void>;
```
Wewnętrzny state: `editChanges: { updated: Map<string, BboxCoords>; removed: Set<string>; added: BboxCoords[] }` (resetowany przy `isEditing → false`). `draft: { start: {x,y}|null; current: {x,y}|null } | null`. `resizing: { id: string; handle: ResizeHandle; original: BboxCoords; startNorm: {x,y} } | null`. `moving: { id: string; original: BboxCoords; startNorm: {x,y} } | null`. Typ `ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'`.

#### 2. Edit mode toolbar + zoom reset

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: W edit mode chować toolbar zoom/focus/toggle-bbox; pokazać toolbar edit ("Zastosuj zmiany", "Anuluj"). Przy wejściu w edit mode: `setScale(1)`, blokada scroll-to-zoom i scroll-to-zoom-out.

**Contract**: `data-testid="edit-bboxes-button"` — trigger wejścia w edit mode (wołaj `onEditingChange(true)`). `data-testid="apply-bbox-edits-button"` i `data-testid="cancel-bbox-edits-button"` widoczne gdy `isEditing`. Przy `isEditing`: scroll handler na viewport zwraca early bez zmiany scale. Przycisk Apply ustawia `applyBusy=true`, woła `await onApplyEdits(changes)`, wychodzi z edit mode.

#### 3. Renderowanie markerów w edit mode

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: Markery w edit mode pokazują 8 uchwytów resize, przycisk ×, i opcjonalnie badge jakości bbox.

**Contract**: Na każdym markerze z bbox gdy `isEditing`: 8 `<div>` uchwytów z `data-testid="bbox-handle-{position_index}-{dir}"` i `onPointerDown={(e) => { e.stopPropagation(); startResize(id, dir, e); }}`. Przycisk `data-testid="bbox-delete-{position_index}"` → klik dodaje id do `editChanges.removed`, usuwa z widoku lokalnie. Drag po wnętrzu markera (nie uchwyt) → `startMove`. Opcjonalny badge (z `classifyCropQuality`) gdy bbox horizontal/thin — importuje `NormalizedBbox` z `src/lib/matching/fallbackPolicy`.

#### 4. Drag-to-draw nowego bbox

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: Drag po pustym obszarze viewport (nie na markerze) tworzy nowy bbox; wizualny podgląd podczas drag; po `pointerup` dodać do `editChanges.added` jeśli rozmiar > minimum.

**Contract**: `onPointerDown` na viewport-container (gdy `isEditing` i `e.target === containerEl || e.target === imgEl`): `setDraft({ start: norm(e), current: norm(e) })`, `containerEl.setPointerCapture(e.pointerId)`. `onPointerMove`: `setDraft(prev => ({ ...prev!, current: norm(e) }))`. `onPointerUp`: jeśli `Math.abs(x2-x1) > 0.01 && Math.abs(y2-y1) > 0.01` → `editChanges.added.push({ x1, y1, x2, y2 })` (z normalizacją żeby x1<x2, y1<y2). `data-testid="bbox-draft"` na prostokącie draft (dashed outline, `pointer-events-none`). Coords: `x = e.offsetX / containerRef.current.clientWidth`, `y = e.offsetY / containerRef.current.clientHeight`.

#### 5. Resize i move istniejącego bbox

**File**: `src/components/PhotoDetectionOverlay.tsx`

**Intent**: Drag uchwytu zmienia odpowiednią parę coords wg `ResizeHandle`; drag wnętrza markera przesuwa cały bbox.

**Contract**: `startResize(id, handle, e)`: zapisuje `resizing` state z `original` i `startNorm`. Na `pointermove` (gdy `resizing`): oblicza delta, aplikuje wg mapy handle→fields (np. `nw` modyfikuje `x1,y1`; `e` modyfikuje tylko `x2`). Clamp do `[0,1]`, wymusza min `0.01` na wymiarach. Wynik → `editChanges.updated.set(id, newBbox)`. `startMove(id, e)`: jak resize ale delta dodawana do wszystkich 4 coords.

#### 6. Unit testy edit mode

**File**: `tests/unit/components/PhotoDetectionOverlay.test.tsx` (rozszerzenie)

**Intent**: Pokryć: `edit-bboxes-button` click → `apply-bbox-edits-button` visible; `bbox-delete-1` click → marker-1 znika; Apply woła `onApplyEdits` z poprawnym `BboxEditSet`; `cancel-bbox-edits-button` → callback nie wywoływany; `bbox-draft` visible podczas draw.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony
- `npm run lint` zielony
- `npm run test` zielony — nowe testy edit mode + istniejące testy overlay i DetectionReview bez regresji

#### Manual Verification:

- W edit mode toolbar zmienia się; zoom resetuje do 1×; scroll nie zmienia zoom.
- Rysowanie nowego bbox: draft widoczny podczas drag; po pointerup nowy marker pojawia się na overlay.
- Resize: drag uchwytu zmienia rozmiar ramki; drag wnętrza przesuwa; efekt widoczny inline.
- × usuwa marker lokalnie.
- Anuluj przywraca stan początkowy bez żadnych zmian.

**Implementation Note**: Pauza po zielonych automatach na manualny test (user-only) przed Phase 3.

---

## Phase 3: DetectionReview integration + Apply + E2E

### Overview

`DetectionReview` obsługuje callback `onApplyEdits`: batch API calls z `Promise.allSettled`, update lokalnego `detections` state. Nowe detekcje pojawiają się w liście. E2E pokrywa pełny flow.

### Changes Required:

#### 1. State i handler w DetectionReview

**File**: `src/components/DetectionReview.tsx`

**Intent**: Zarządzać flagą `isBboxEditing` (blokuje bulk-confirm / re-run gdy overlay w edit mode) i obsłużyć `onApplyEdits` przez batch API calls.

**Contract**: Nowe state: `isBboxEditing: boolean` + `applyingEdits: boolean`. Handler `handleApplyEdits(changes: BboxEditSet): Promise<void>`:
```
setApplyingEdits(true)
results = await Promise.allSettled([
  ...changes.updated.map(({detectionId, bbox}) =>
    fetch(`/api/detections/${detectionId}/bbox`, { method: 'PATCH', body: JSON.stringify({ bbox }) })),
  ...changes.removed.map(({detectionId}) =>
    fetch(`/api/detections/${detectionId}/reject`, { method: 'POST' })),
  ...changes.added.map(({bbox}) =>
    fetch(`/api/photos/${photoId}/detections`, { method: 'POST', body: JSON.stringify({ bbox }) })),
])
// Apply successful changes to local state:
setDetections(prev => { /* updated + filtered removed + added */ })
// Report errors if any rejected
setApplyingEdits(false)
```
Gdy `isBboxEditing || applyingEdits`: `disabled` na `bulk-confirm-button`, re-run buttons.

#### 2. Wpięcie do PhotoDetectionOverlay

**File**: `src/components/DetectionReview.tsx`

**Intent**: Przekazać `isEditing`, `onEditingChange`, `onApplyEdits` do overlay — Review staje się source of truth dla `isBboxEditing`.

**Contract**: W wywołaniu `<PhotoDetectionOverlay ...>` (linia ~1343) dodać:
```tsx
isEditing={isBboxEditing}
onEditingChange={setIsBboxEditing}
onApplyEdits={handleApplyEdits}
```

#### 3. E2E test: bbox editor flow

**File**: `tests/e2e/bbox-editor.spec.ts` (nowy)

**Intent**: Pokryć: wejście w edit mode, usunięcie bbox → po Apply detekcja znika; rysowanie nowego bbox → po Apply nowa karta w liście; Anuluj → brak zmian. Nigdy realny LLM.

**Contract**: `page.route`:
- `**/api/photos/*/detections` (POST → `200 { data: DetectionWithCandidatesDTO }` z `position_index: 4`)
- `**/api/detections/*/bbox` (PATCH → `200 { data: { id, bbox } }`)
- `**/api/detections/*/reject` (POST → `200 { data: { rejected: true } }`)
- `**/api/photos/*` (GET → mock z `photo_url` + 3 detekcje z bbox)

Scenariusze:
1. `page.getByTestId('edit-bboxes-button').click()` → `apply-bbox-edits-button` visible
2. `page.getByTestId('bbox-delete-1').click()` → marker-1 hidden → `apply-bbox-edits-button` click → mock POST reject wywołany, `detection-card-1` (lub row/tile-1) nie istnieje
3. Mouse drag na empty area overlay → `bbox-draft` visible → Apply → `detection-card-4` (nowy) visible
4. `cancel-bbox-edits-button` → `apply-bbox-edits-button` nie visible, brak mock calls

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` zielony
- `npm run lint` zielony
- `npm run test` zielony — istniejące + rozszerzone testy DetectionReview (isBboxEditing, handleApplyEdits)
- `npm run test:e2e` zielony — istniejące + nowy `bbox-editor.spec.ts`

#### Manual Verification:

- Nowo narysowana ramka persystuje po reloadzie (bbox widoczny po ponownym wejściu w `/photos/[id]`).
- Na nowej ramce: kliknięcie Refine daje wynik OCR z fragmentu zdjęcia.
- Przesunięta/resize'owana ramka widoczna w nowym położeniu po reloadzie.
- Bulk-confirm i re-run buttons disabled podczas edycji; wracają po Apply/Anuluj.
- Brak regresji: accept/reject/correct/bulk-confirm/3 tryby widoku działają jak dotąd.

**Implementation Note**: Pauza po zielonych automatach na manualny test (user-only) przed `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests

- `bbox.test.ts` (nowy): happy path + 401 + 404 + 400 invalid bbox
- `detections.test.ts` (nowy): happy path + brak vision_runs + invalid bbox + 404 + 401
- `PhotoDetectionOverlay.test.tsx` (rozszerzenie): edit mode toggle, delete, Apply callback, cancel, draft rendering
- `DetectionReview.test.tsx` (rozszerzenie): `isBboxEditing` → bulk-confirm disabled; `handleApplyEdits` → `setDetections` poprawnie per operation type

### Integration Tests

Brak — endpointy pokryte unit testami z mocked Supabase (standard projektu).

### Manual Testing Steps (user-only)

1. Wejdź w review przetworzonego zdjęcia → kliknij "Edytuj ramki" → toolbar zmienia się, zoom resetuje do 1×.
2. Narysuj nową ramkę → Apply → nowa karta "brak matchu, wpisz ręcznie" pojawia się w liście.
3. Kliknij Refine na nowej karcie → wynik OCR widoczny (raw_title zaktualizowany).
4. Drag uchwytu istniejącej ramki → resize → Apply → bbox zaktualizowany po reloadzie.
5. × na istniejącej ramce → Apply → detekcja usunięta z listy.
6. Anuluj → żadnych zmian w UI ani DB (weryfikacja: reload + żaden API call nie poszedł).
7. Brak regresji: Akceptuj/Odrzuć/Popraw w kartach, liście i kafelkach działają.

## Performance Considerations

Batch `Promise.allSettled` — N parallel calls (N = liczba zmian; typowo < 5 per session). Zoom reset nie wpływa na performance. Brak dodatkowych DB queries ponad minimum.

## Migration Notes

Brak nowej migracji: `bbox_x1..y2` nullable od migracji 0006; `raw_title text` nullable w schemacie; `vision_run_id NOT NULL` obsłużone przez lookup w nowym endpoint. Zalecana weryfikacja przed implementacją: `npx supabase db reset` lokalnie (lub `\d detections` przez psql) — potwierdzenie nullable raw_title i vision_run_id FK.

## References

- Poprzedni slice (bbox display): `context/archive/2026-05-30-photo-detection-overlay/plan.md`
- Detection list views (DetectionReview architektura): `context/archive/2026-05-31-detection-list-views/plan.md`
- Overlay komponent: `src/components/PhotoDetectionOverlay.tsx`
- Review komponent: `src/components/DetectionReview.tsx:1343` (overlay render), `:1144` (detections state)
- Typy detekcji: `src/lib/photos/schema.ts:54`
- classifyCropQuality: `src/lib/matching/fallbackPolicy.ts` (importowany w refine.ts)
- Reject endpoint (reużywany): `src/pages/api/detections/[id]/reject.ts:66`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API — PATCH bbox + POST nowa detekcja

#### Automated

- [x] 1.1 `npm run typecheck` zielony — BboxCoords, BboxEditSet eksportowane — cde0a10
- [x] 1.2 `npm run lint` zielony — cde0a10
- [x] 1.3 `npm run test` zielony — nowe bbox.test.ts + detections.test.ts + istniejące bez regresji — cde0a10

### Phase 2: PhotoDetectionOverlay edit mode

#### Automated

- [x] 2.1 `npm run typecheck` zielony — 1af85dc
- [x] 2.2 `npm run lint` zielony — 1af85dc
- [x] 2.3 `npm run test` zielony — nowe testy edit mode + istniejące bez regresji — 1af85dc

#### Manual

- [ ] 2.4 Edit mode toggle zmienia toolbar; zoom reset do 1× przy wejściu
- [ ] 2.5 Rysowanie nowego bbox: draft widoczny; marker pojawia się po pointerup
- [ ] 2.6 Resize i move: efekt widoczny inline; × usuwa marker lokalnie
- [ ] 2.7 Anuluj przywraca stan bez zmian

### Phase 3: DetectionReview integration + Apply + E2E

#### Automated

- [x] 3.1 `npm run typecheck` zielony — 1af85dc
- [x] 3.2 `npm run lint` zielony — 1af85dc
- [x] 3.3 `npm run test` zielony — istniejące + rozszerzone DetectionReview tests — 1af85dc
- [x] 3.4 `npm run test:e2e` zielony — istniejące + nowy bbox-editor.spec.ts — 1af85dc

#### Manual

- [ ] 3.5 Nowa ramka persystuje po reloadzie; Refine na niej daje wynik OCR
- [ ] 3.6 Resize/move persystuje po reloadzie
- [ ] 3.7 Usunięta ramka nie pojawia się po reloadzie
- [ ] 3.8 Bulk-confirm i re-run disabled podczas edycji; wracają po Apply/Anuluj
- [ ] 3.9 Brak regresji: accept/reject/correct/bulk/3 tryby widoku
