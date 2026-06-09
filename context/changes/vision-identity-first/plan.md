# S-43 Vision Identity-First — Implementation Plan

## Overview

Przeorientowanie pipeline'u vision z „ciasny bbox per książka" na **rozpoznanie jako cel**.
Główny prompt zwraca listę `{position, title, author, confidence, spine_color}` bez
współrzędnych; review-UX oparty o karty „potwierdź" z kandydatami match; bbox-editor
zdegradowany do opcjonalnego narzędzia naprawczego. Bezpośrednia realizacja decyzji
zamykającej S-40 (prompt-bbox zmierzony jako wrodzenie zawodny; identity-only czyta
≥ równie dobrze i jest 30–46% tańszy).

## Current State Analysis

Kod jest już w dużej mierze **identity-tolerant** — pivot nie wymaga przebudowy rdzenia:

- **Match/dedup nie używają pikseli.** `src/pages/api/photos/[id]/match.ts` SELECT-uje
  tylko `id, raw_title, raw_author, status, position_index` (zero bbox); `src/lib/matching/score.ts`
  scoruje wyłącznie na tekście (`0.65·titleSim + 0.30·authorSim + 0.05·isbnBonus`).
- **bbox jest nullable wszędzie.** Schema Zod (`src/lib/vision/schema.ts:6-15`):
  `BboxSchema = z.tuple([...]).nullable().optional().catch(null)`; DB (`0006_detection_bbox.sql`):
  `bbox_x1..y2 numeric(5,4)` wszystkie nullable, brak CHECK/triggera; DTO
  (`src/lib/photos/schema.ts`): `bbox: BboxCoords | null`.
- **UI degraduje się łagodnie przy braku bboxa.** `PhotoDetectionOverlay.tsx` filtruje
  `withBbox = detections.filter(d => d.bbox !== null)` — detekcja bez boxa renderuje się
  jako karta (`DetectionCard`/`Row`/`Tile`), tylko nie ma ramki na overlayu. Brak miejsca,
  gdzie `bbox === null` rzuca błędem.
- **`process.ts` już persystuje null bbox.** `sanitizeBbox()` zwraca null dla niepoprawnych
  boxów; INSERT zapisuje `bbox_x1..y2 = null`; `detected_count = detections.length`.
- **Manualne tworzenie detekcji istnieje**, ale **wymaga bboxa**: `POST /api/photos/[id]/detections`
  (`detections.ts:9-20`) ma `CreateDetectionSchema` z **obowiązkowym** `bbox` i wstawia
  `raw_title: ''` (`:115`). To jedyny twardy wymóg bboxa w kontrakcie API.
- **`orientation` nie jest persystowane w DB** — pole istnieje w schema Zod (`optional`),
  ale `process.ts` go nie zapisuje. Usunięcie z promptu = zero skutków DB.

### Key Discoveries:

- Główny prompt: `src/lib/vision/prompt.ts:23-59` (`VISION_SYSTEM_PROMPT`); blok instrukcji
  bbox to linie 41-57 — to jedyna część do usunięcia. `PROMPT_VERSION = 'v6'` (`:1`).
- `spine_color` jest **load-bearing** (filtr S-08, `z.enum(SPINE_COLORS)`) — zostaje w prompcie.
- `prompt_version` w `vision_runs` to kolumna text → bump v6→v7 bez migracji.
- Mierzony dowód identity-only: `context/archive/2026-06-07-bbox-quality-validation/change.md`
  sekcja „Pivot produktowy (2026-06-09)".

## Desired End State

Po zakończeniu planu:

1. `/api/photos/[id]/process` z domyślnym providerem Anthropic zwraca detekcje
   bez współrzędnych (`bbox_x1..y2 = null`), które matchują i renderują się jako karty.
2. User może **dodać pominiętą książkę wpisem tytułu** (bez rysowania boxa) i otrzymać
   kandydatów match.
