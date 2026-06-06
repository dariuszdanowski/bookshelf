# Follow-ups z impl-review (shelf-book-view-modes, 2026-06-06)

Pre-existing, out-of-scope — do podjęcia osobno.

- [ ] **O2** — martwy prop `onCoverUpdated`: `BookCard` nie konsumuje go (używa `onBookSaved`→pełny refetch `loadBooks`/`runSearch`); `ShelfBooksIsland` + `CatalogSearchIsland` wciąż przekazują `handleCoverUpdated`. Pre-existing (sprzed S-34). Albo usuń prop+handler z obu wysp i `BookCardProps`, albo przywróć optimistic cover-patch zamiast refetch. Zero wpływu dziś.
- [ ] (kosmetyka) filtry/chrome w `CatalogSearchIsland` (labelki `text-gray-600`, empty/error states) nie mają pełnych klas `dark:` — poza scope BookCard/switcher S-34, ale spójność dark-mode warto domknąć.
