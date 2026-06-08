<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-40 bbox-quality-validation

- **Plan**: context/changes/bbox-quality-validation/plan.md
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: REVISE → SOUND (po triage)
- **Findings**: 0 critical · 4 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F2) → resolved |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3) → fixed |
| Blind Spots | WARNING (F1) → fixed |
| Plan Completeness | WARNING (F4/F5/F6) → fixed/resolved |

## Grounding
2/2 ścieżek ✓ · PROMPT_VERSION blast-radius (tylko process.ts:125, brak pinów w testach) ✓ · infra benchmarku (base64 + messages.create, lokalne obrazy, analyzeBboxes) ✓

## Findings

### F1 — Niedeterminizm vision: porównanie na 1 przebiegu łapie szum
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Detail**: Bbox waha się między wywołaniami; pojedynczy przebieg per wariant może wyłonić zwycięzcę losem.
- **Fix**: N=3 przebiegi/wariant/zdjęcie, median IoU + wariancja, zwycięzca tylko poza szumem.
- **Decision**: FIXED (auto-apply do Critical Implementation Details + Fazy 2)

### F2 — DoD slice'a może przejść, a cel-demo niespełniony
- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH
- **Dimension**: End-State Alignment
- **Detail**: Jeśli prompt nie naprawi biasu, slice DONE (decision point), ale scena-hero demo wciąż złe bboxy.
- **Fix**: zdefiniować fallback.
- **Decision**: FIXED via „Lean + reassess" — demo-gate = best achievable; post-proc jako osobny slice po liczbach, nie blokuje S-40. (Zapisane w Phase 3 Manual Verification.)

### F3 — Proliferacja: nowy bbox-iou-benchmark.mjs dubluje infra
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Detail**: `bbox-prompt-benchmark.mjs` ma już toBase64/runVariant/key-load/analyzeBboxes/local-image.
- **Fix**: rozszerzyć istniejący skrypt, nie tworzyć równoległego.
- **Decision**: FIXED (Phase 1 #3 + replace_all nazwy skryptu)

### F4 — Dopasowanie detekcja↔GT „po pozycji" kruche
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Detail**: Wariant zmienia liczbę/kolejność → matching po pozycji zawodzi.
- **Fix**: greedy max-IoU; unmatched GT = miss, unmatched detekcja = FP.
- **Decision**: FIXED (Critical Implementation Details)

### F5 — Current State wspomina prod A+B; korpus to 3 zdjęcia usera
- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Detail**: Stałość po reframe.
- **Decision**: RESOLVED przez reframe (Phase 1 #1 = 3 zdjęcia usera; prod-B = dowód w change.md, nie korpus)

### F6 — Guard PROMPT_VERSION to no-op
- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Detail**: Zweryfikowane — żaden test nie pinuje PROMPT_VERSION; bump v7 bezpieczny.
- **Decision**: FIXED (notka w Critical Implementation Details)
