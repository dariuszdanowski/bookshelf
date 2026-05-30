# Pełne zdjęcie z numerowanymi ramkami detekcji w review — Implementation Plan

## Overview

W widoku review (`/photos/[id]`) użytkownik ma zobaczyć **pełne zdjęcie półki** z nałożonymi **numerowanymi ramkami (bbox)** wykrytych książek, skorelowanymi z numerowaną listą detekcji poniżej (numer ramki = `position_index` = `#N` na karcie). Dziś zdjęcie nie trafia do UI wcale, a bboxy są persistowane i serializowane do DTO, ale nie renderowane.

## Current State Analysis

- **Substrat gotowy (S-04)**: `detections.bbox_x1..y2` (`numeric(5,4)`, nullable) — migracja `supabase/migrations/0006_detection_bbox.sql`. `GET /api/photos/[id]` już mapuje je do `DetectionWithCandidatesDTO.bbox` (`{x1,y1,x2,y2}` lub `null`) — `src/pages/api/photos/[id].ts:213`.
- **Semantyka bbox potwierdzona**: `[x1,y1,x2,y2]` top-left, znormalizowane 0..1 względem working-copy. `deriveWorkingCopy` (`src/lib/images/resize.ts:23`) skaluje uniformnie (`min(1, 1568/max(w,h))`) — **zachowuje proporcje, bez crop/pad**. ⇒ współrzędne 0..1 mapują się identycznie na oryginał; procentowy overlay poprawny w dowolnej skali wyświetlania.
- **Pełny obraz**: `photos.storage_path` w buckecie `shelf-photos` trzyma **oryginał pełnej rozdzielczości** (working-copy nie jest zapisywane — `resize.ts:9`). Brak kolumny `original_path`. `process.ts:91` pobiera oryginał przez `.download(photo.storage_path)`.
- **GET endpoint dziś NIE zwraca żadnego URL zdjęcia** — `select(...)` w `[id].ts:40` nie pobiera nawet `storage_path`. Thumbnaile na liście półek generowane są osobno przez `createSignedUrls` w `src/pages/api/shelves/[id]/photos.ts`.
- **Review UI**: `src/components/DetectionReview.tsx` fetchuje `GET /api/photos/[id]`, trzyma `photo`/`detections`/`visionRun` w stanie i renderuje listę `DetectionCard` z nagłówkiem `#{detection.position_index}` (`:305`). Pole `bbox` w DTO jest fetchowane, ale **nieużywane**.
- **Testy**: `tests/unit/pages/api/photos/id.test.ts` mockuje `locals.supabase.from` (bez `storage`). `tests/unit/components/DetectionReview.test.tsx` istnieje. E2E review: `tests/e2e/proposal-accept-to-catalog.spec.ts` + `tests/e2e/shelf-photo-pipeline-ui.spec.ts` (mock przez `page.route`).

## Desired End State

Wchodząc w review przetworzonego zdjęcia, użytkownik widzi na górze pełne zdjęcie z prostokątnymi ramkami wokół wykrytych grzbietów; każda ramka ma badge z numerem zgodnym z `#N` na karcie detekcji poniżej. Detekcje bez bbox są na liście, ale bez ramki. Gdy zdjęcie się nie załaduje (brak signed URL), review działa jak dziś (same karty), bez błędu.

**Weryfikacja**: `npm run typecheck` + `npm run lint` + `npm run test` zielone; nowy unit test overlay i zaktualizowany test endpointu przechodzą; E2E review zielone; manualnie (user-only) ramki pokrywają się z realnymi grzbietami na prawdziwym zdjęciu.

### Key Discoveries:

- bbox normalizacja zachowuje proporcje oryginału — `src/lib/images/resize.ts:23` (uniform scale) → overlay procentowy bez korekty aspect-ratio.
- Pełny obraz = signed URL `storage_path` — `src/pages/api/photos/[id]/process.ts:91`.
- Karty review już numerują przez `position_index` — `src/components/DetectionReview.tsx:305`.
- DTO `bbox` już dociera do klienta — `src/pages/api/photos/[id].ts:213`, `src/lib/photos/schema.ts:61`.

## What We're NOT Doing

