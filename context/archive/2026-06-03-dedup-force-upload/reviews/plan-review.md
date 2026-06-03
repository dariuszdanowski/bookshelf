<!-- PLAN-REVIEW-REPORT -->
# Plan Review: "Wgraj mimo to" vs UNIQUE constraint

- **Plan**: context/changes/dedup-force-upload/plan.md
- **Mode**: Deep
- **Date**: 2026-06-03
- **Verdict**: REVISE → SOUND (po auto-apply F1/F2/F3)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
6/6 paths ✓, 3/3 symbols ✓ (handleUploadAnyway, upload-anyway-button, 23505), brief↔plan ✓

## Findings

### F1 — Phase 2 może wywrócić istniejący test 23505

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff harnessa testowego
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: `index.test.ts` `makeContext` mockuje `locals.supabase` jako `{ from }` bez `.storage`. Kod Phase 2 woła `locals.supabase.storage.from('shelf-photos').remove(...)`; bez try/catch istniejący test 23505 (170-180) pęka na undefined `.storage`. Plan implikował try/catch, ale nie precyzował, ani nie wspominał o stubie storage w `makeContext`.
- **Fix**: Phase 2 #2 — cleanup w try/catch (błąd storage nie zmienia 409); Phase 2 #1 — `makeContext` rozszerzony o `storage.from().remove()` mock; nowy test asercją na remove, istniejący 23505 przeżywa.
- **Decision**: FIXED (Fix in plan — auto-apply Fast track)

### F3 — Założenie: 23505 == kolizja hash

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, wąski zakres
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: Cleanup kasuje obiekt Storage na każdym 23505. Dziś `photos` ma jeden unique index (hash), więc 23505 zawsze = kolizja hash. Kolejny unique constraint mógłby spowodować błędne skasowanie.
- **Fix**: Dopisać założenie do Phase 2 contract + Open Risks (brief).
- **Decision**: FIXED (Fix in plan — auto-apply Fast track)

### F2 — Component test ścieżki duplikatu nie istnieje

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #2
- **Detail**: `PhotoUploader.test.tsx` mockuje check-hash zawsze na null — brak testu ścieżki duplikatu. Phase 1 #2 „update component test" mylące: to net-new. Pokrycie duplikatu żyje w e2e.
- **Fix**: Doprecyzować Phase 1 #2 — e2e primary, component test opcjonalny net-new.
- **Decision**: FIXED (Fix in plan — auto-apply Fast track)
