<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-15 „Źródłowe zdjęcie" na karcie książki

- **Plan**: context/changes/review-page-nav-entry/plan.md
- **Scope**: Phase 1+2 (All phases)
- **Date**: 2026-06-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — CSS selector w getShelfIdWithBooksMocked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/book-source-photo-link.spec.ts:39
- **Detail**: Helper używał `page.locator('a[href^="/shelves/"]').first()` — jedyny CSS selektor w pliku, łamie regułę E2E „Never use CSS selectors". `photos-crud.spec.ts:57` rozwiązuje ten sam problem przez `page.getByTestId(/^shelf-item-photos-link$/).first()` + `waitForSelector`.
- **Fix**: Zastąpiono CSS selector `getByTestId(/^shelf-item-photos-link$/).first()` + `waitForSelector('[data-testid^="shelf-item-"]')` — identyczny wzorzec jak `photos-crud.spec.ts`.
- **Decision**: FIXED

### F2 — not.toBeVisible() zamiast not.toBeAttached()

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/book-source-photo-link.spec.ts:110, :132
- **Detail**: `not.toBeVisible()` przechodzi natychmiast gdy element nie istnieje w DOM — nie wykryje regresji gdzie link byłby ukryty przez CSS zamiast warunkowego rendera. Poprawna asercja braku elementu z DOM: `not.toBeAttached()`.
- **Fix**: Zamieniono oba `not.toBeVisible()` na `not.toBeAttached()`.
- **Decision**: FIXED

### F3 — Non-null assertion placement.get(b.id)!

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/books/search.ts:119
- **Detail**: Niezmieniont wzorzec sprzed tego slice'a. `photo_id` jest eksponowany przez `p.photo_id` na tym samym poziomie — nie nowe ryzyko. Komentarz w pliku dokumentuje dwu-zapytaniową architekturę.
- **Fix**: Opcjonalne `const p = placement.get(b.id); if (!p) continue;` — zakres szerzej niż ten slice.
- **Decision**: SKIPPED
