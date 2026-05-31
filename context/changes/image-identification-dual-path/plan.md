# Dwa tory identyfikacji książek (OCR bez LLM + fallback LLM) — Implementation Plan

## Overview

Celem zmiany jest wdrożenie i zweryfikowanie dwóch ścieżek poprawy identyfikacji książek:

1. **Plan B (pierwszy do wdrożenia):** tani fallback z drugim przebiegiem analizy obrazu tylko dla trudnych detekcji.
2. **Plan A (walidacja):** OCR bez LLM jako ścieżka redukcji kosztu, uruchamiana tylko tam, gdzie crop jest jakościowo poprawny.

Zmiana ma przygotować repo do świadomej decyzji architektonicznej: czy i kiedy promować OCR bez LLM do ścieżki produkcyjnej.

## Current State Analysis

- Runtime preprocessing obrazu w produkcie to dziś resize + JPEG recompress (`src/lib/images/resize.ts`).
- Nie ma klasycznego OCR w runtime.
- Z badań (`docs/matching-research-2026-05-31.md`) wynika:
  - część błędów poprawia się po zawężeniu do cropa,
  - część przypadków to błędna lokalizacja bbox (crop przecina wiele książek), gdzie sam OCR nie wystarczy.
- Istnieje PoC `bookshelf_scanner` z mechanizmem crop + enhancement + drugi pass, ale oparty dalej o LLM.

## Desired End State

1. Projekt ma gotową, niskokosztową ścieżkę fallback dla trudnych detekcji (detekcja-scoped, nie full-photo).
2. Projekt ma twarde dane, czy OCR bez LLM poprawia wyniki na realnych przypadkach.
3. Decyzja o architekturze docelowej (fallback-only vs hybrid z OCR) jest oparta na benchmarku i kosztach.

## Key Discoveries

- Drugi pass na cropie daje realny zysk na części przypadków (np. Filutek/Lengren).
- Bbox quality gate jest warunkiem koniecznym; bez tego fallback przepala koszt i nie poprawia jakości.
- OCR bez LLM ma sens jako redukcja kosztu, ale tylko po walidacji na realnych cropach.

## What We're NOT Doing

- Pełnej migracji na OCR bez LLM w ciemno, bez benchmarku.
- Integracji nielegalnych źródeł danych (np. scraping serwisów z zakazem automatyzacji).
- Automatycznego drugiego passu dla wszystkich detekcji.

## Implementation Approach

Wdrożenie jest fazowe:
- najpierw dodanie i kontrola fallbacku LLM tylko dla trudnych przypadków,
- równolegle narzędzie benchmarkowe OCR bez LLM,
- na końcu decyzja i ewentualne spięcie obu ścieżek w mechanizm hybrydowy.

## Critical Implementation Details

- **Gating kosztowy:** drugi pass tylko dla detekcji spełniających trigger (`low confidence`, `no candidates`, `low top score`, `text smell`).
- **SLO kosztowe (twarde):** `max_refine_calls_per_photo = 3`, `max_refine_calls_per_user_action = 1`, `max_refine_calls_per_day = 30`; przekroczenie = blokada refine + telemetry event `refine_budget_blocked`.
- **Rollout kosztowy M1:** domyślnie `manual_only` (user click), bez automatycznego fan-out.
- **Gating jakości cropa:** fallback OCR/LLM uruchamiamy tylko, gdy bbox izoluje pojedynczy grzbiet.
- **Klasyfikacja jakości bbox:** `clean_single_spine | multi_spine_overlap | uncertain_localization | missing_bbox`; refine dozwolone tylko dla `clean_single_spine`.
- **Detekcja-scoped retry:** żadnego ponownego przetwarzania całego zdjęcia przy pojedynczym problemie.
- **Conservative rematch:** nie nadpisujemy lepszych starych kandydatów pustym/gorszym wynikiem.

## Phase 1: Substrat fallbacku image-refine (detekcja-scoped)

### Overview

Dodać endpoint i logikę, która dla pojedynczej detekcji potrafi wygenerować crop(y), uruchomić drugi pass (LLM), oddać tekst naprawczy i opcjonalnie wywołać rematch tylko tej detekcji.

### Changes Required:

#### 1. API refine detekcji

