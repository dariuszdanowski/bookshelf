# S-40: Jakość bboxów z vision — walidacja, prompt, decyzja — Implementation Plan

## Overview

Vision-model systematycznie **klastruje współrzędne bbox** (potwierdzone na prod: 51/71 detekcji `y2=0.5550`, 18× `y1=0.30`), przez co ramki grzbietów są ucięte ~13% i nie sięgają deski półki. Prompt `v6` JUŻ instruuje poprawnie (`y2 = DÓŁ grzbietu = deska półki [typowo 0.75–0.88]`), a model i tak ignoruje — więc to systematyczny bias, nie brak instrukcji. Ten slice **mierzy** problem (IoU vs ground-truth), **iteruje prompt** mocniejszą dźwignią (few-shot ze współrzędnymi + anti-anchoring) i kończy **wdrożeniem najlepszego promptu + raportem decyzyjnym** czy potrzebny jest post-processing / zmiana modelu / S-21.

## Current State Analysis

- **Prompt**: `src/lib/vision/prompt.ts` `VISION_SYSTEM_PROMPT` (`PROMPT_VERSION='v6'`) — ma już instrukcję bbox z przykładami per-orientacja i jawnym „y2 = deska, NIE dół tekstu". Bias przetrwał tę instrukcję.
- **UI overlay**: poprawne (zweryfikowane w change.md; overlay liczy % od pełnego obrazu; pokryte E2E S-18/S-37). **Nie ruszamy.**
- **Prior art benchmarku**: `scripts/bbox-prompt-benchmark.mjs` woła realny Anthropic API (ładuje `ANTHROPIC_API_KEY` z `.dev.vars`), porównuje warianty promptu — ale liczy jakość detekcji, **nie IoU bboxów**. `bbox-deep-analysis.mjs`, `bbox-horizontal-experiments.mjs`, `docs/image-analysis/` — dodatkowa infra/wyniki.
- **Dane referencyjne**: 2 zdjęcia prod z change.md — A (skośna perspektywa, bias `y1` +0.05–0.07) i B (`8c7f62df-adca-40a0-a98c-8dfd55575820`, AR=2.165, 37 książek, bias `y2` ucięty).

## Desired End State

Zmierzony baseline IoU + klastrowanie dla v6 na obu zdjęciach; przetestowane 2–3 warianty promptu; **najlepszy wariant wdrożony** (jeśli bije baseline bez regresji detekcji) jako `PROMPT_VERSION='v7'`; **raport decyzyjny** stwierdzający czy prompt rozwiązał bias, czy potrzebny jest następny krok (post-processing / thinking budget / model / S-21). Weryfikowalne: benchmark drukuje metryki przed/po; na zdjęciu demo overlay sięga deski bez klastrowania.

### Key Discoveries

- `src/lib/vision/prompt.ts:54` — instrukcja „y2 = deska" już istnieje → prompt-only fix NIEPEWNY, benchmark musi rozstrzygnąć (nie zakładać sukcesu).
- `scripts/bbox-prompt-benchmark.mjs:17` — wzorzec ładowania klucza z `.dev.vars` + woła realny vision; rozszerzyć o IoU.
- change.md → „Weryfikacja zasadności" — surowe heurystyki (clamp ±0.06, detekcja deski po kolorze) **odrzucone bez benchmarku**; post-processing tylko udowodniony.

## What We're NOT Doing

- **Implementacja post-processingu** (clampy per-orientacja, detekcja deski po kolorze) — tylko REKOMENDACJA w raporcie, jeśli benchmark uzasadni; właściwa implementacja to osobny slice.
- **S-21 (re-OCR cropów)** — decyzja po wynikach, poza tym slice'em.
- **Zmiana palety `SPINE_COLORS`** (load-bearing, S-08) i **zmiana overlay UI** (jest poprawny).
- Detektor YOLO/GPU (serverless stack go nie uniesie).
- Zmiana `REFINE_VISION_SYSTEM_PROMPT` (osobna ścieżka).

## Implementation Approach

Validation-first: najpierw narzędzie do pomiaru (IoU vs ground-truth anotowany przez agenta), potem iteracja promptu mierzona tym narzędziem, na końcu wdrożenie zwycięzcy + jawna decyzja o dalszych krokach. Koszt: garść realnych wywołań vision (BYOK, zaakceptowane).

## Critical Implementation Details

