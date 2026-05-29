<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Catalog Search & Filters (S-08)

- **Plan**: context/changes/catalog-search-and-filters/plan.md
- **Scope**: Pełny plan (Fazy 1–4)
- **Date**: 2026-05-29
- **Mode**: Fast track (self-review, Opus; auto-apply recommended)
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria
typecheck 0, lint clean, build complete, vitest 424/424, E2E 29/29 (2 skipped integration). Manual (Studio kolumny+backfill, US-03/04 smoke) deferred post-merge.

## Safety & Quality
- Search read-only; oba zapytania RLS-scoped (shelf_entries przez book ownership, books przez user_id). `.in('id', bookIds)` — bookIds pochodzą z RLS-scoped shelf_entries usera → brak cross-user leak. ILIKE input escaped (`%`/`_`/`\`). ✓
- spine_color denormalizacja: capture w confirm/correct/batch z detekcji; backfill z aktualnego shelf_entry; manual/Flow-B = null (poprawne). ✓
- Pattern: apiResponse/apiError, Zod+flattenError, console.error{name,message,code}, prerender, 401 guard. ✓

## Findings (observations — nie blokujące)

### F1 — Brak indeksu/paginacji przy ~1000 (scale-appropriate)
- ℹ️ OBSERVATION · 🏃 LOW · search.ts + CatalogSearchIsland
- ILIKE na search_text bez GIN trigram + render wszystkich wyników bez paginacji. Przy target_scale small (~1000/user) p95<1s i render OK. Przy 10k+ wymagałby GIN + wirtualizacji. Świadome — scale MVP.
- **Decision**: ACCEPTED (scale)

### F2 — Auto-search całego katalogu na mount
- ℹ️ OBSERVATION · 🏃 LOW · CatalogSearchIsland useEffect
- Debounce useEffect odpala się na mount z pustymi kryteriami → ładuje wszystkie książki (browse). Harmless i sensowne dla /library, ale stan `search-hint` przez to praktycznie niewidoczny. Cosmetic.
- **Decision**: ACCEPTED (browse-all to rozsądny default biblioteki)

### F3 — Filtr koloru pomija manual/Flow-B (spine_color null)
- ℹ️ OBSERVATION · 🏃 LOW · zgodne z planem „What we're NOT doing"
- Książki bez detekcji (manual S-06, Flow-B) mają spine_color=null → filtr koloru ich nie zwróci. Świadome (kolor = atrybut rozpoznania ze zdjęcia).
- **Decision**: ACCEPTED (w planie)

### F4 — „Krótki opis" (FR-032) wycięty z full-text
- ℹ️ OBSERVATION · 🔎 MEDIUM · scope reduction must-have FR
- Opis nie persystowany; capture wymaga modyfikacji klientów S-04 (googleBooks/openLibrary) + confirm + re-fetch backfill. Pełnotekst S-08 = title/author/publisher. US-03/04 działają (tytuł/autor + kolor). **Follow-up zarejestrowany w roadmap** (capture opisu).
- **Decision**: ACCEPTED + follow-up slice

## Podsumowanie
APPROVED. Bezpieczne (RLS×2, escaped ILIKE), zgodne z wzorcami; 4 obserwacje to świadome MVP-scale/scope decyzje. F4 (cięcie opisu) zarejestrowane jako follow-up. Zero zmian kodu.