3. Karty „potwierdź" są główną i jedyną domyślną ścieżką; widok zdjęcia z bboxami jest
   drugorzędny, a rysowanie/edycja bboxa jest **opcjonalnym narzędziem naprawczym**
   uruchamianym na żądanie (nie sugeruje, że każda książka potrzebuje ramki).
4. Dokumentacja (`src/lib/vision/AGENTS.md`) odzwierciedla identity-first; KPI = title-recall
   + precyzja + czas review.

Weryfikacja: nowy E2E golden-path (mock identity-response bez bbox) przechodzi upload →
process → karty → potwierdź → katalog; „dodaj pominiętą po tytule" działa; rysowanie boxa
jako naprawa nadal działa.

## What We're NOT Doing

- **Brak `kind` / wsparcia gier** — books-only; gry to osobny przyszły slice (decyzja usera).
- **Brak markera/coarse-bbox z modelu** — czysta identyfikacja; kolejność wyłącznie po
  `position_index` (decyzja usera).
- **Brak migracji DB** — żadnych zmian schematu (bbox już nullable, brak nowych kolumn).
- **Brak zmiany ścieżki OpenAI-compatible** poza współdzielonym promptem (ten sam
  `VISION_SYSTEM_PROMPT`; identity-only prompt obowiązuje wszystkie providery).
- **Brak korekty afinicznej X / post-processingu geometrii** (warunkowy, odłożony slice z S-40).
- **Brak usuwania bbox-editora ani kolumn bbox/quad** — pozostają jako narzędzie naprawcze.
- **Brak zmiany progów matchingu** (0.75 / 0.55 zostają).

## Implementation Approach

Trzy atomic fazy, każda z automated-only verification (manual = user-only):

1. **Prompt identity-first** (backend core, mierzony win) — przepisanie promptu bez
   współrzędnych, bump `PROMPT_VERSION`, potwierdzenie że schema/pipeline persystują null
   bbox, aktualizacja AGENTS.md, testy jednostkowe na identity-response.
2. **Manualny wpis tożsamości** — `POST /detections` przyjmuje opcjonalny `title` i czyni
   `bbox` opcjonalnym; UI „dodaj pominiętą książkę" przez wpis tytułu → auto-rematch.