- Interaktywne podświetlanie marker↔karta (hover/click sync) — nice-to-have, poza zakresem.
- Click-to-crop / re-analiza fragmentu z ramki — parking S-04 (re-analiza fragmentu = przyszłość).
- Edycja / rysowanie / korekta bbox przez użytkownika.
- Zmiany w thumbnailach na liście półek ani w pipeline vision/match.
- Ręczne wyszukiwanie okładek (S-19) i statystyki półki (S-20) — osobne slice'y.
- Nowa migracja DB (bbox już istnieje).

## Implementation Approach

Dwie atomowe fazy: najpierw kontrakt API (dołożenie signed URL pełnego zdjęcia do odpowiedzi `GET /api/photos/[id]`, z testem jednostkowym), potem warstwa UI (izolowany komponent overlay + wpięcie w `DetectionReview`, z testem jednostkowym i E2E). Backend-first, bo UI konsumuje nowe pole.

## Critical Implementation Details

- **bbox origin**: top-left, 0..1, proporcje oryginału zachowane → marker: `left: x1*100%`, `top: y1*100%`, `width: (x2-x1)*100%`, `height: (y2-y1)*100%` w kontenerze `position: relative` owijającym `<img>`. Żadnej korekty aspect-ratio.
- **Signed URL nie może wywrócić odpowiedzi**: błąd generowania URL → zaloguj (`console.error` rich payload) i zwróć `photo_url: null`; review degraduje się do samych kart. Nigdy 500 z powodu storage.
- **`photo_url` jako pole odpowiedzi, nie w `PhotoDTO`**: `PhotoDTO` jest współdzielone (m.in. zwracane przez `process.ts`); dodanie pola tam wymusiłoby populację wszędzie. Dołóż `photo_url` jako rodzeństwo `photo`/`detections`/`vision_run` w `data` (dotyczy wszystkich 3 punktów `return apiResponse` w `[id].ts`).

## Phase 1: API — signed URL pełnego zdjęcia w GET /api/photos/[id]

### Overview

Endpoint zaczyna zwracać `photo_url` (signed URL oryginału ze `storage_path`) obok istniejących pól. Graceful null przy braku/błędzie.

### Changes Required:

#### 1. Endpoint GET photo

**File**: `src/pages/api/photos/[id].ts`

**Intent**: Dołożyć `storage_path` do selecta zdjęcia, wygenerować 1h signed URL z bucketa `shelf-photos`, i zwrócić go jako `photo_url` we wszystkich trzech gałęziach sukcesu. Błąd storage → log + `photo_url: null`, nie 500.

**Contract**: `select('id, shelf_id, storage_path, status, detected_count, error_message, vision_cost_usd, vision_latency_ms, created_at')`. Po pobraniu photo: `const { data: signed } = await locals.supabase.storage.from('shelf-photos').createSignedUrl(data.storage_path, 3600)` opakowane tak, by błąd nie przerywał (try/catch lub sprawdzenie `error`). Każdy `return apiResponse({ data: { photo, photo_url, detections, vision_run } })` zyskuje `photo_url`. `storage_path` NIE wchodzi do `PhotoDTO` (pozostaje wewnętrzny).

#### 2. Typ odpowiedzi w kliencie

**File**: `src/components/DetectionReview.tsx`

**Intent**: Rozszerzyć lokalny typ `ApiResponse.data` o `photo_url`, by Phase 2 mogła go skonsumować bez błędu typów.

**Contract**: `ApiResponse.data` (`:510`) dostaje `photo_url?: string | null`. (Wpięcie renderu w Phase 2.)

#### 3. Test jednostkowy endpointu

**File**: `tests/unit/pages/api/photos/id.test.ts`

**Intent**: Rozszerzyć mock kontekstu o `locals.supabase.storage.from().createSignedUrl()` i dodać asercje, że `photo_url` jest zwracany (happy path) oraz `null` gdy storage zwróci błąd; istniejące testy mają dalej przechodzić.

**Contract**: `makeContext`/`makeSupabase` dostają mock `storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: '...' }, error: null }) }) }`. Selekt photo musi też zawierać `storage_path` w danych mocka. Nowe `it(...)`: `photo_url` obecny + wariant błędu storage → `photo_url: null`, status 200.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit testy zielone: `npm run test`
- `GET /api/photos/[id]` zwraca `photo_url` (string) w happy path i `null` przy błędzie storage (nowe asercje w `id.test.ts`)

#### Manual Verification:

