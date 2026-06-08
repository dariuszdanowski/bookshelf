<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-44 e2e-flake-stabilization

- **Plan**: context/changes/e2e-flake-stabilization/plan.md
- **Mode**: Deep
- **Date**: 2026-06-09
- **Verdict**: REVISE → SOUND (po auto-apply F1+F2)
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓, symbols ✓ (UserMenu lost-click, ShelvesIsland client-fetch loading),
brief↔plan ✓, Progress↔Phase ✓.

## Findings

### F1 — Phase 3.2 celuje w nieistniejący antywzorzec w media-pack

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix obvious
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — item #2
- **Detail**: Grep `getComputedStyle` trafił media-pack file-level, ale odczyty (`:157,167`) to statyczny `objectFit`, nie sprzężony z `.hover()`. Jedyny transientny hover-read jest w dark-mode-contrast (Faza 2).
- **Fix**: Rescope 3.2 — media-pack bez zmian; sweep = grep `.hover()` sprzężony z natychmiastowym computed-style; poza dark-mode brak → no-op.
- **Decision**: FIXED (auto-apply, fast track)

### F2 — Phase 3.3 błędnie traktuje cost-panel waitForTimeout jako zwykły timing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix obvious
- **Dimension**: Blind Spots
- **Location**: Phase 3 — item #3
- **Detail**: `cost-panel.spec.ts:238` to negative-wait (dowód, że `/costs` NIE jest wołany przed klikiem, `:231-239`). Nie da się zastąpić `waitForResponse`. Naiwna podmiana zepsułaby test.
- **Fix**: Zamiast 500ms czekać na ready-state (cost-button visible / networkidle), potem `expect(costsCalled).toBe(false)`.
- **Decision**: FIXED (auto-apply, fast track)