3. **Reframe UI** — karty jako jedyna domyślna ścieżka, widok bbox jako drugorzędne
   narzędzie naprawcze (graceful empty overlay + jawne „Zlokalizuj / narysuj ramkę"),
   reframe copy + nowy E2E golden-path.

## Phase 1: Prompt identity-first

### Overview

Główny prompt przestaje żądać współrzędnych; model zwraca tylko tożsamość + kolejność +
kolor grzbietu. To mierzony rdzeń pivota (taniej, recall ≥ v6).

### Changes Required:

#### 1. Główny system-prompt

**File**: `src/lib/vision/prompt.ts`

**Intent**: Usunąć z `VISION_SYSTEM_PROMPT` cały blok instrukcji bbox (linie 41-57) oraz
pole `bbox` i `orientation` z opisu per-item i z przykładu formatu. Zostają: `position`,
`title`, `author`, `confidence`, `spine_color`. Bump `PROMPT_VERSION` z `'v6'` na `'v7'`.
Reguły odczytu (NIE zgaduj, polskie zostaw po polsku, tylko JSON array) zostają.

**Contract**: `VISION_SYSTEM_PROMPT` per-item format = `{position, title, author, confidence, spine_color}`.
`PROMPT_VERSION === 'v7'`. `SPINE_COLORS` i `REFINE_VISION_SYSTEM_PROMPT` bez zmian
(refine operuje na cropie, ma własny kontrakt). Eksporty i nazwy stałych niezmienione.

#### 2. Schema Zod — potwierdzenie kompatybilności

**File**: `src/lib/vision/schema.ts`

**Intent**: Zweryfikować (bez zmian funkcjonalnych), że identity-response bez `bbox`/`orientation`
parsuje się poprawnie. `bbox` jest już `nullable().optional().catch(null)`, `orientation`
już `optional()` — model nie zwracający tych pól daje `bbox: null`, `orientation: undefined`.
Jeśli potrzeba, dodać komentarz o identity-first; nie zmieniać typów (backward-compat z runami v6).

**Contract**: `DetectionSchema.safeParse([{position,title,author,confidence,spine_color}])`
zwraca `success: true` z `bbox` znormalizowanym do `null`.

#### 3. Dokumentacja vision

**File**: `src/lib/vision/AGENTS.md`

**Intent**: Zaktualizować reguły: główny prompt jest identity-first (nie emituje bbox);
bbox pochodzi wyłącznie z ręcznego rysowania (narzędzie naprawcze); `PROMPT_VERSION` = v7;
KPI = title-recall + precyzja + czas review (nie IoU). Dopisać wskaźnik do decyzji S-40.

**Contract**: Sekcja prompt/wersjonowanie w AGENTS.md spójna z `prompt.ts`.

#### 4. Testy jednostkowe vision client

**File**: `tests/unit/` (istniejący plik testów vision client — wzorzec happy/retry/parse_failure)

**Intent**: Dodać/zaktualizować test: mock SDK zwraca identity-response **bez** `bbox` i
`orientation` → `detectSpines` zwraca `detections` z `bbox === null` (po parse) i poprawnymi
`title/author/confidence/spine_color`. Potwierdzić że istniejące testy (z bbox w odpowiedzi,
backward-compat) nadal przechodzą.

**Contract**: Test asercja: identity-response → `ok: true`, `detections[0].bbox == null`,
`detections[0].title` zachowane.

### Success Criteria:

#### Automated Verification:

- [ ] Unit: vision client parsuje identity-response (bez bbox) → `npm run test`
- [ ] Unit: istniejące testy vision (backward-compat z bbox) nadal zielone → `npm run test`
- [ ] Typecheck przechodzi: `npm run typecheck`
- [ ] Lint przechodzi: `npm run lint`
- [ ] Build przechodzi: `npm run build`
- [ ] `PROMPT_VERSION === 'v7'` w `prompt.ts`; `VISION_SYSTEM_PROMPT` nie zawiera słowa `bbox`

#### Manual Verification:

- [ ] (user-only) Realny smoke: przetworzenie zdjęcia prod zwraca detekcje bez bboxów,
      tytuły matchują się do kandydatów, koszt niższy niż v6

**Implementation Note**: Po zielonych automatach pauza na manualne potwierdzenie usera
przed Fazą 2.

---

## Phase 2: Manualny wpis tożsamości (dodaj pominiętą książkę po tytule)

### Overview

W pure-identity user nie rysuje boxa, by dodać pominiętą pozycję — wpisuje tytuł.
Endpoint `POST /detections` przyjmuje opcjonalny `title` i czyni `bbox` opcjonalnym;
UI dostaje wpis tytułu → tworzy detekcję → auto-rematch (istniejąca ścieżka).

### Changes Required:

#### 1. Endpoint tworzenia detekcji

**File**: `src/pages/api/photos/[id]/detections.ts`

**Intent**: Rozluźnić `CreateDetectionSchema` (`:9-20`): `bbox` staje się **opcjonalny**;
dodać opcjonalne `title` (string, trim, max jak schema books) i opcjonalne `author`.
INSERT: `raw_title` z body (lub `''` gdy brak), `bbox_x1..y2` z body lub `null`. `refine`
walidacji `x1<x2 && y1<y2` aplikować tylko gdy `bbox` podany. Zachować ścieżkę auto-create
manual `vision_run` i `next position_index`. Komentarz docstring zaktualizować (raw_title
może pochodzić z wpisu usera).

**Contract**: `POST /api/photos/[id]/detections` body: `{ title?: string, author?: string, bbox?: {x1,y1,x2,y2} }`.
Co najmniej jedno z `title`/`bbox` wymagane (refine: pusty body → 400). Zwraca
`DetectionWithCandidatesDTO` (jak dotychczas, `candidates: []`).

#### 2. UI — „Dodaj pominiętą książkę" przez tytuł

**File**: `src/components/DetectionReview.tsx`

**Intent**: Dodać akcję „Dodaj pominiętą książkę" (poza overlayem, dostępną w głównym
widoku kart) otwierającą lekki input tytuł (+ opcjonalny autor). Submit → `POST /detections`
z `title` (bez bboxa) → po sukcesie wywołać istniejący endpoint rematch
`POST /api/detections/[id]/rematch` (już używany w `DetectionReview.tsx:638`, reuse
`RematchForm`/wzorca) z wpisanym tytułem, by zapełnić kandydatów → wstawić kartę do listy.
Reuse istniejących hooków/wzorców (`useDetectionDecision`). Stan ładowania + błąd inline
(modal/in-app, nie `window.*`).

