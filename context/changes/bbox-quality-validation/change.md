---
change_id: bbox-quality-validation
title: "S-40: Jakość bboxów z vision — walidacja, prompt, bezpieczny post-processing"
status: implementing
created: 2026-06-07
updated: 2026-06-08
archived_at: null
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
