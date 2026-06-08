---
change_id: bbox-quality-validation
title: "S-40: Jakość bboxów z vision — walidacja, prompt, bezpieczny post-processing"
status: planned
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
