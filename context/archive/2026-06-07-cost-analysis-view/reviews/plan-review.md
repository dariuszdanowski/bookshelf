<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-41 Cost Analysis View

- **Plan**: context/changes/cost-analysis-view/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: SOUND (po auto-apply 4 findingów; pierwotnie REVISE)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F1, F4 — fixed) |
| Blind Spots | WARNING (F2 — fixed) |
| Plan Completeness | WARNING (F3 — fixed) |

## Grounding

7/7 paths ✓ (stats.ts, account/schema.ts, AccountIsland, CostPanel, BookModal, stats.test.ts, account.spec.ts), numer migracji 0021 wolny ✓ (ostatnia 0020), `/photos/[id].astro` istnieje ✓ (drill-down target), brief↔plan ✓.

Weryfikacja sub-agentem: formattery CostPanel.tsx:34-54 czyste/zod-free ✓; chip = span `account-key-cost-{id}` (AccountIsland.tsx:877-896), `ApiKeyDTO` ma `id`+`label` ✓; BookModal ESC/backdrop/scroll-lock potwierdzone (469-475, 600-613, 439); RLS `detections` przez EXISTS na photos (0002:27-41), `refine_calls.detection_id` CASCADE → LEFT JOIN bez sierot ✓; `npm run test -- costs` i `npm run test:e2e -- account-costs` poprawne filtry ✓.

## Findings

### F1 — Ekstrakcja formatCost pomija AccountIsland

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix obvious
- **Dimension**: Architectural Fitness
- **Location**: Faza 2 #1
- **Detail**: AccountIsland ma 2 inline kopie `toFixed(4)` (linie 24, 895) w pliku dotykanym w fazie 2; plan kazał konsumować nowy moduł tylko CostPanelowi — ekstrakcja tworzyłaby 3. wariant zamiast konsolidować. (DetectionReview/PhotoListIsland mają kolejne kopie — poza scope.)
- **Fix**: AccountIsland też konsumuje `formatCost`; pozostałe kopie jawnie poza scope.
- **Decision**: FIXED (auto-apply, fast track)

### F2 — Pierwszy security_invoker view bez testu izolacji RLS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pauza uzasadniona
- **Dimension**: Blind Spots
- **Location**: Faza 1
- **Detail**: `cost_events` to pierwszy widok `security_invoker` w repo (grep: 0 precedensów). Plan delegował walidację RLS do `db reset` + e2e — to nie dowodzi izolacji per-user. Źle skonfigurowany widok = wyciek kosztów innych userów (guardrail prywatności #1 z test-plan.md).
- **Fix**: test integracyjny izolacji w `tests/integration/` (wzorzec istniejących RLS isolation testów); biega w CI na efemerycznej Supabase.
- **Decision**: FIXED (auto-apply, fast track — nowy punkt #5 w fazie 1 + kryterium 1.3)

### F3 — Niezgodność tytułów faz body↔Progress

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: nagłówki faz / ## Progress
- **Detail**: Backticki w nagłówkach body, brak w Progress — mechaniczny kontrakt `/10x-implement` wymaga identycznych tytułów.
- **Fix**: ujednolicone (bez backticków w obu).
- **Decision**: FIXED (auto-apply)

### F4 — Kontrakt modalu bez useBodyScrollLock + aria

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Faza 2 #2
- **Detail**: BookModal i ConfirmDialog oba używają `useBodyScrollLock` + `role="dialog" aria-modal` — pominięcie = regres wzorca.
- **Fix**: dopisane do kontraktu modalu z referencjami linii.
- **Decision**: FIXED (auto-apply)
