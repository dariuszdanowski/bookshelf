<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Shelf photo pipeline UI

- **Plan**: `context/changes/shelf-photo-pipeline-ui/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict (po triage)**: SOUND (przed triage: REVISE — 2 CRITICAL + 3 WARNING + 3 OBSERVATION)
- **Findings**: 2 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict (pre-triage) | Verdict (post-triage) |
|-----------|---------------------|-----------------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | FAIL (F1, F4) | PASS |
| Blind Spots | WARNING (F3, F6, F8) | PASS (F3 fixed; F6, F8 accepted) |
| Plan Completeness | FAIL (F2, F5) | PASS |

## Grounding

9/9 paths ✓ · ApiErrorCode + trigger pattern symbols ✓ · brief↔plan consistent po fix F3
(Pre-triage: brief↔plan inconsistent na backfill criteria — fix F3 zsynchronizował.)

## Findings

### F1 — Migration number 0006 already taken

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 — Migration file path
- **Detail**: Plan calls new migration `supabase/migrations/0006_vision_runs.sql`, ale `0006_detection_bbox.sql` JUŻ ISTNIEJE (z external-match-and-proposals).
- **Fix**: Rename to `0007_vision_runs.sql` + update all references in plan.md, plan-brief.md.
- **Decision**: FIXED — `0006_vision_runs.sql` → `0007_vision_runs.sql` w obu plikach (replace_all); dorzucony komentarz wyjaśniający kolizję.

### F2 — AGENTS.md vision module drift (lessons-mandated)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Completeness
- **Location**: Wszystkie 3 fazy (nie wspomniane)
- **Detail**: `src/lib/vision/AGENTS.md:13` ma rule „re-process = delete-then-insert per photo_id" — sprzeczne z append-only versioning. Lessons.md § "Onboarding docs (CLAUDE.md + AGENTS.md) dryfują niezależnie" wymaga aktualizować OBA pliki w tym samym commicie.
- **Fix**: Dorzucony nowy §6 w Phase 2: update bullet „Idempotencja" na „Wersjonowanie vision" + concurrency trigger note. Dodany Progress 2.10.
- **Decision**: FIXED — Plan rozszerzony o Phase 2 §6 i Progress 2.10.

### F3 — Backfill criteria sprzeczne między plan a brief

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: plan.md Phase 1 §1 vs plan-brief.md Open Risks
- **Detail**: plan.md OR-condition vs brief „tylko gdy istnieją detections".
- **Fix A ⭐ Recommended**: Twardo trzymaj brief — backfill tylko gdy ≥1 detection.
- **Fix B**: OR-condition (plan).
- **Decision**: FIXED via Fix A — plan.md §1 i plan-brief.md zsynchronizowane na „backfill TYLKO gdy ≥1 detection", z explicit rationale dlaczego (synthetic succeeded z 0 detections = confusing UX).

### F4 — Trigger snippet missing idempotency pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 — Contract trigger snippet
- **Detail**: Snippet bez `public.` prefix + bez `drop trigger if exists`. Niezgodne z pattern 0003/0004.
- **Fix**: Function name → `public.prevent_concurrent_vision_run`; trigger name → `vision_runs_prevent_concurrent`; dodany `drop trigger if exists` przed `create trigger`.
- **Decision**: FIXED — snippet w Phase 1 §1 zaktualizowany; dodany komentarz „Idempotency: drop trigger if exists przed create — zgodne z patternem 0003/0004 (replay safety)".

### F5 — RLS policies SQL dla vision_runs nie spisane

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 — Contract
- **Detail**: Tylko reference do patternu, brak explicit listy operacji (SELECT/INSERT/UPDATE/DELETE) i using/with check semantyki.
- **Fix**: Dodany explicit bullet: 4 policies przez `EXISTS` przedikat, INSERT `with check`, UPDATE `using + with check`, SELECT/DELETE `using`.
- **Decision**: FIXED — Contract Phase 1 §1 rozszerzony o pełną listę policy operations.

### F6 — Orphan `running` vision_runs po Worker timeout / network drop

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2 + Phase 1 trigger window
- **Detail**: Jeśli `/process` umrze między INSERT(running) a UPDATE(succeeded/failed), row zostaje 'running' na zawsze. Trigger 5-min window go ignoruje więc user niezablokowany. Akumulacja noise w DB.
- **Fix**: Out of scope dla MVP; cleanup job jako potencjalny follow-up.
- **Decision**: ACCEPTED — debug noise akceptowalny w MVP; trigger 5-min window już chroni UX.

### F7 — Dual-tracking photos.vision_* jako cache — drift risk

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Lean Execution
- **Location**: Phase 2 §2 + Open Risks
- **Detail**: photos.vision_model/cost/latency obok vision_runs.* jako cache. Open Risks już flaguje.
- **Fix**: Zostawić jak jest; flagować w lessons.md jeśli drift się objawi.
- **Decision**: ACCEPTED — backward-compat z S-04 DTO; drop jako follow-up.

### F8 — Tiny race między vision-success a status='succeeded' UPDATE

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2
- **Detail**: Window ~50ms między INSERT detections a UPDATE vision_runs status='succeeded'. Akceptowalne dla MVP.
- **Fix opcjonalny**: Zmienić kolejność — UPDATE PRZED INSERT detections.
- **Decision**: ACCEPTED — ~50ms window MVP-acceptable; observation flagged dla future.

## Triage Summary

```
Fixed:    F1 (rename 0006→0007)
          F2 (AGENTS.md update dorzucony do Phase 2)
          F3 (Fix A — backfill ≥1 detection)
          F4 (trigger snippet idempotent)
          F5 (RLS policies explicit)                    (5)
Accepted: F6, F7, F8                                    (3)
Skipped:  —                                             (0)
Dismissed: —                                            (0)

► Verdict after fixes: REVISE → SOUND
```
