# S-40: Jakość bboxów z vision — walidacja, prompt, decyzja — Implementation Plan

## Overview

Vision-model systematycznie **klastruje współrzędne bbox** (prod: 51/71 detekcji `y2=0.5550`, 18× `y1=0.30`) → ramki nie obrysowują pojedynczych książek. **Reframe (uwaga usera 2026-06-08):** instrukcja promptu v6 „`y2 = DÓŁ grzbietu = deska półki`" jest **błędnym uogólnieniem** — działa tylko dla książek stojących pionowo na półce, a zdjęcia bywają **nie-półkowe** (książki na kocu, stos na blacie — to wprost Flow B „dodaj zakup", przypadek pełnoprawny). Co więcej, kotwica „deska" jest **głównym podejrzanym o samo klastrowanie** (model przykleja `y2` wszystkich książek do jednej domniemanej linii półki).

Właściwy niezmiennik bbox: **ciasny obrys WIDOCZNEGO obiektu książki, niezależnie od podłoża; każda książka ma WŁASNE, niezależne współrzędne.** Slice mierzy problem (IoU vs ground-truth) na 3 zdjęciach różnego rodzaju, iteruje prompt (usunięcie kotwicy „deska" + tight-bound + anti-anchoring) i kończy wdrożeniem najlepszego promptu + raportem decyzyjnym.

## Current State Analysis

- **Prompt**: `src/lib/vision/prompt.ts` `VISION_SYSTEM_PROMPT` (`PROMPT_VERSION='v6'`) — instrukcja bbox zakotwiczona w „desce półki" (`prompt.ts:54`), z przykładami per-orientacja. Bias przetrwał tę instrukcję; kotwica jest podejrzana o jego współ-przyczynę i wprost zawodzi na zdjęciach bez półki.
- **UI overlay**: poprawne (zweryfikowane w change.md; overlay liczy % od pełnego obrazu; E2E S-18/S-37). **Nie ruszamy.**
- **Prior art benchmarku**: `scripts/bbox-prompt-benchmark.mjs` woła realny Anthropic API (klucz z `.dev.vars`), porównuje warianty promptu — bez IoU. Rozszerzyć.
- **Typy zdjęć w grze**: (i) pionowa półka (klasyka), (ii) stos poziomy / mieszany, (iii) **nie-półkowe** (koc / blat — Flow B). Wszystkie pełnoprawne.

## Desired End State

Zmierzony baseline IoU + klastrowanie dla v6 na **3 zdjęciach różnego rodzaju**; przetestowane 2–3 warianty promptu (w tym wariant bez kotwicy „deska"); **najlepszy wariant wdrożony** jako `PROMPT_VERSION='v7'` (jeśli bije baseline bez regresji detekcji, na WSZYSTKICH typach); **raport decyzyjny** (prompt wystarczył / potrzebny post-processing / model). Weryfikowalne: benchmark drukuje metryki per-typ przed/po; na zdjęciu demo (półka) ORAZ na nie-półkowym overlay ciasno obrysowuje książki, bez klastrowania i bez halucynowania „deski".

### Key Discoveries

- `src/lib/vision/prompt.ts:54` — kotwica „y2 = deska" jest (a) shelf-only → łamie się na kocu/stosie, (b) **podejrzana o klastrowanie** `y2`. Reframe = usunąć kotwicę, dać per-book tight-bound.
- v6 już miał poprawną-dla-półki instrukcję, a model ignorował → prompt-only fix NIEPEWNY; benchmark rozstrzyga (nie zakładać sukcesu).
- change.md → surowe heurystyki post-proc (clamp, detekcja deski po kolorze) **odrzucone bez benchmarku** — a „detekcja deski" tym bardziej, bo deski może nie być.

## What We're NOT Doing

- **Implementacja post-processingu** — tylko rekomendacja w raporcie, jeśli benchmark uzasadni; właściwa implementacja = osobny slice.
- **S-21 (re-OCR cropów)** — decyzja po wynikach.
- **Zmiana palety `SPINE_COLORS`** (load-bearing, S-08) i **zmiana overlay UI** (poprawny).
- Detektor YOLO/GPU; zmiana `REFINE_VISION_SYSTEM_PROMPT`.

## Implementation Approach

Validation-first na zróżnicowanym korpusie: narzędzie pomiaru (IoU vs ground-truth) → iteracja promptu wokół poprawnego niezmiennika (tight-bound, surface-agnostic, per-book) → wdrożenie zwycięzcy + decyzja. Koszt: garść realnych wywołań vision (BYOK, zaakceptowane).

## Critical Implementation Details

- **Ground-truth anotuje agent przez Read tool** (reguła „obrazy przez Read, nie API") — deliberate, pełna uwaga; znana słabość (rodzina modelu) odnotowana w raporcie.
- **Sedno reframe'u promptu**: usunąć „deska półki"; zastąpić niezmiennikiem „obrysuj DOLNĄ WIDOCZNĄ krawędź TEGO grzbietu/książki; nie zakładaj żadnej wspólnej linii podłoża; KAŻDA książka ma własne y2 — nie powielaj wartości między pozycjami" (anti-anchoring). Surface-agnostic: półka, koc, blat tak samo.
- Benchmark raportuje **recall detekcji** per-typ, żeby wariant poprawiający bbox nie pogorszył wykrywania tytułów (regresja), szczególnie na nie-półkowych.
- **Niedeterminizm vision (F1)**: bbox waha się między wywołaniami → każdy wariant uruchamiany **N=3 razy per zdjęcie**, agregat = **median IoU + wariancja**; wariant uznany za zwycięzcę TYLKO jeśli bije baseline **poza szumem run-to-run** (różnica median > rozrzut). Pojedynczy przebieg nie rozstrzyga.
- **Dopasowanie detekcja↔ground-truth (F4)**: **greedy po max IoU** (nie po pozycji — wariant może zmienić liczbę/kolejność). Niedopasowane GT = miss (obniża recall), niedopasowana detekcja = false-positive.
- **PROMPT_VERSION (F6)**: używany tylko w `src/pages/api/photos/[id]/process.ts:125` (zapis `prompt_version` na rekordzie vision_run); **żaden test go nie pinuje** → bump do v7 bezpieczny, bez zmian w testach.

## Phase 1: Ground-truth (3 typy) + harness IoU

### Overview
Pozyskać 3 zdjęcia referencyjne różnego rodzaju (od usera), zaanotować docelowe bboxy (agent przez Read), rozszerzyć benchmark o IoU + metryki klastrowania per-typ. Zmierzyć baseline v6.

### Changes Required

#### 1. Zdjęcia referencyjne (3 typy)
**File**: `docs/image-analysis/bbox-groundtruth/` (3 obrazy + `provenance.md`)
**Intent**: korpus pokrywający pionową półkę, stos poziomy i nie-półkowe (koc/blat).
**Contract**: 3 zdjęcia dostarczone przez usera (różnego rodzaju); `provenance.md` z opisem typu każdego (półka / stos / koc-blat), wymiarami, AR. **Prerequisite: user dostarcza 3 zdjęcia.**

#### 2. Anotacja ground-truth (agent via Read)
**File**: `docs/image-analysis/bbox-groundtruth/<photo>.json` ×3
**Intent**: referencyjne ciasne bboxy widocznych książek do scoringu IoU.
**Contract**: JSON array `[{position, orientation, surface:"shelf|stack|none", bbox:[x1,y1,x2,y2]}]` (0..1), obrys widocznego obiektu — bez założenia podłoża.

#### 3. Harness IoU (rozszerzenie istniejącego benchmarku — F3)
**File**: `scripts/bbox-prompt-benchmark.mjs` (rozszerzyć; reuse `toBase64`, `runVariant` z `client.messages.create`, ładowanie klucza z `.dev.vars`, czytanie lokalnych obrazów, `analyzeBboxes`) — NIE tworzyć równoległego skryptu.
**Intent**: zmierzyć jakość bbox wariantu promptu vs ground-truth, per-typ zdjęcia, na bazie istniejącej infra.
**Contract**: dołożyć funkcję IoU (greedy max-IoU matching detekcja↔GT — F4), agregację median IoU + wariancja po N=3 przebiegach (F1), metryki % identycznych `y2`/`y1` (klastrowanie), off-frame, recall; CLI przyjmuje `--prompt <v6|plik-wariantu>` i `--photo <id|all>`, ground-truth z `docs/image-analysis/bbox-groundtruth/<photo>.json`; **wyniki rozbite per-typ** (shelf/stack/none); zapis do `docs/image-analysis/bbox-groundtruth/results.md`. (Uwaga: obrazy lokalne, gitignored — patrz `.gitignore`.)

### Success Criteria

#### Automated Verification:
- `node scripts/bbox-prompt-benchmark.mjs --prompt v6 --photo all` przechodzi i drukuje baseline per-typ.
- 3 pliki ground-truth JSON istnieją i parsują się (poprawny schemat z `surface`).
- `npm run lint` przechodzi na nowym skrypcie.

#### Manual Verification:
- Ground-truth agenta sensowne na każdym z 3 zdjęć (user rzut oka).
- Baseline potwierdza klastrowanie na półce ORAZ pokazuje zachowanie na nie-półkowym (czy halucynuje „deskę").

---

## Phase 2: Warianty promptu (surface-agnostic) + pomiar

### Overview
Napisać 2–3 warianty wokół poprawnego niezmiennika, zmierzyć na 3 typach, wybrać zwycięzcę lub udowodnić brak poprawy.

### Changes Required

#### 1. Warianty promptu
**File**: `scripts/bbox-variants/v7a-no-shelf-anchor.txt`, `v7b-fewshot-surface-agnostic.txt`, `v7c-combined.txt`
**Intent**: usunąć kotwicę „deska", wymusić per-book tight-bound niezależny od podłoża.
**Contract**: pełny system-prompt per plik. (a) usuwa „deska", dodaje anti-anchoring + zakaz zakładania wspólnej linii; (b) few-shot z przykładami współrzędnych dla pionowej / poziomej / leżącej-na-podłożu; (c) kombinacja. Benchmark przyjmuje `--prompt <plik>`.

#### 2. Przebieg porównawczy
**File**: `docs/image-analysis/bbox-groundtruth/results.md`
**Intent**: wybrać zwycięzcę per-typ lub stwierdzić brak poprawy.
**Contract**: tabela metryk per wariant × per-typ vs baseline (mean IoU, % klastra, recall); jawne „winner" lub „none beats baseline". Zwycięzca musi nie regresować na ŻADNYM typie.

### Success Criteria

#### Automated Verification:
- Benchmark zwraca metryki dla wszystkich wariantów na 3 zdjęciach.
- Recall detekcji żadnego wariantu nie spada poniżej baseline v6 (per-typ).

#### Manual Verification:
- User akceptuje tabelę i wskazanie zwycięzcy (lub zgodę na „none beats baseline" → eskalacja w Fazie 3).

---

## Phase 3: Wdrożenie zwycięzcy + raport decyzyjny

### Overview
Jeśli wariant wygrał — wdrożyć jako v7. Zawsze — raport decyzyjny (DoD „decision point").

### Changes Required

#### 1. Wdrożenie zwycięskiego promptu (warunkowe)
**File**: `src/lib/vision/prompt.ts`
**Intent**: lepsze, surface-agnostic bboxy do prod.
**Contract**: `VISION_SYSTEM_PROMPT` = treść zwycięzcy; `PROMPT_VERSION='v7'`. `SPINE_COLORS`, `REFINE_*` nietknięte. Brak zwycięzcy → POMIŃ.

#### 2. Raport decyzyjny
**File**: `context/changes/bbox-quality-validation/change.md` (sekcja „Wyniki i decyzja")
**Intent**: jawne go/no-go na post-processing / S-21 / model, z liczbami per-typ.
**Contract**: metryki przed/po + rekomendacja + jawne stwierdzenie czy kotwica „deska" była przyczyną klastrowania.

#### 3. Guard regresji wersji
**File**: testy (`tests/unit/**`)
**Intent**: nie zepsuć testów pinujących `PROMPT_VERSION`.
**Contract**: `grep -r PROMPT_VERSION tests/` → zaktualizować do v7 jeśli pinowane.

### Success Criteria

#### Automated Verification:
- `npm run typecheck && npm run lint && npm run test && npm run build` zielone.
- `grep -r "PROMPT_VERSION" tests/` — żaden test nie pada przez bump.

#### Manual Verification:
- **Bramka demo (2 typy) = best achievable** (decyzja F2 „lean + reassess"): user wgrywa zdjęcie półki ORAZ nie-półkowe → overlay obrysowuje książki najlepiej jak wyszło po iteracji promptu. Jeśli prompt NIE wystarczył (benchmark), bramka = najlepszy osiągnięty stan, a post-processing/zmiana modelu idzie jako **osobny slice** — NIE blokuje zamknięcia S-40 (DoD = decision point).
- Raport decyzyjny jednoznaczny (w tym: czy prompt wystarczył pod demo, czy potrzebny follow-up).

---

## Testing Strategy

### Unit Tests:
- Brak nowej logiki prod poza stałą promptu (string). Jeśli test pinuje `PROMPT_VERSION` — zaktualizować.

### Integration / Benchmark:
- `scripts/bbox-prompt-benchmark.mjs` = test jakości (manualny, BYOK) — nie w CI (koszt + niedeterminizm; koszt-guardrail CLAUDE.md).

### Manual Testing Steps:
1. Benchmark v6 na 3 typach → baseline.
2. Benchmark wariantów → porównaj per-typ.
3. Po v7: wgraj realne zdjęcie półki I nie-półkowe → overlay.

## Performance Considerations

Koszt = realne wywołania vision (BYOK): 3 zdjęcia × (1 baseline + 3 warianty) ≈ 12 wywołań Sonnet per pełny przebieg. Akceptowane. Zero wpływu na runtime prod.

## References

- Change identity + analiza + reframe: `context/changes/bbox-quality-validation/change.md`
- Prompt: `src/lib/vision/prompt.ts:23` (v6)
- Prior benchmark: `scripts/bbox-prompt-benchmark.mjs`
- Pokrewny slice (decyzja po S-40): roadmap S-21 `vision-spine-crop-reocr`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Ground-truth (3 typy) + harness IoU

#### Automated
- [ ] 1.1 Benchmark v6 drukuje baseline per-typ na 3 zdjęciach
- [x] 1.2 3 pliki ground-truth JSON (z `surface`) istnieją i parsują się
- [ ] 1.3 `npm run lint` przechodzi na `bbox-iou-benchmark.mjs`

#### Manual
- [ ] 1.4 Ground-truth agenta zweryfikowany wzrokowo na każdym z 3 zdjęć
- [ ] 1.5 Baseline pokazuje klastrowanie (półka) + zachowanie na nie-półkowym

### Phase 2: Warianty promptu (surface-agnostic) + pomiar

#### Automated
- [ ] 2.1 Benchmark zwraca metryki dla wszystkich wariantów na 3 zdjęciach
- [ ] 2.2 Recall detekcji żadnego wariantu nie spada poniżej baseline (per-typ)

#### Manual
- [ ] 2.3 User akceptuje tabelę + zwycięzcę (lub „none beats baseline")

### Phase 3: Wdrożenie zwycięzcy + raport decyzyjny

#### Automated
- [ ] 3.1 `typecheck + lint + test + build` zielone
- [ ] 3.2 Testy pinujące `PROMPT_VERSION` zaktualizowane (jeśli istnieją)

#### Manual
- [ ] 3.3 Bramka demo: overlay ciasny na półce I nie-półkowym, bez klastra/halucynacji deski
- [ ] 3.4 Raport decyzyjny jednoznaczny