- (brak — czysto kontraktowe, pokryte automatami)

**Implementation Note**: Po zielonych automatach przejdź do Phase 2 (brak manualnej bramki dla tej fazy).

---

## Phase 2: UI — komponent overlay + wpięcie w review

### Overview

Nowy komponent renderuje pełne zdjęcie z numerowanymi ramkami; wpięty na górze `DetectionReview`, nad listą kart. Numeracja spięta z `position_index`.

### Changes Required:

#### 1. Komponent overlay

**File**: `src/components/PhotoDetectionOverlay.tsx` (nowy)

**Intent**: Renderować pełne zdjęcie i nałożyć absolutnie pozycjonowane ramki (% z bbox) z badge'em numeru dla każdej detekcji mającej `bbox`. Gdy `photoUrl` jest `null` → nie renderować nic. Detekcje bez bbox pomijane (brak markera).

**Contract**: `export default function PhotoDetectionOverlay({ photoUrl, detections }: { photoUrl: string | null; detections: DetectionWithCandidatesDTO[] })`. Kontener `relative` **`overflow-hidden`** z `<img src={photoUrl} alt="Zdjęcie półki z wykrytymi książkami">`; per detekcja z `bbox`: `<div>` z inline style `{ left: ${x1*100}%, top: ${y1*100}%, width: ${(x2-x1)*100}%, height: ${(y2-y1)*100}% }` + badge `#{position_index}`. `data-testid="photo-overlay"` na kontenerze, `data-testid={`bbox-marker-${position_index}`}` na ramce.

**Robustness (z plan-review F1/F2)**:
- **F1 — clamp bbox**: składowe clampuj do `[0,1]` i licz `w=max(0, clamp(x2)-clamp(x1))`, `h=max(0, clamp(y2)-clamp(y1))` zanim trafią do `%` — bbox jest best-effort z vision (brak CHECK na zakres w 0006); `overflow-hidden` na kontenerze jako druga linia obrony przy przelaniu.
- **F2 — img load guard**: stan `imgLoaded`/`imgError`; renderuj markery dopiero po `onLoad` obrazu, chowaj overlay przy `onError` (złamany/wygasły signed URL nie zostawia ramek nad pustką).

#### 2. Wpięcie w review + stan photoUrl

**File**: `src/components/DetectionReview.tsx`

**Intent**: Dodać stan `photoUrl`, ustawiać go z `json.data.photo_url` w fetchu, i renderować `<PhotoDetectionOverlay>` na górze (nad panelem vision-run / nad listą kart). Dodać krótki podpis, że numery ramek odpowiadają pozycjom na liście.

**Contract**: nowy `useState<string | null>(null)` dla `photoUrl`; `setPhotoUrl(json.data.photo_url ?? null)` w `useEffect` fetchu (`:551`). Render `<PhotoDetectionOverlay photoUrl={photoUrl} detections={detections} />` w bloku sukcesu (`:709`), przed/nad `vision-run-panel`. Overlay renderowany tylko gdy są detekcje (komponent sam guarduje `photoUrl === null`).

#### 3. Test jednostkowy overlay

**File**: `tests/unit/components/PhotoDetectionOverlay.test.tsx` (nowy)

**Intent**: Zweryfikować: renderuje `<img>` z `src` gdy `photoUrl` ustawiony; renderuje N markerów dla N detekcji z bbox; 0 markerów gdy wszystkie bbox `null`; nic gdy `photoUrl === null`; numer markera = `position_index`.

**Contract**: render z fixture detekcji (jedna z bbox `{0.1,0.1,0.2,0.9}` pos=1, jedna z bbox `null` pos=2). Asercje: `getByTestId('bbox-marker-1')` istnieje, `queryByTestId('bbox-marker-2')` jest `null`, `<img>` ma `src`. Wariant `photoUrl={null}` → `queryByTestId('photo-overlay')` `null`.

#### 4. E2E review — overlay widoczny

**File**: `tests/e2e/shelf-photo-pipeline-ui.spec.ts` (lub `proposal-accept-to-catalog.spec.ts` — wybrać ten, którego mock `GET /api/photos/[id]` jest najbliżej review)

**Intent**: Rozszerzyć mock `GET /api/photos/[id]` o `photo_url` (data-URL malutkiego obrazka, by uniknąć sieci) i bbox na detekcji; dodać asercję, że `photo-overlay` + `bbox-marker-1` są widoczne. Mock obrazka tak, by nie uderzać do storage.