**File**: `src/pages/api/detections/[id]/refine.ts` (new)

**Intent**: Endpoint `POST` dla refine pojedynczej detekcji, z auth/RLS i ochroną kontraktu odpowiedzi.

**Contract**:
- wejście: `detection_id` w ścieżce, opcjonalny tryb (`preview` / `apply`)
- wyjście: `{ data: { refined_title, refined_author, confidence, crop_quality, applied } }`
- `Cache-Control: private, no-store`, `prerender = false`

#### 2. Crop + preprocessing utility

**File**: `src/lib/images/refineCrop.ts` (new)

**Intent**: Narzędzie do generacji minimalnego zestawu wariantów cropa (exact, rot90, gray+contrast).

**Contract**:
- input: original bytes + bbox
- output: lista 2-3 wariantów obrazu do odczytu
- zabezpieczenie na out-of-range bbox (clamp)

#### 3. Refine prompt/adapter

**File**: `src/lib/vision/client.ts` (update)

**Intent**: Dodać narrow prompt dla pojedynczego cropa i parser odpowiedzi JSON pod refine.

**Contract**:
- brak zmian w istniejącym `detectSpines` API
- nowa funkcja typu `refineSpineText(...)`

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`
- `npm run lint`
- `npm run test` (unity dla nowego endpointu i parsera)

#### Manual Verification:

- Z widoku review dla problematycznej detekcji refine zwraca czytelniejszy tekst niż baseline (co najmniej na jednym case z research).

---

## Phase 2: Integracja fallbacku z matchingiem i kontrolą kosztów

### Overview

Spiąć refine z istniejącym matchingiem tak, aby poprawiony tekst był używany tylko gdy ma sens, bez przepalania budżetu.

### Changes Required:

#### 1. Trigger policy

**File**: `src/lib/matching/fallbackPolicy.ts` (new)

**Intent**: Jawna polityka kiedy uruchamiamy drugi pass.

**Contract**:
- heurystyki triggerów i limit per-photo
- powód triggera logowany diagnostycznie
- limity kosztowe egzekwowane twardo (`3/photo`, `1/action`, `30/day`) + status `blockedByBudget`
- rollout-mode `manual_only` na starcie (auto-trigger dopiero po telemetrycznym potwierdzeniu kosztów)

#### 2. Conservative rematch guard

**File**: `src/pages/api/photos/[id]/match.ts` (update)

**Intent**: Nie nadpisywać lepszych istniejących kandydatów pustym/gorszym wynikiem.

**Contract**:
- policy comparison top-score old vs new
- stan `pending` dla braku kandydatów

#### 3. UI action for refine

**File**: `src/components/DetectionReview.tsx` (update)

**Intent**: Akcja „Doprecyzuj odczyt" dla trudnych detekcji i czytelny feedback użytkownikowi.

**Contract**:
- brak regresji `Akceptuj/Odrzuć/Popraw`
- refine działa per detection

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:e2e` (co najmniej jeden scenariusz refine)

#### Manual Verification:

- W co najmniej jednym realnym przypadku refine poprawia propozycje bez potrzeby ponownego process całego zdjęcia.
- Brak zauważalnej degradacji UX i brak kaskadowych drugich wywołań.

---

## Phase 3: Benchmark OCR bez LLM (narzędzie offline)

### Overview

Przygotować i uruchomić benchmark OCR (bez LLM) na zapisanych cropach z badań.

### Changes Required:

#### 1. Benchmark script

**File**: `scripts/ocr-benchmark.mjs` lub `docs/image-analysis/ocr_benchmark.py` (new)

**Intent**: Porównać OCR output i jakość downstream matchu dla co najmniej dwóch silników (np. PaddleOCR i Tesseract).

**Contract**:
- input: `docs/image-analysis/research-cases/crops*`
- output: raport markdown + json z metrykami

#### 2. Benchmark report

**File**: `docs/image-analysis/ocr-benchmark-report-2026-06.md` (new)

**Intent**: Udokumentować skuteczność OCR bez LLM i rekomendację architektoniczną.

### Success Criteria:

#### Automated Verification:

- Skrypt uruchamia się lokalnie i generuje raport bez ręcznego patchowania inputów.

#### Manual Verification:

- Raport zawiera decyzję `go/no-go` dla OCR bez LLM na podstawie jakości odczytu i wpływu na matching.