**Contract**: Nowa karta detekcji pojawia się z wpisanym tytułem i (po rematch) kandydatami;
zero rysowania bboxa w tej ścieżce.

#### 3. Testy endpointu

**File**: `tests/unit/` (testy API detections lub nowy plik)

**Intent**: Pokryć: (a) body z samym `title`, bez bbox → 201/200 z `raw_title` ustawionym,
`bbox === null`; (b) body z samym `bbox` (legacy draw) → jak dotychczas; (c) pusty body
(brak title i bbox) → 400; (d) bbox z `x1>=x2` → 400.

**Contract**: Asercje na status + `raw_title`/`bbox` w odpowiedzi dla każdego wariantu.

### Success Criteria:

#### Automated Verification:

- [ ] Unit: `POST /detections` z samym `title` (bez bbox) → detekcja z `raw_title`, `bbox null`
- [ ] Unit: `POST /detections` z samym `bbox` (legacy) nadal działa
- [ ] Unit: pusty body → 400; bbox z `x1>=x2` → 400
- [ ] Typecheck / lint / build zielone
- [ ] Istniejące testy E2E bbox-draw (manual creation) nadal zielone: `npm run test:e2e` (relevantny spec)

#### Manual Verification:

- [ ] (user-only) W review: „Dodaj pominiętą książkę" → wpis tytułu → karta z kandydatami, bez rysowania

**Implementation Note**: Pauza na potwierdzenie usera przed Fazą 3.

---

## Phase 3: Reframe UI — karty główne, bbox jako narzędzie naprawcze

### Overview

