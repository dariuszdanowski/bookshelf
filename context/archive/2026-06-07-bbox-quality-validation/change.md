---
change_id: bbox-quality-validation
title: "S-40: Jakość bboxów z vision — walidacja, prompt, bezpieczny post-processing"
status: archived
created: 2026-06-07
updated: 2026-06-09
archived_at: 2026-06-08T22:37:20Z
---

## Notes — analiza zewnętrzna usera (2026-06-07, skondensowana)

User dostarczył analizę (zewn. narzędzie) dwóch zdjęć prod:

**Zdjęcie A** (AR=1.471): renderowanie UI bboxów uznane za POPRAWNE (przeliczenie
`bbox_y × rendered_height` matematycznie zgodne z obserwacją co do piksela);
realny problem = model przesuwa `y1` o +0.05–0.07 (zaznacza bryłę książki ze
skośną okładką zamiast wąskiego pasa grzbietu przy perspektywie).

**Zdjęcie B** (`8c7f62df-adca-40a0-a98c-8dfd55575820`, AR=2.165, 37 książek):
1. `y2` pionowych grzbietów ucięte ~13% wysokości (model 0.555 vs deska półki ~0.70-0.74)
2. `y1` zbyt uniformiczne (0.30 dla różnych wysokości książek)
3. Nakładające się X w stosach leżących (brak rozdzielczości głębi)
4. `x2=1.0` poza kadrem (EKSPEDYCJA)
5. Poziome książki w stosach klasyfikowane jako pionowe

Proponowane przez analizę fixy JS: `fixHorizontalBbox` (clamp grubych poziomych do
±0.06 wokół środka), `fixVerticalBbox` (wymuszenie y2 ≥ shelfY−0.08) + detekcja
deski półki po „ciepłym brązie" (R−B > 50) skanem od dołu.

## Weryfikacja zasadności (agent, prod, 2026-06-07)

SQL na `8c7f62df…` (71 detekcji z bbox): **51/71 ma identyczne `y2=0.5550`** (mode),
**18× `y1=0.30`**, **2× `x2≥0.999`**, `fat_horizontal` (warunek fixu A: w>2.5h i h>0.12)
= **0 trafień**. Wnioski:
- Klastrowanie współrzędnych przez model — **POTWIERDZONE twardo** (claims 1-2, 4).
- Claim „UI poprawne" — zgodny z naszą wiedzą (overlay liczy % od pełnego obrazu;
  testy E2E S-18/S-37 to pokrywają).
- Fix `fixHorizontalBbox` — na zbadanym zdjęciu nie miałby zastosowania; clamp ±0.06
  to ślepa heurystyka, która MOŻE psuć poprawne ramki → **odrzucone bez benchmarku**.
- Detekcja deski po kolorze (R−B>50) — krucha (ciemne półki, cienie, okładki brązowe);
  wymaga walidacji na korpusie zdjęć.

## Prior art w repo

- `scripts/bbox-prompt-benchmark.mjs`, `bbox-deep-analysis.mjs`,
  `bbox-horizontal-experiments.mjs` — gotowa infrastruktura benchmarków bbox
  (z prac dual-path/S-18).
- `docs/image-analysis/` — wyniki wcześniejszych benchmarków OCR.
- Memory: bboxy 0..1, re-analiza = UPDATE (dane nie giną); S-21 (re-OCR cropów,
  gated) zależy wprost od jakości bboxów — S-40 jest jego naturalnym prereq.

## Kierunek (validation-first — do /10x-plan)

1. **Ground-truth**: ręczna anotacja 2 zdjęć referencyjnych (A + B) — docelowe bboxy
   jako fixture JSON; metryka IoU per detekcja.
2. **Benchmark obecnego promptu** (`bbox-prompt-benchmark.mjs` rozszerzony o IoU) —
   baseline + kwantyfikacja klastrowania.
3. **Iteracja promptu** (np. jawne „y2 = dolna krawędź grzbietu przy desce półki",
   few-shot ze współrzędnymi, zakaz wartości-kotwic) — najtańsza dźwignia, bo problem
   to systematyczny bias modelu, nie szum.
