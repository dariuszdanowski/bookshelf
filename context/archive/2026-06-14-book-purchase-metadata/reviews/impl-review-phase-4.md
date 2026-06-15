<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Metadane zakupu — book-purchase-metadata

- **Plan**: context/changes/book-purchase-metadata/plan.md
- **Scope**: Phase 4 of 4
- **Date**: 2026-06-16
- **Verdict**: APPROVED (po triage)
- **Findings**: 0 critical  2 warnings  5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — PhotoPurchasePanel: brak cleanup timerów przy unmount

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/components/PhotoPurchasePanel.tsx:29–30
- **Detail**: debounceRef + savedTimerRef nie czyszczone przy unmount. Timer odpala fetch/setState na odmontowanym komponencie. React Strict Mode podwaja mount/unmount — leak gwarantowany w dev. Wzorzec: BookModal.tsx stosuje AbortController + cleanup.
- **Fix**: Dodać `useEffect(() => { return () => { clearTimeout(debounceRef); clearTimeout(savedTimerRef); }; }, [])`.
- **Decision**: FIXED — commit bc5e9b2-p4fixes (impl-review fixes p4)

### F2 — PhotoPurchasePanel: hints fetch bez AbortController

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/components/PhotoPurchasePanel.tsx:33–53
- **Detail**: Promise.all bez AbortController → setState na odmontowanym komponencie gdy response przyjedzie po unmount. Wzorzec: BookModal.tsx:490–504 używa ctrl.abort() w cleanup.
- **Fix**: AbortController + signal na obu fetch + return () => ctrl.abort().
- **Decision**: FIXED — commit bc5e9b2-p4fixes (impl-review fixes p4)

### F3 — E2E Test 5: dwukrotny debounce przy fill min+max (observation)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/book-purchase.spec.ts:405–413
- **Detail**: Dwa .fill() mogą triggerować dwa debounce'y. Jednak predykat waitForRequest wymaga OBU params — pierwszy request (min only) jest pomijany, drugi (oba) łapany. Logika poprawna, ryzyko niskie.
- **Decision**: ACCEPTED — brak zmian (predykat waitForRequest obsługuje ten scenariusz)

### F4 — PhotoPurchasePanel: non-ok PATCH ignorowany bez console.error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/PhotoPurchasePanel.tsx:65–77
- **Detail**: Błędna odpowiedź (401, 500) cicho pomijana; brak sygnału w logach.
- **Fix**: console.error('[PhotoPurchasePanel] PATCH failed', res.status).
- **Decision**: FIXED — commit bc5e9b2-p4fixes (impl-review fixes p4)

### F5 — CatalogSearchIsland: hints fetch bez AbortController

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/CatalogSearchIsland.tsx:61–72
- **Detail**: Analogiczna sytuacja jak F2, ale niskie ryzyko — CatalogSearchIsland rzadko odmontowywany (pełna strona /library).
- **Decision**: ACCEPTED — niskie ryzyko, komponent rzadko odmontowywany

### F6 — photos/[id].astro: hints nie prefetchowane SSR-side

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/photos/[id].astro:73–79
- **Detail**: PhotoPurchasePanel montowany bez cityHints/eventHints props — komponent robi własny fetch na mount. Daje double round-trip vs SSR prefetch.
- **Decision**: ACCEPTED — adaptacja literalna; SSR prefetch hints byłby over-engineering na tym etapie

### F7 — E2E Test 3: zależność od realnego stanu DB

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/book-purchase.spec.ts:223–228
- **Detail**: Test robi page.goto('/shelves') bez mocka by uzyskać realny shelf ID. Zależy od storageState z co najmniej jedną półką. Akceptowalny wzorzec w tym projekcie (inne E2E też używają realnych danych przez storageState).
- **Decision**: ACCEPTED — znana zależność od storageState, spójna z innymi E2E testami