Karty „potwierdź" stają się jedyną domyślną ścieżką; widok zdjęcia z bboxami jest
drugorzędnym narzędziem naprawczym. Detekcje bez bboxa są pełnoprawne (brak komunikatów
sugerujących „brakującą lokalizację" jako błąd). Rysowanie/edycja bboxa uruchamiane jawnie
na żądanie (lokalizacja / refine cropa). Domknięcie E2E golden-path.

### Changes Required:

#### 1. Demotacja widoku overlay + graceful empty

**File**: `src/components/DetectionReview.tsx`, `src/components/PhotoDetectionOverlay.tsx`

**Intent**: Upewnić się, że domyślnym widokiem są karty; widok zdjęcia (overlay) jest
drugorzędny i przy zerze bboxów pokazuje samo zdjęcie z jawnym CTA „Zlokalizuj / narysuj
ramkę" (wejście w tryb rysowania), zamiast pustego/mylącego stanu. Usunąć/zmiękczyć
sygnały traktujące brak bboxa jako defekt (np. amber „uncertain_localization" framing
przy detekcjach bez boxa — pokazywać refine-localize jako opcję, nie ostrzeżenie).

**Contract**: Przy 0 bboxach overlay renderuje zdjęcie + CTA do rysowania; karty pozostają
głównym UI. Detekcja bez bboxa nie wyświetla ostrzeżenia o błędzie.

#### 2. Bbox-editor jako narzędzie naprawcze on-demand

**File**: `src/components/DetectionReview.tsx` (RefineButton / akcje karty)

**Intent**: Surfacing rysowania/refine tylko gdy sensowne: niski confidence / brak matchu /
user jawnie wybiera „Zlokalizuj". **UWAGA (plan-review F1): obecnie `RefineButton` NIE jest
gated bboxem** — przy `bbox === null` (`classifyCropQuality(null) → 'missing_bbox'`) przycisk
„Doprecyzuj odczyt" pokazuje się AKTYWNY (neutralny indigo, `DetectionReview.tsx:42,54`),
a endpoint refine i tak no-opuje (`applied:false, reason:'bbox_not_precise'`). W pure-identity
to znaczy aktywny, bezużyteczny przycisk na KAŻDEJ karcie. Ta faza MUSI to naprawić:
gdy `bbox === null` → **ukryć** RefineButton lub **zamienić** na CTA „Narysuj ramkę, by
doprecyzować" (wchodzi w tryb rysowania); refine (crop re-OCR) eksponowany tylko gdy bbox
istnieje. Brak regresji istniejącego refine dla detekcji z bboxem.

**Contract**: Dla `bbox === null` brak aktywnego „Doprecyzuj odczyt"; zamiast tego CTA
prowadzące do rysowania (lub ukrycie). Akcje bbox/refine nie są domyślnie eksponowane na
każdej karcie; pojawiają się kontekstowo. Refine dla detekcji z bboxem działa jak dotychczas.

#### 3. Reframe copy / etykiety

**File**: `src/components/DetectionReview.tsx` (+ ew. teksty pomocnicze)

**Intent**: Zmienić język tak, by rozpoznanie było celem: nagłówki/empty-states mówią
o „rozpoznanych książkach do potwierdzenia", a lokalizacja jest opcjonalna („opcjonalnie
zaznacz pozycję na zdjęciu"). Bez natywnych `window.confirm/alert`.

**Contract**: Teksty spójne z identity-first; brak sugestii, że bbox jest wymagany.

#### 4. E2E golden-path identity-first

**File**: `tests/e2e/` (nowy lub rozszerzony spec, mock vision przez `page.route`)

**Intent**: Mock vision-response **bez** bbox (identity-only) → upload → process → karty →
potwierdź pierwszą → książka w katalogu. Dodatkowo: „dodaj pominiętą po tytule" (Faza 2)
oraz „narysuj ramkę jako naprawa" (legacy draw path) jako osobne asercje. Mock zgodny
z regułą kosztową (zero realnego vision). **Uwaga (plan-review F2)**: `upload-flow.spec.ts:104`
już mockuje `bbox:null` i przechodzi — skup nowy spec na NOWYCH zachowaniach (add-missed,
reframe, gating refine), nie re-testuj samego null-renderu overlayu.

**Contract**: Spec zielony lokalnie i w manualnym jobie `e2e`; pokrywa golden-path + 2
ścieżki naprawcze.

### Success Criteria:

#### Automated Verification:

- [ ] E2E: identity golden-path (mock bez bbox) → upload → potwierdź → katalog: `npm run test:e2e`
- [ ] E2E: „dodaj pominiętą po tytule" zielony
- [ ] E2E: rysowanie ramki jako naprawa nadal zielone
- [ ] Typecheck / lint / build / unit zielone
- [ ] Pełny `npm run test:e2e` deterministyczny (zgodnie z S-44 stabilizacją)

#### Manual Verification:

- [ ] (user-only) Przegląd UX: karty jako główny widok, overlay drugorzędny z CTA rysowania,
      brak komunikatów sugerujących wymagany bbox
- [ ] (user-only) Realny smoke pełnego flow na koncie demo

**Implementation Note**: Po Fazie 3 → `/10x-impl-review`, potem archive + PR.

---

## Testing Strategy

### Unit Tests:

- Vision client: identity-response (bez bbox) parsuje się → `bbox null`; backward-compat z bbox.
- `POST /detections`: warianty title-only / bbox-only / empty / invalid bbox.

### Integration Tests:

- Brak nowych integracji RLS (zero zmian schematu). Istniejące RLS testy bez zmian.

### Manual Testing Steps (user-only):

1. Realny smoke przetwarzania zdjęcia → detekcje bez bboxów, tytuły matchują.
2. „Dodaj pominiętą książkę" przez wpis tytułu → karta + kandydaci.
3. „Narysuj ramkę" jako naprawa → detekcja z bboxem → refine działa.
4. Przegląd UX kart jako głównej ścieżki + koszt niższy niż v6.

## Performance Considerations

Identity-only prompt zwraca mniej tokenów out (brak współrzędnych) → mierzony spadek kosztu
30–46% i krótsza odpowiedź (S-40). Brak nowych zapytań DB w hot-path (match bez zmian).

## Migration Notes

**Brak migracji.** Historyczne detekcje v6 (z bboxami) pozostają i renderują się normalnie.
Nowe runy v7 dają `bbox null`. `prompt_version` w `vision_runs` rozróżnia runy (v6 vs v7).

## References

- Decyzja źródłowa: `context/archive/2026-06-07-bbox-quality-validation/change.md`
  (sekcja „Pivot produktowy (2026-06-09): identity-first")
- Memory: `bbox-identity-first-pivot`
- Główny prompt: `src/lib/vision/prompt.ts:23-59`
- Pipeline: `src/pages/api/photos/[id]/process.ts`; match: `src/pages/api/photos/[id]/match.ts`
- Manual creation: `src/pages/api/photos/[id]/detections.ts`
- UI: `src/components/DetectionReview.tsx`, `src/components/PhotoDetectionOverlay.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Prompt identity-first

#### Automated

- [x] 1.1 Unit: vision client parsuje identity-response (bez bbox) → bbox null
- [x] 1.2 Unit: istniejące testy vision (backward-compat z bbox) zielone
- [x] 1.3 Typecheck przechodzi
- [x] 1.4 Lint przechodzi
- [x] 1.5 Build przechodzi
- [x] 1.6 `PROMPT_VERSION === 'v7'`; `VISION_SYSTEM_PROMPT` bez słowa `bbox`

#### Manual

- [x] 1.7 (user-only) Realny smoke: detekcje bez bboxów, tytuły matchują, koszt < v6

### Phase 2: Manualny wpis tożsamości

#### Automated

- [ ] 2.1 Unit: `POST /detections` z samym `title` → `raw_title` set, `bbox null`
- [ ] 2.2 Unit: `POST /detections` z samym `bbox` (legacy) nadal działa
- [ ] 2.3 Unit: pusty body → 400; bbox `x1>=x2` → 400
- [ ] 2.4 Typecheck / lint / build zielone
- [ ] 2.5 Istniejące E2E bbox-draw nadal zielone

#### Manual

- [ ] 2.6 (user-only) „Dodaj pominiętą książkę" → wpis tytułu → karta z kandydatami

### Phase 3: Reframe UI

#### Automated

- [ ] 3.1 E2E: identity golden-path (mock bez bbox) → upload → potwierdź → katalog
- [ ] 3.2 E2E: „dodaj pominiętą po tytule" zielony
- [ ] 3.3 E2E: rysowanie ramki jako naprawa nadal zielone
- [ ] 3.4 Typecheck / lint / build / unit zielone
- [ ] 3.5 Pełny `npm run test:e2e` deterministyczny

#### Manual

- [ ] 3.6 (user-only) UX: karty główne, overlay drugorzędny z CTA rysowania, brak „wymagany bbox"
- [ ] 3.7 (user-only) Realny smoke pełnego flow na koncie demo