**Contract**: w `page.route` dla `**/api/photos/*` body `data.photo_url` = `data:image/png;base64,...` (1px) i co najmniej jedna detekcja z `bbox`. Asercja `expect(page.getByTestId('photo-overlay')).toBeVisible()` + `bbox-marker-1`.

### Success Criteria:

#### Automated Verification:

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit testy zielone (w tym nowy `PhotoDetectionOverlay.test.tsx`): `npm run test`
- E2E review zielone (overlay + marker widoczne na mocku): `npm run test:e2e`

#### Manual Verification:

- Na prawdziwym przetworzonym zdjęciu ramki pokrywają się z grzbietami książek (rozsądna tolerancja vision); numery ramek odpowiadają `#N` na kartach.
- Zdjęcie skaluje się responsywnie, ramki trzymają pozycję przy zmianie szerokości okna.
- Detekcja bez bbox pojawia się na liście, ale bez ramki — bez błędu.
- Brak regresji: akceptacja/odrzucenie/korekta i bulk-accept działają jak dotąd.

**Implementation Note**: Po zielonych automatach pauza na manualne potwierdzenie (user-only — przeglądarka, realne zdjęcie) przed `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- `id.test.ts`: `photo_url` present (happy) + null przy błędzie storage; istniejące asercje bez regresji.
- `PhotoDetectionOverlay.test.tsx`: liczba markerów = liczba detekcji z bbox; brak markerów dla bbox null; brak renderu gdy `photoUrl` null; numer = `position_index`.

### Integration Tests:

- Brak nowych (endpoint pokryty unitem z mockiem Supabase + storage, zgodnie z konwencją repo).

### Manual Testing Steps (user-only):

1. Wejdź w review przetworzonego zdjęcia → na górze pełne zdjęcie z ramkami.
2. Porównaj numery ramek z `#N` na kartach poniżej.
3. Zmień szerokość okna → ramki trzymają się grzbietów.
4. Zdjęcie z detekcją bez bbox → brak ramki, ale pozycja na liście jest.

## Performance Considerations

Pełnorozdzielczościowy oryginał ładowany w review — pojedynczy obraz, `loading` natywny; akceptowalne dla desktop-first MVP. Signed URL 1h (spójne z thumbnailami). Brak dodatkowych zapytań DB (bbox już w odpowiedzi).

## Migration Notes

Brak — `bbox` istnieje od migracji 0006; ten slice tylko renderuje istniejące dane.

## References

- Change: `context/changes/photo-detection-overlay/change.md`
- Substrat S-04 (bbox/region): memory `s04-detection-spatial-region-model`; `supabase/migrations/0006_detection_bbox.sql`
- Endpoint: `src/pages/api/photos/[id].ts:213`; resize: `src/lib/images/resize.ts:23`; review: `src/components/DetectionReview.tsx:305`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API — signed URL pełnego zdjęcia w GET /api/photos/[id]

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck` — f8e82f5
- [x] 1.2 Lint: `npm run lint` — f8e82f5
- [x] 1.3 Unit testy zielone: `npm run test` — f8e82f5
- [x] 1.4 `GET /api/photos/[id]` zwraca `photo_url` (happy) i `null` przy błędzie storage (asercje w `id.test.ts`) — f8e82f5

### Phase 2: UI — komponent overlay + wpięcie w review

#### Automated

- [x] 2.1 Typecheck: `npm run typecheck` — 857a12d
- [x] 2.2 Lint: `npm run lint` — 857a12d
- [x] 2.3 Unit testy zielone (w tym `PhotoDetectionOverlay.test.tsx`): `npm run test` — 857a12d
- [x] 2.4 E2E review zielone (overlay + marker widoczne): `npm run test:e2e` — 857a12d

#### Manual

- [ ] 2.5 Ramki pokrywają się z grzbietami na realnym zdjęciu; numery zgodne z kartami (user-only)
- [ ] 2.6 Responsywność: ramki trzymają pozycję przy zmianie szerokości okna (user-only)
- [ ] 2.7 Detekcja bez bbox: na liście bez ramki, bez błędu (user-only)
- [ ] 2.8 Brak regresji accept/reject/correct/bulk (user-only)
