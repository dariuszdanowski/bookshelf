# Impl-review — match-rate-limit-resilience (S-39)

**Data:** 2026-06-07 · **Reviewer:** agent (Opus), Fast track · **Werdykt: PASS**

| Kontrakt | Stan |
| --- | --- |
| P1: retry ≤2 wyłącznie na 429, delays [500,1500]+jitter, eksport stałej | ✅ |
| P1: aktualizacja 2 testów pod nową semantykę + 2 nowe (fake timers) | ✅ |
| P2: `rate_limited:<count>` w payloadzie `/match` (back-compat) | ✅ |
| P2: toast w PhotoListIsland przy count>0 | ✅ |

## Findings

- **F1 (LOW, naprawione w trakcie)**: PostToolUse hook (`prefer-const --fix`) zamienił
  `let rateLimitedCount` na `const` między edycjami → runtime „Assignment to constant".
  Złapane testami przed commitem. Lekcja: po serii edycji jednego pliku z hookiem
  auto-fix weryfikuj deklaracje modyfikowane w późniejszych edycjach.
- **Incydent infra**: 2 pełne runy E2E z padającymi workerami (138/136 testów zamiast
  149) — przyczyną 13 osieroconych node/workerd z wcześniejszych runów (w tym sierota
  Playwrighta na :4321). Po sprzątnięciu pełny run **147 passed / 0 failed**.

## Weryfikacja

lint ✓ · typecheck 0 err · unit **925/925** (+4) · E2E **147/147** ·
Manual 2.2 (re-match `e9876820…` na prod) — user-only po deploy'u.
