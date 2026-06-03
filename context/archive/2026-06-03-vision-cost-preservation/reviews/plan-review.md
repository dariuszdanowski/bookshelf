<!-- PLAN-REVIEW-REPORT -->
# Plan Review: vision-cost-preservation (S-30)

- **Plan**: context/changes/vision-cost-preservation/plan.md
- **Mode**: Deep
- **Date**: 2026-06-03
- **Verdict**: REVISE → SOUND (po auto-apply F1/F2/F3)
- **Findings**: 1 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F1 fixed) |
| Plan Completeness | WARNING (F2/F3 fixed) |

## Grounding
paths ✓, symbols ✓ (vision_runs, refine_calls, process.ts:105 insert), brief↔plan ✓

## Findings

### F1 — vision_runs.user_id NOT NULL bez źródła przy insert → /process pada

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Phase 1 + src/pages/api/photos/[id]/process.ts:105
- **Detail**: Po NOT NULL user_id + RLS `with check`, istniejący insert process.ts:105 (bez user_id) pada. Zmiana process.ts wprowadza okno deploy-przed-migracją.
- **Fix**: BEFORE INSERT trigger `set_vision_run_user_id` derywujący user_id z photos przez photo_id — zero zmian kodu, zero okna deploy-ordering, działa dla wszystkich insert sites (defense-in-depth).
- **Decision**: FIXED (Fix in plan — auto-apply Fast track)

### F2 — Nazwy constraintów FK do drop/recreate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Detail**: Plan mówił „sprawdź nazwy". Skonkretyzowane: vision_runs_photo_id_fkey, refine_calls_photo_id_fkey, refine_calls_detection_id_fkey.
- **Decision**: FIXED (Fix in plan)

### F3 — stats vision_run_count: succeeded vs all

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Detail**: running/failed mają cost_usd NULL → zawyżają count. Doprecyzowano: `.eq('status','succeeded')`.
- **Decision**: FIXED (Fix in plan)
