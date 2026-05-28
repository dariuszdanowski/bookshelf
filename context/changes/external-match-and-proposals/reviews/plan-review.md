<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-04 external-match-and-proposals

- **Plan**: context/changes/external-match-and-proposals/plan.md
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: REVISE → SOUND (po triage, 5/5 fixed)
- **Findings**: 1 critical · 4 warnings · 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F2 — fixed) |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3 — fixed) |
| Blind Spots | FAIL (F1 critical + F4 — fixed) |
| Plan Completeness | WARNING (F5 — fixed) |

## Grounding
7/7 existing paths ✓, 6/6 new paths absent ✓, detectMediaType/toBase64 confirmed (process.ts:20/:10), contract-surfaces absent (skip), brief↔plan ✓. @astrojs/cloudflare ^13.5.0, astro ^6.3.1. Sub-agent: Astro 6 `astro dev` runs real workerd (CLAUDE.md note stale); photon WASM bundling has documented risk (Astro #15511).

## Findings

### F1 — photon-rs WASM bundling niezweryfikowane (Astro #15511)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: Blind Spots
- **Location**: Phase 1 — photon-rs module / substrat obrazu
- **Detail**: Astro issue #15511 — WASM z pakietu npm emitowany do dist/client/_astro/ niedostępny dla _worker.js → runtime crash; fix w v13.5.5 niepotwierdzony. Plan opierał cały substrat obrazu na photon bez wczesnej weryfikacji. F2/F3 nie zależą od photon.
- **Fix A ⭐**: Upfront WASM spike jako pierwszy krok-gate Fazy 1 (install, minimalny resize endpoint, astro build → sprawdź .wasm w _worker.js, astro dev/workerd bez crasha; workaround manual init lub eskalacja jeśli pada).
- **Decision**: FIXED (Fix A) — dodano Phase 1 #0 spike GATE + Progress 1.1 + success criterion; renumerowano Progress 1.2-1.11.

### F2 — Re-match pyta tylko o 'pending' → idempotentny re-match to no-op

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — match endpoint contract
- **Detail**: Endpoint ustawia status='matched'; drugi /match nie znajdzie 'pending' → no-op; criterion 2.11 przechodzi pusto.
- **Fix**: Query wszystkich detekcji zdjęcia (bez rejected), delete-then-insert niezależnie od statusu.
- **Decision**: FIXED — zaktualizowano kontrakt match.ts.

### F3 — OpenLibrary fallback niedoprecyzowany

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — openLibrary client / match endpoint
- **Detail**: OL zwraca 0 dla polskich tytułów; plan nie precyzował że OL to ISBN-enrichment nie title-search.
- **Fix**: OL wołane tylko dla ISBN-lookup; skip OL dla title-only PL.
- **Decision**: FIXED — zaktualizowano kontrakt openLibrary client + match.ts orkiestrację.

### F4 — Quota Google niedoszacowana (kaskada query)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Performance Considerations
- **Detail**: ~90 zdjęć/dzień zakładało 1 call/detekcja; kaskada do 3 → ~30 zdjęć/dzień.
- **Fix**: Kaskada stop na pierwszym niepustym; realna quota ~30 zdjęć/dzień w Performance.
- **Decision**: FIXED — early-exit w match.ts + zaktualizowane Performance Considerations.

### F5 — mediaType po photon resize musi być 'image/jpeg'

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — process.ts change (#4)
- **Detail**: detectMediaType(storage_path) zwróci np. image/png gdy bytes po photon to JPEG → mismatch.
- **Fix**: Hardcode mediaType='image/jpeg' po deriveWorkingCopy.
- **Decision**: FIXED — zaktualizowano kontrakt process.ts #4.
