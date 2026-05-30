<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Pełne zdjęcie z numerowanymi ramkami detekcji w review

- **Plan**: context/changes/photo-detection-overlay/plan.md
- **Mode**: Deep
- **Date**: 2026-05-30
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
7/7 paths ✓ (2 new files expected absent), bucket `shelf-photos` ✓, bbox-origin (resize.ts uniform scale, proporcje zachowane) ✓, Progress↔Phase ✓, brief↔plan ✓.

## Findings

### F1 — bbox poza [0,1] / odwrócone współrzędne mogą przelać overlay

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — PhotoDetectionOverlay
- **Detail**: bbox jest best-effort z vision (migracja 0006: nullable, brak CHECK na zakres). Wartość >1 lub x2<x1 dałaby ramkę z ujemną/przelewającą się szerokością nad obrazem.
- **Fix**: Clamp składowe do [0,1] + guard x2≥x1/y2≥y1 przy liczeniu %; kontener overlay `overflow-hidden`.
- **Decision**: FIXED (inline w kontrakcie PhotoDetectionOverlay)

### F2 — Złamany signed URL zostawia "pływające" ramki nad pustką

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — PhotoDetectionOverlay
- **Detail**: Jeśli `<img>` nie załaduje się (wygasły/błędny URL), markery renderują się nad pustym kontenerem. `photo_url:null` jest obsłużone, ale błąd ładowania w runtime — nie.
- **Fix**: Stan `imgError`/`imgLoaded`; markery renderuj dopiero po `onLoad`, chowaj na `onError`.
- **Decision**: FIXED (inline w kontrakcie PhotoDetectionOverlay)
