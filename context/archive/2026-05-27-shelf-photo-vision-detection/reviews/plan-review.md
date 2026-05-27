<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-03 Upload + detekcja grzbietów (vision)

- **Plan**: context/changes/shelf-photo-vision-detection/plan.md
- **Mode**: Deep
- **Date**: 2026-05-27
- **Verdict**: REVISE → SOUND (po fixach)
- **Findings**: 0 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING (F3) → fixed |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F1, F2, F4, F5) → fixed |
| Plan Completeness | PASS |

## Grounding
9/9 anchor paths ✓, RATE_LIMITED symbol ✓, brak istniejącego upload-pattern (first-of-kind potwierdzone), brief↔plan ✓.

## Findings

### F1 — Browser→Storage upload zakłada sesję w kliencie przeglądarkowym (niezweryfikowane)
- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: Blind Spots
- **Location**: Phase 2/4 (upload architecture)
- **Detail**: `supabase.browser.ts:21-32` to anon-key client polegający na sesji z cookies; grep potwierdza zero użycia Storage. Jeśli cookies auth (@supabase/ssr) są httpOnly/nieczytelne dla JS, `storage.upload()` poleci jako anon → RLS odmówi. Cała architektura browser→Storage na tym wisi.
- **Fix**: Spike NAJPIERW w Phase 2 — weryfikacja sesji browser-client dla Storage; fallback signed-URL (`createSignedUploadUrl`) jeśli cookies nie-czytelne. Dodano do Critical Implementation Details + Phase 2 success criterion 2.4.
- **Decision**: FIXED (Fix in plan)

### F2 — Stuck 'processing' nie ma ścieżki recovery w UI
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Phase 3/4
- **Detail**: Re-process dozwolony z dowolnego stanu, ale retry button tylko przy 'failed'. Sync disconnect (~10s) zostawia 'processing' bez UI-recovery.
- **Fix**: Phase 4 — „Spróbuj ponownie" także dla stale 'processing'.
- **Decision**: FIXED (Fix in plan)

### F3 — GET /api/photos/[id] możliwe YAGNI w sync flow
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Lean Execution
- **Location**: Phase 2
- **Detail**: process zwraca detekcje; retry re-woła process; brak flow „pokaż istniejące" w scope.
- **Fix**: Zostaje, ale z jawnym uzasadnieniem (page-reload persistence + zasilenie retry). Dodano do Intent.
- **Decision**: FIXED (Fix in plan — keep + justify)

### F4 — storage_path nie walidowany względem prefiksu {uid}/
- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2 (POST /api/photos)
- **Detail**: Opaque string; mismatch fail-uje late (500 przy process) zamiast early (400). RLS i tak ogranicza dostęp, ale fail-fast lepszy.
- **Fix**: Walidacja prefiksu `${user.id}/` → 400. Dodano do Contract.
- **Decision**: FIXED (auto-apply)

### F5 — Orphaned Storage objects bez cleanup
- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2/4
- **Detail**: Browser upload OK, ale POST /api/photos padnie → osierocony obiekt.
- **Fix**: Zaakceptowany MVP risk; nota w „What We're NOT Doing" + cleanup post-MVP.
- **Decision**: FIXED (auto-apply — accepted risk documented)

## Triage Summary
Fixed: F1, F2, F3, F4, F5 (5/5). Verdict po fixach: **SOUND**.

> Uwaga proceduralna: interaktywne menu triage (AskUserQuestion) zwracało błąd narzędzia w tej sesji; findingi rozstrzygnięto recommended-fixami (Warning+ z jednoznaczną rekomendacją) i zaaplikowano do planu. User może zawetować dowolny przed `/10x-implement`.