---

## Phase 4: Decyzja i spięcie hybrydowe (warunkowo)

### Overview

Jeśli benchmark wyjdzie pozytywnie, dodać decision-engine: OCR-first dla clean crops, LLM fallback dla low OCR confidence.

**Gate wejścia do fazy 4**: start wyłącznie jeśli benchmark OCR da co najmniej `+10 pp recall@top1` na zbiorze badawczym przy koszcie nie wyższym niż `40%` kosztu fallbacku LLM dla tej samej próbki.

### Changes Required:

#### 1. Decision engine

**File**: `src/lib/matching/refineOrchestrator.ts` (new)

**Intent**: Wybór ścieżki per detekcja: `none` / `ocr` / `llm` / `localization-first`.

#### 2. Ops flags

**File**: `src/env.d.ts`, `wrangler.jsonc`, ewentualnie docs deploy (update)

**Intent**: Feature flags i limity kosztowe.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck`
- `npm run lint`
- `npm run test`

#### Manual Verification:

- Dla przypadków z research ścieżka hybrydowa wybiera sensowną gałąź i poprawia jakość bez nadmiernego kosztu.

---

## Testing Strategy

### Unit Tests:

- parser/refine endpoint
- fallback policy
- conservative rematch rules
- orchestrator decision matrix (jeśli Phase 4)

### Integration Tests:

- detection-scoped refine -> rematch tylko dla jednej detekcji
- brak nadpisania lepszych starych kandydatów

### Manual Testing Steps (user-only):

1. Uruchomić refine dla wybranych trudnych detekcji z obu badanych zdjęć.
2. Potwierdzić poprawę tekstu/propozycji dla co najmniej jednego case per zdjęcie.
3. Zweryfikować brak regresji standardowego flow review.

## Performance Considerations

- Limit fallback calls per photo and per user action.
- Prefer detection-scoped processing to avoid whole-photo reanalysis.
- Emit telemetry dla triggerów i skuteczności fallbacku.

## Migration Notes

- Brak migracji DB w fazach 1-3.
- Ewentualne rozszerzenie schematu telemetrycznego tylko jeśli okaże się potrzebne po benchmarku.

## References

- `docs/matching-research-2026-05-31.md`
- `docs/image-identification-plans-2026-06-01.md`
- `src/lib/images/resize.ts`
- `src/pages/api/photos/[id]/process.ts`
- `C:/Projekty/10xDevs/bookshelf_scanner/bookshelf_scanner.py`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Substrat fallbacku image-refine (detekcja-scoped)

#### Automated

- [ ] 1.1 Typecheck: `npm run typecheck`
- [ ] 1.2 Lint: `npm run lint`
- [ ] 1.3 Unit testy dla refine endpointu i parsera: `npm run test`

#### Manual

- [ ] 1.4 Refine zwraca czytelniejszy tekst na co najmniej jednym przypadku z research (user-only)

### Phase 2: Integracja fallbacku z matchingiem i kontrolą kosztów

#### Automated

- [ ] 2.1 Typecheck: `npm run typecheck`
- [ ] 2.2 Lint: `npm run lint`
- [ ] 2.3 Testy unit/integration dla policy + conservative rematch: `npm run test`
- [ ] 2.4 E2E refine flow zielone: `npm run test:e2e`

#### Manual

- [ ] 2.5 Refine poprawia propozycje bez pełnego reprocess zdjęcia (user-only)
- [ ] 2.6 Brak regresji `Akceptuj/Odrzuć/Popraw` (user-only)

### Phase 3: Benchmark OCR bez LLM (narzędzie offline)

#### Automated

- [ ] 3.1 Benchmark script uruchamia się i generuje raport

#### Manual

- [ ] 3.2 Raport zawiera decyzję go/no-go dla OCR bez LLM

### Phase 4: Decyzja i spięcie hybrydowe (warunkowo)

#### Automated

- [ ] 4.1 Typecheck: `npm run typecheck`
- [ ] 4.2 Lint: `npm run lint`
- [ ] 4.3 Testy orchestratora decyzji: `npm run test`

#### Manual

- [ ] 4.4 Hybryda poprawia jakość na przypadkach z research bez nadmiernego kosztu (user-only)