- **Ground-truth anotuje agent przez Read tool** (zgodnie z regułą projektu „czytaj obrazy przez Read, nie API") — deliberate, pełna uwaga na całym zdjęciu, nie single-shot. Znana słabość: referencja z tej samej rodziny modeli — odnotować w raporcie; mimo to deliberate annotation > produkcyjny single-shot jako baseline.
- **Anti-anchoring** to sedno wariantu: model powiela `y2=0.555` dla różnych książek → prompt musi jawnie zakazać reużywania tej samej wartości („każda książka ma WŁASNĄ dolną krawędź przy desce; nie powielaj współrzędnych między pozycjami").
- Benchmark MUSI też raportować **recall detekcji** (liczba dopasowanych książek), żeby wariant poprawiający bbox nie pogorszył wykrywania tytułów (regresja).

## Phase 1: Ground-truth + harness IoU

### Overview
Pozyskać 2 zdjęcia referencyjne lokalnie, zaanotować docelowe bboxy (agent przez Read), rozszerzyć benchmark o IoU + metryki klastrowania. Zmierzyć baseline v6.

### Changes Required

#### 1. Zdjęcia referencyjne
**File**: `docs/image-analysis/bbox-groundtruth/` (2 obrazy + `provenance.md`)
**Intent**: mieć dokładnie te piksele, których dotyczyła analiza prod.
**Contract**: pobranie z prod Storage po `storage_path` (service-role z `.dev.vars`) lub reuse jeśli już w `docs/image-analysis/`; `provenance.md` z photo IDs, AR, storage_path.

#### 2. Anotacja ground-truth (agent via Read)
**File**: `docs/image-analysis/bbox-groundtruth/<photoA>.json`, `<photoB>.json`
**Intent**: referencyjne docelowe bboxy do scoringu IoU.
**Contract**: JSON array `[{position, orientation, bbox:[x1,y1,x2,y2]}]` (0..1), pozycje skorelowane z detekcjami prod gdzie możliwe.

#### 3. Harness IoU
**File**: `scripts/bbox-iou-benchmark.mjs`
**Intent**: zmierzyć jakość bbox wariantu promptu vs ground-truth.
**Contract**: CLI `node scripts/bbox-iou-benchmark.mjs --prompt <v6|plik-wariantu> --photo <A|B|both>` → woła realny vision, dopasowuje detekcje do GT (greedy IoU / pozycja), liczy mean IoU, % identycznych `y2`/`y1` (klastrowanie), liczbę off-frame (`x2≥0.999`), recall detekcji; zapis metryk do `docs/image-analysis/bbox-groundtruth/results.md`.

### Success Criteria

#### Automated Verification:
- `node scripts/bbox-iou-benchmark.mjs --prompt v6 --photo both` przechodzi i drukuje baseline (mean IoU, % y2-klastra, recall).
- Pliki ground-truth JSON istnieją i parsują się (poprawny schemat).
- `npm run lint` przechodzi na nowym skrypcie.

#### Manual Verification:
- Ground-truth agenta wygląda sensownie na zdjęciu (user rzut oka — ramki obejmują właściwe grzbiety).
- Baseline potwierdza klastrowanie liczbowo (zgodne z analizą prod: wysoki % identycznego y2).

---

## Phase 2: Warianty promptu + pomiar

### Overview
Napisać 2–3 warianty promptu celujące w bias, zmierzyć każdy benchmarkiem, wybrać zwycięzcę lub udowodnić, że żaden nie pomaga.

### Changes Required

#### 1. Warianty promptu
**File**: `scripts/bbox-variants/v7a-fewshot.txt`, `v7b-antianchor.txt`, `v7c-combined.txt`
**Intent**: przebić ignorowaną instrukcję v6.
**Contract**: pełny system-prompt per plik; różnice: (a) few-shot z konkretnymi współrzędnymi per-orientacja, (b) jawny zakaz powielania wartości y między pozycjami (anti-anchoring), (c) kombinacja. Benchmark przyjmuje `--prompt <plik>`.

#### 2. Przebieg porównawczy
**File**: `docs/image-analysis/bbox-groundtruth/results.md`
**Intent**: wybrać zwycięzcę lub stwierdzić brak poprawy.
**Contract**: tabela metryk per wariant vs baseline (mean IoU, % klastra, recall detekcji); jawne „winner: <wariant>" lub „none beats baseline".

### Success Criteria

#### Automated Verification:
- Benchmark zwraca metryki dla wszystkich wariantów na obu zdjęciach.
- Recall detekcji żadnego wariantu nie spada poniżej baseline v6 (guard regresji wykrywania).

#### Manual Verification:
- User akceptuje tabelę wyników i wskazanie zwycięzcy (lub zgodę, że żaden nie bije baseline → eskalacja w Fazie 3).

---

## Phase 3: Wdrożenie zwycięzcy + raport decyzyjny

### Overview
Jeśli wariant wygrał — wdrożyć jako v7. Zawsze — napisać raport decyzyjny (czy bias rozwiązany, czy potrzebny dalszy krok). To jest DoD „decision point".

### Changes Required

#### 1. Wdrożenie zwycięskiego promptu (warunkowe)
**File**: `src/lib/vision/prompt.ts`
**Intent**: dostarczyć lepsze bboxy do prod.
**Contract**: `VISION_SYSTEM_PROMPT` = treść zwycięzcy; `PROMPT_VERSION='v7'`. `SPINE_COLORS`, `REFINE_*` nietknięte. Jeśli żaden wariant nie wygrał — POMIŃ tę zmianę.

#### 2. Raport decyzyjny
**File**: `context/changes/bbox-quality-validation/change.md` (sekcja „Wyniki i decyzja")
**Intent**: jawne go/no-go na post-processing / S-21 / zmianę modelu.
**Contract**: liczby przed/po + rekomendacja: „prompt wystarczył" / „potrzebny post-processing (osobny slice)" / „potrzebny thinking budget / inny model".

#### 3. Guard regresji wersji promptu
**File**: testy (`tests/unit/**`)
**Intent**: nie zepsuć testów pinujących `PROMPT_VERSION`.
**Contract**: `grep -r PROMPT_VERSION tests/` — jeśli test pinuje wersję, zaktualizować do v7; inaczej brak zmian.

### Success Criteria

#### Automated Verification:
- `npm run typecheck && npm run lint && npm run test && npm run build` zielone.
- `grep -r "PROMPT_VERSION\|v6" tests/` — żaden test nie pada przez bump wersji.

#### Manual Verification:
- **Bramka demo**: user wgrywa zdjęcie półki → overlay bboxów wizualnie sięga deski, brak widocznego klastrowania (scena-hero akceptowalna).
- Raport decyzyjny czytelny i jednoznaczny co do następnego kroku.

---

## Testing Strategy

### Unit Tests:
- Brak nowej logiki produkcyjnej poza zmianą stałej promptu (string) — testy parsowania `DetectionSchema` pozostają aktualne. Jeśli istnieje test pinujący `PROMPT_VERSION`, zaktualizować.

### Integration / Benchmark:
- `scripts/bbox-iou-benchmark.mjs` to de facto test jakości (manualny, BYOK) — nie w CI (koszt + niedeterminizm vision; zgodnie z koszt-guardrail CLAUDE.md).

### Manual Testing Steps:
1. Odpal benchmark v6 → zapamiętaj baseline.
2. Odpal benchmark dla wariantów → porównaj.
3. Po wdrożeniu v7: wgraj realne zdjęcie na dev/prod → obejrzyj overlay (deska).

## Performance Considerations

Koszt = realne wywołania vision (BYOK): 2 zdjęcia × (1 baseline + 3 warianty) ≈ 8 wywołań Sonnet per pełny przebieg. Akceptowane. Zero wpływu na runtime prod (zmiana to treść promptu).

## References

- Change identity + analiza: `context/changes/bbox-quality-validation/change.md`
- Prompt: `src/lib/vision/prompt.ts:23` (v6, `PROMPT_VERSION`)
- Prior benchmark: `scripts/bbox-prompt-benchmark.mjs`
- Pokrewny slice (gated, decyzja po S-40): roadmap S-21 `vision-spine-crop-reocr`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Ground-truth + harness IoU

#### Automated
- [ ] 1.1 Benchmark v6 drukuje baseline (mean IoU, % y2-klastra, recall) na obu zdjęciach
- [ ] 1.2 Ground-truth JSON (A + B) istnieją i parsują się poprawnie
- [ ] 1.3 `npm run lint` przechodzi na `bbox-iou-benchmark.mjs`

#### Manual
- [ ] 1.4 Ground-truth agenta zweryfikowany wzrokowo przez usera jako sensowny
- [ ] 1.5 Baseline potwierdza klastrowanie liczbowo

### Phase 2: Warianty promptu + pomiar

#### Automated
- [ ] 2.1 Benchmark zwraca metryki dla wszystkich wariantów na obu zdjęciach
- [ ] 2.2 Recall detekcji żadnego wariantu nie spada poniżej baseline v6

#### Manual
- [ ] 2.3 User akceptuje tabelę wyników + wskazanie zwycięzcy (lub „none beats baseline")

### Phase 3: Wdrożenie zwycięzcy + raport decyzyjny

#### Automated
- [ ] 3.1 `typecheck + lint + test + build` zielone
- [ ] 3.2 Testy pinujące `PROMPT_VERSION` zaktualizowane (jeśli istnieją)

#### Manual
- [ ] 3.3 Bramka demo: overlay sięga deski bez klastrowania na realnym zdjęciu
- [ ] 3.4 Raport decyzyjny jednoznaczny co do następnego kroku
