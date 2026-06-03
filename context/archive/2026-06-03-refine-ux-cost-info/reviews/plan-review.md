<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Refine UX — spójny label + info o koszcie (S-35)

- **Plan**: context/changes/refine-ux-cost-info/plan.md
- **Mode**: Deep
- **Date**: 2026-06-03
- **Verdict**: REVISE → SOUND (po auto-apply F1/F2/F3)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
paths ✓ (DetectionReview.tsx, fallbackPolicy.ts, force-refine.spec.ts, DetectionReview.test.tsx), symbols ✓ (classifyCropQuality, refine-button), brief↔plan ✓

## Findings

### F1 — Ujednolicenie tekstu kasuje rozróżnialność weak/good

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff testowalności
- **Dimension**: Blind Spots / Plan Completeness
- **Location**: Phase 1 (label) + testy
- **Detail**: weak vs good rozróżniane PO TEKŚCIE (`force-refine.spec.ts:108/122`). Identyczny tekst „Doprecyzuj odczyt" → e2e nie odróżni (M3L4 zabrania asercji po klasie CSS). Plan był warunkowy; problem definitywny.
- **Fix**: weak label = „⚠ Doprecyzuj odczyt" (⚠ prefix → rozróżnialne po tekście); update force-refine.spec.ts:122 + nagłówek + DetectionReview.test.tsx.
- **Decision**: FIXED (Fix in plan — auto-apply Fast track)

### F2 — RefineButton: 3 rozmiary, nie 2

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Lean Execution / Architecture
- **Location**: Phase 1 #1
- **Detail**: 3 instancje mają 3 różne rozmiary (px-3/px-2.5/px-2); `size:'sm'|'md'` nie pokryje.
- **Fix**: 3 warianty size lub `className` passthrough.
- **Decision**: FIXED (Fix in plan)

### F3 — Hint kosztu w trybach kompaktowych

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 1 #1
- **Detail**: widoczny tekst „płatne" w wąskich wierszach list/kafelki tłoczy.
- **Fix**: karty → tekst; list/kafelki → ikona ⓘ + tooltip.
- **Decision**: FIXED (Fix in plan)
