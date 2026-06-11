<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-43 Vision Identity-First

- **Plan**: context/changes/vision-identity-first/plan.md
- **Mode**: Deep
- **Date**: 2026-06-09
- **Verdict**: REVISE → SOUND (po auto-apply F1+F2)
- **Findings**: 0 critical · 1 warning · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, PROMPT_VERSION=v6 ✓, bbox block prompt.ts:41-59 ✓, brief↔plan ✓.
Deep verify (1 sub-agent): UI null-bbox safe (PhotoDetectionOverlay.tsx:245 filtr withBbox,
renderMarkers/renderQuadSvg early-return); match bez bboxa (match.ts:251-255 SELECT bez bbox);
blast radius minimalny (VISION_SYSTEM_PROMPT 1 konsument client.ts; PROMPT_VERSION tylko
telemetria process.ts:125; orientation NIE zapisywane do DB; brak testów asertujących bbox
present lub PROMPT_VERSION='v6'); E2E mocki kontrolują shape (prompt nigdy nie wykonywany).

## Findings

### F1 — "refine już gated bboxem" jest nieprawdą o kodzie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix oczywisty
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — change #2
- **Detail**: Plan twierdził "refine dostępny tylko gdy bbox istnieje (już tak działa)".
  Weryfikacja: RefineButton NIE jest gated — przy bbox=null pokazuje się aktywny (neutralny
  indigo, DetectionReview.tsx:42,54), endpoint no-opuje. W pure-identity = aktywny bezużyteczny
  przycisk na każdej karcie. "już tak działa" zmyliłby implementera.
- **Fix**: Phase 3 #2 jawnie wymaga gatingu/relabelu RefineButton dla bbox=null (ukryć lub
  CTA „Narysuj ramkę, by doprecyzować").
- **Decision**: FIXED (auto-apply, fast track)

### F2 — Phase 2 nie nazywa endpointu rematch + duplikacja E2E null-bbox

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #2, Phase 3 #4
- **Detail**: (a) Phase 2 "wywołać istniejącą ścieżkę rematch" bez nazwy → POST
  /api/detections/[id]/rematch (DetectionReview.tsx:638). (b) upload-flow.spec.ts:104 już
  mockuje bbox:null i przechodzi — nowy golden-path powinien skupić się na NOWYCH zachowaniach.
- **Fix**: nazwać endpoint rematch w Phase 2; doprecyzować focus nowego E2E w Phase 3.
- **Decision**: FIXED (auto-apply, fast track)
