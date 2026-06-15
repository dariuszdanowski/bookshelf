<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Metadane zakupu książki

- **Plan**: context/changes/book-purchase-metadata/plan.md
- **Mode**: Deep
- **Date**: 2026-06-14
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — z.number() dla query params ceny (nigdy nie parsuje stringów)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — SearchBooksQuerySchema
- **Detail**: Plan specyfikuje `purchase_price_min: z.number().min(0).optional()`. URL query params są zawsze stringami — `z.number().safeParse("29.99")` zwraca failure. Filtr ceny zwróciłby 400 VALIDATION_ERROR przy każdym użyciu. Żaden istniejący schemat nie ma numeric query param — brak wzorca do naśladowania, ale fix oczywisty: `z.coerce.number()`.
- **Fix**: Zmienić obie linie na `z.coerce.number().min(0).optional()` — dotyczy purchase_price_min i purchase_price_max.
- **Decision**: FIXED — plan zaktualizowany (z.coerce.number())

### F2 — PATCH /api/photos/[id] hardkoduje { shelf_id } w .update()

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — PATCH /api/photos/[id] (src/pages/api/photos/[id].ts:366)
- **Detail**: Plan robi shelf_id opcjonalne w UpdatePhotoSchema ale handler hardkoduje `.update({ shelf_id: parsed.data.shelf_id })`. Gdy shelf_id = undefined, query ustawiłoby shelf_id na null w DB — niszczyłoby przypisanie zdjęcia do półki.
- **Fix**: Dynamiczne budowanie patch object w Phase 2 contract — opisano w planie: `const patch = {}; if defined → push to patch`.
- **Decision**: FIXED — plan zaktualizowany z wzorcem dynamicznego patch object

### F3 — useEffect deps w CatalogSearchIsland nie wspomniane

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — CatalogSearchIsland
- **Detail**: CatalogSearchIsland ma useEffect z deps `[q, color, selectedShelfIds, read]`. Bez dodania 6 nowych state vars do deps array nowe filtry nie wywołają search.
- **Fix**: Dodano notę do Phase 4 contract o deps array.
- **Decision**: FIXED — plan zaktualizowany

### F4 — UpdatePhotoSchema ".refine nebo osobne ścieżki" nieokreślone

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — UpdatePhotoSchema
- **Detail**: Plan zostawiał ".refine lub osobne ścieżki" jako TODO. Empty PATCH powinno być no-op (REST semantics).
- **Fix**: Rozstrzygnięto: empty PATCH = no-op, 200 bez efektu, brak .refine.
- **Decision**: FIXED — plan zaktualizowany

### F5 — Phase 4 duże scope — Photo panel + filtry + 5 E2E w 1 fazie

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4
- **Detail**: Phase 4 zawiera 3-4 substancjalne kawałki (PhotoPurchasePanel, photos/[id].astro, CatalogSearchIsland 4 filtry, 5 E2E). Atomic commit będzie duży.
- **Fix**: Zaakceptować scope; przy implementacji traktować sub-sekcje jako checkpointy.
- **Decision**: ACCEPTED