4. **Post-processing TYLKO udowodniony benchmarkiem** (np. korekta y2 do wykrytej
   deski, jeśli detektor deski osiąga precyzję na korpusie; clampy per-orientacja
   tylko przy poprawie IoU bez regresji).
5. Decyzja S-21 po wynikach (lepsze bboxy → lepsze cropy → czy re-OCR nadal potrzebny?).

## Reframe (2026-06-08, uwaga usera podczas /10x-plan)

User zakwestionował kotwicę „deska półki" odziedziczoną z promptu v6: zdjęcia bywają
**nie-półkowe** (książki na kocu, stos na blacie — Flow B „dodaj zakup" to wprost blat).
Ustalenia:
- Niezmiennik bbox to **ciasny obrys WIDOCZNEGO obiektu, surface-agnostic, per-book** —
  NIE „sięgnij deski". „Deska" jest błędnym uogólnieniem i **podejrzanym o samo klastrowanie**
  (model kotwiczy y2 wszystkich książek do jednej domniemanej linii półki).
- Non-shelf = **pełnoprawny przypadek**; korpus referencyjny = **3 zdjęcia różnego rodzaju**
  dostarczone przez usera (półka / stos / koc-blat).
- Forki: ground-truth = agent anotuje przez Read; DoD = best prompt + decision point.

## Outcome

Bboxy ciasno obrysowujące widoczne książki na każdym typie zdjęcia (półka / stos / nie-półka),
zmierzone IoU przed/po na 3-zdjęciowym korpusie; najlepszy prompt wdrożony (v7) lub jawny raport,
że bias wymaga post-processingu/zmiany modelu. Plan: [plan.md](plan.md).

## Ustalenia empiryczne (Faza 1, 2026-06-08) — ROOT CAUSE ZIDENTYFIKOWANY

Korpus: 3 zdjęcia prod (Storage `shelf-photos`, lokalne+gitignored): `01-shelf-vertical`
(b79f3a02, EXIF=1, AR 2.165), `02-mixed` (5b18b976, EXIF=6 portret), `03-bed-nonshelf`
(7cb7193d, EXIF=6 portret). Ground-truth anotowany przez agenta (Read) + overlay ffmpeg.

**Co OBALONE (dowodami):**
1. **Render CSS poprawny** — `PhotoDetectionOverlay.tsx`: kontener (`<div relative>` z `<img w-full h-auto>`) przylega do obrazu; bbox `left/width: %` mapuje WPROST na piksele. Brak letterbox/object-fit bugu. change.md „UI poprawne" potwierdzone.
2. **EXIF nie jest bugiem** — model Anthropic HONORUJE EXIF (na 02/EXIF=6 ramki modelu pasują do portretowej orientacji wyświetlanej); przeglądarka też → zgadzają się → render OK. ⚠ **Gotcha narzędziowy: Read tool NIE stosuje EXIF tak jak przeglądarka** → moje GT dla 02/03 wyszło w złej orientacji (landscape RAW zamiast portret display). GT 02/03 do re-anotacji z wersji display.
3. **„Bias y2=0.555"** z analizy zewn. — specyficzny dla gęstego `8c7f62df` (71 książek), NIE uniwersalny. Na czystej półce (01) model daje y2≈0.83 (deska), dobrze.

**PRAWDZIWY BUG (zmierzony na 01, EXIF=1, GT poprawne):**
- **Współrzędne X z modelu są zdeformowane afinicznie, zależnie od proporcji obrazu.**
  Na szerokim zdjęciu (AR 2.165): `model_x ≈ 1.31·gt_x − 0.056` — **stretch ~1.3×** wokół
  pivota ≈0.17; prawe książki za daleko w prawo (Arcymag: GT xc 0.542 → model 0.655, +0.113).
- **Test reprezentacji** (po x-center, GT 0.135–0.542):
  - `%` (v6): 0.110–0.655 (stretch w prawo) ❌
  - piksele + wymiary: 0.051–0.242 (ściśnięte w lewo — Anthropic resize do ~1568px, model gubi skalę 4000px) ❌❌
  - square-pad (4000²): 0.155–0.590 (stretch ~halved, skrajny błąd +0.113→+0.048) ✅ X-lepiej, ale **psuje Y** (y2 wychodzi w pad, klastruje).
- Wniosek: **% to właściwa reprezentacja**; deformacja jest w PERCEPCJI modelu (zależna od AR), nie w jednostkach ani renderze.

**Kierunek (decyzja usera: A — zmierzona korekta affine):**
Scharakteryzować deformację X (afiniczną, AR-zależną) na korpusie i odjąć w post-processingu
(walidowane benchmarkiem, NIE ślepa heurystyka). **Blocker danych**: 1 czysty punkt AR (01);
dla generalizacji potrzeba ≥2 AR → re-anotować 02/03 w orientacji display (ffmpeg-rotate→Read).
Skrypty robocze: pobranie zdjęć + overlay + warianty (w `lekcje/_scraper/`, poza repo).

## Wyniki i decyzja (2026-06-08) — PROMPT NIE WYSTARCZYŁ, decision point

Po dostarczeniu przez usera ręcznego GT dla wszystkich zdjęć przeprowadzono dwustopniową
weryfikację: (1) **self-test bez API** — agent Claude jako proxy endpointu vision (Read tool),
(2) **realny test API** v6 vs v7 vs v6+thinking, N=3, metryki kierunkowe. Narzędzia:
`scripts/bbox-llm-selftest.mjs`, `scripts/bbox-iou-benchmark.mjs` (rozszerzony: xIoU, szer×, |Δy2|,
centerHit, zapis surowych detekcji). Konwencja GT zamrożona: `CONVENTION.md`. Pełna analiza:
`docs/image-analysis/bbox-groundtruth/selftest-findings.md`. Overlaye: `01-compare`, `01-gt-disagree`,
`04-api-compare`.

**Higiena pomiaru naprawiona (warunek wiarygodności):**
- GT był **niespójny** — 01 („y2=deska 0.805" + wąskie x) vs 04 („y2=dół grzbietu 0.92" + realne x)
  dla **bajt-identycznego** pliku. Te same detekcje dawały szer×1.41 vs ×1.00 zależnie od GT.
  → zamrożono konwencję („dół widocznego grzbietu, realne krawędzie x, surface-agnostic"), 01 naprawione.
- **2D-IoU to zła metryka** dla wąskich grzbietów (wizualnie dobry odczyt = 0.42). Wprowadzono metryki
  kierunkowe (xIoU 1D, szer×, |Δy2|, centerHit) — odporne na konwencję y i wąskość boxów.

**Realny test API (GT naprawione, N=3):**

| Zdjęcie | Prompt | medIoU | xIoU | szer× | ctrHit | recall | %Y2cl |
|---|---|---|---|---|---|---|---|
| 04 shelf (landscape) | v6 | 0.207 | 0.358 | 1.29 | 50% | 67% | **100%** |
| 04 shelf | v7-final | **0.042** | 0.402 | **1.59** | 20% | 56% | **100%** |
| 04 shelf | v6+think2500 | 0.189 | 0.348 | 1.39 | 33% | 67% | **100%** |
| 02 mixed (portrait) | v6 | 0.424 | 0.746 | 0.81 | 100% | 83% | 67% |
| 02 mixed | v7-final | 0.339 | 0.819 | 0.92 | 100% | 83% | 67% |
| 03 none (portrait) | v6 | 0.322 | 0.858 | 1.08 | 100% | 83% | 17% |
| 03 none | v7-final | 0.263 | 0.857 | 1.09 | 100% | 83% | 17% |

**Wnioski (zmierzone, nie założone):**
1. **Reframe promptu OBALONY jako fix.** Usunięcie kotwicy „deska" i przykładu y2 (v7) **nie zmieniło
   klastrowania** (%Y2cl: 100/67/17% identyczne v6=v7) i **pogorszyło** resztę (04: medIoU 0.207→0.042,
   szer× 1.29→1.59, recall 67→56%). Klastrowanie y2 jest **wrodzone modelowi**, nie pochodzi z promptu.
2. **Thinking nie pomaga.** v6+think2500 ≈ v6 (klaster 100% bez zmian) — deliberacja nie odblokowuje
   precyzji w ścieżce API single-shot.
3. **Model POTRAFI (self-test via Read: szer×1.00, klaster 25%), ale API single-shot nie.** Zdolność
   istnieje, lecz jest niedostępna przez prompt/thinking. Różnica = ścieżka generowania, nie wiedza.
4. **Awaria jest skoncentrowana na gęstej półce wąskich, podobnych grzbietów** (04: xIoU 0.36, ctrHit 50%,
   ramki rozlane w pustą półkę — zob. `04-api-compare.overlay`). **Portret stack/non-shelf (02/03)
   lokalizuje X dobrze** (xIoU 0.75–0.86, ctrHit 100%) — bbox vision tam jest użyteczny.
5. **Wysoka wariancja run-to-run** (±σ≈0.22 na IoU) — nawet korekta afiniczna byłaby niestabilna
   (deformacja zmienia się między wywołaniami).

**DECYZJA:**
- **NIE wdrażać v7** — `PROMPT_VERSION` zostaje `v6` (v7 zmierzony jako regresja). Faza 3.1 pominięta.
- **Prompt-only: ZAMKNIĘTE jako ścieżka** (udowodnione: prompt+thinking nie ruszają biasu).
- **Produktowo**: opierać się na **ręcznej edycji/tworzeniu bbox** (już dowiezione: `e2aa2ed`
  „manual bbox creation without vision") jako podstawowej ścieżce dla półek pionowych; vision-bbox
  traktować jako wstępną propozycję, nie źródło prawdy. Dla non-shelf rozważyć **quad** (`0022_detection_quad.sql`).
- **Post-processing (korekta afiniczna X) — osobny slice, warunkowo.** Charakterystyka jest AR-zależna
  i niestabilna (σ wysoka); ROI niepewny. Najpierw zebrać ≥3 AR czystego GT, potem decyzja. NIE blokuje S-40.
- **S-21 (re-OCR cropów)**: cropy z vision-bbox są za luźne na gęstych półkach → re-OCR z tych bboxów
  niewiarygodny; sensowny dopiero po ręcznej korekcie bbox lub post-processingu. Odroczone.

## Pivot produktowy (2026-06-09, decyzja usera: identity-first)

User zakwestionował cały cel: wartością produktu jest **JAKIE książki/gry są na zdjęciu**, nie
gdzie dokładnie. Match (Google Books) i dedup nie używają pikseli; bbox karmi tylko pozycję
(wystarczy kolejność), review-UX (wystarczy kotwica) i crop-reOCR. Decyzja: **identyfikacja = cel,
lokalizacja = kotwica + narzędzie naprawcze gdy model nie rozpozna**.

**Test walidujący (identity-only vs v6, `scripts/bbox-identity-test.mjs`, fuzzy-title match, N=2):**

| Zdjęcie | recall v6 → identity | precyzja | koszt |
|---|---|---|---|
| 04 shelf | 83% → **89%** | 94% → **100%** | −31% |
| 02 mixed | 90% → **95%** | 82% → 79% | −46% |
| 03 none | 67% → 67% | 67% → 57% | −39% |

Prompt bez bbox czyta **≥ równie dobrze**, jest **tańszy** (mniej tokenów out) i prostszy.
Trade-off: więcej FP na zagraconych scenach (03) — neutralizuje review (reject).

**Kierunek docelowy (do osobnego /10x-plan, pełny cykl):**
1. Tryb identyfikacji jako główna ścieżka: model zwraca listę `{kind, title, author, confidence}`
   bez współrzędnych → karty „potwierdź" z kandydatami match + miniaturą.
2. Lokalizacja zdegradowana do kotwicy (numer porządkowy + opcjonalny przybliżony marker).
3. Bbox-editor (`e2aa2ed`) = narzędzie doszczegółowiania, surfaceowane gdy: niski confidence /
   brak matchu / user dodaje pominiętą pozycję.
4. KPI zmienione z IoU na **title-recall + precyzja + czas review**.
5. „Inne narzędzie" tylko dla geometrii i tylko jeśli boxy okażą się krytyczne (CV pionowych
   grzbietów / Gemini grounding) — osobny, warunkowy slice.

**S-40 zamyka się jako decision-point**: prompt-bbox odrzucony (zmierzony), kierunek = identity-first.
