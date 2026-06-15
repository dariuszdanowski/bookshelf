<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Metadane zakupu — book-purchase-metadata

- **Plan**: context/changes/book-purchase-metadata/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-06-15
- **Verdict**: APPROVED (po triage)
- **Findings**: 0 critical  5 warnings  2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Brak asercji purchase fields w testach save-path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — główna funkcjonalność fazy bez unit testów
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/components/BookModal.test.tsx:99–120, 257–277
- **Detail**: Testy POST/PATCH nie sprawdzały czy purchase_date/price/city/event trafiają do body.
- **Fix**: Dwa nowe testy save-path z asercją pól purchase.
- **Decision**: FIXED — commit bc5e9b2

### F2 — hints fetch bez AbortController — resource leak

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Safety & Quality
- **Location**: src/components/BookModal.tsx:490–504
- **Detail**: void fetch bez cleanup → setState na odmontowanym komponencie.
- **Fix**: AbortController + signal + return () => ctrl.abort().
- **Decision**: FIXED — commit bc5e9b2

### F3 — parseFloat(price) nie gwarduje NaN

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Safety & Quality
- **Location**: src/components/PurchaseSection.tsx:63–64
- **Detail**: parseFloat('abc') = NaN trafia do stanu rodzica.
- **Fix**: isNaN guard.
- **Decision**: FIXED — commit bc5e9b2

### F4 — BookCard.tsx nie ujęty w planie fazy 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Plan Adherence
- **Location**: src/components/BookCard.tsx:204–207
- **Detail**: Konieczna adaptacja literalna (data-plumbing), nie wymieniona w planie.
- **Decision**: ACCEPTED — brak zmian kodu (adaptacja literalna)

### F5 — mockFetch w BookModal.test.tsx bez URL routingu — brittle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/components/BookModal.test.tsx:53–63
- **Detail**: mockFetch routował tylko hints vs all; brak wyraźnego URL dispatch.
- **Fix**: Przebudowa na URL-router z named options `{ hintsBody }`.
- **Decision**: FIXED — commit bc5e9b2

### F6 — photos/schema.ts i shelves/photos.ts poza scope Phase 3

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Scope Discipline
- **Location**: src/lib/photos/schema.ts, src/pages/api/shelves/[id]/photos.ts
- **Detail**: Addytywne zmiany wynikłe z user feedback; grounded in Phase 1 DB.
- **Decision**: ACCEPTED — konieczna adaptacja

### F7 — UpdatePhotoSchema brak purchase_price — brak komentarza intent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision
- **Dimension**: Pattern Consistency
- **Location**: src/lib/photos/schema.ts:18–27
- **Detail**: Brak price by design (per-book, nie per-photo), ale undocumented.
- **Fix**: 1-liniowy komentarz.
- **Decision**: FIXED — commit bc5e9b2
