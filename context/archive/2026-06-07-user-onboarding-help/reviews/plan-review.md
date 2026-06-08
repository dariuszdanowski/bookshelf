<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-38 Onboarding i pomoc kontekstowa

- **Plan**: context/changes/user-onboarding-help/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: SOUND (po auto-zastosowanych fixach)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS (1 observation) |
| Blind Spots | WARNING (2 findings, fixed) |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (ShelvesIsland, PhotoListIsland, ShelfBooksIsland, CatalogSearchIsland, DetectionReview, MobileNav), 4/4 symbols ✓ (`photo-list-empty`, `PUBLIC_EXACT` handler.ts:39, `useBodyScrollLock`, RefineButton/MarkerTooltip wewnątrz DetectionReview/PhotoDetectionOverlay), 6 screenshotów w `docs/screenshots/` ✓, brief↔plan ✓.

## Findings

### F1 — Screenshoty z docs/screenshots/ w help.astro: sprzężenie z artefaktem E2E + image service nie działa na SSR route

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Strona /help
- **Detail**: (a) `screenshots.spec.ts` zapisuje bezpośrednio do `docs/screenshots/` (OUT='docs/screenshots', zapisy linie 318–375) — import tych plików do bundle'a oznacza, że każdy pełny run E2E mutuje bajty wbudowywane w stronę i brudzi diff (znany problem, memory „git restore docs/screenshots"). (b) Default `imageService: 'compile'` adaptera `@astrojs/cloudflare` nie obsługuje `<Image>` na on-demand routes, a plan nie rozstrzygał `prerender`.
- **Fix ⭐ (applied)**: jednorazowa kopia 6 PNG → `src/assets/help/` + `export const prerender = true` (strona statyczna, zero danych usera) + zwykłe importy; whitelist `/help` w `PUBLIC_EXACT` zostaje (dev: middleware biegnie dla wszystkich route'ów).
  - Strength: odcina oba problemy naraz; najprostsza działająca kombinacja na adapterze CF.
  - Tradeoff: kopia może się zestarzeć vs auto-regen — świadomy koszt, odświeżenie = re-copy przy zmianie UI (odnotowane w planie).
  - Confidence: HIGH.
  - Blind spot: zachowanie prerendered route + middleware na prodzie CF (asset served przed Workerem) — nieistotne, bo strona i tak publiczna.
- **Decision**: FIXED (auto-applied, fast track)

### F2 — Phase 1 w 3/5 widoków już dowieziony + 2 testy asertują treść search-empty

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots / Lean Execution
- **Location**: Phase 1 — Instruktażowe empty states
- **Detail**: `photo-list-empty` (link /upload), `shelf-books-empty` („+ Dodaj książkę ręcznie"), `detection-review-empty` („Przetwórz zdjęcie") już mają CTA. Realny zakres = nowe CTA dla `shelves-empty` (ShelvesIsland.tsx:112) i `search-empty` (CatalogSearchIsland.tsx:249) + szlif copy. Fraza „Nie masz tej książki" twardo asertowana w `CatalogSearchIsland.test.tsx:72` i `catalog-search.spec.ts:82`.
- **Fix (applied)**: doprecyzowany zakres fazy 1 w planie + nota: zachować frazę „Nie masz tej książki" (celowy komunikat US-04) lub zaktualizować oba testy w tym samym commicie.
- **Decision**: FIXED (auto-applied, fast track)

### F3 — HelpTip „klik-poza": doprecyzować mechanizm zgodny z repo

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — HelpTip
- **Detail**: repo nie ma wzorca popovera (`MarkerTooltip` = hover-only, fixed od kursora, niereużywalny). 4 modale realizują klik-poza przez backdrop + `stopPropagation` (ConfirmDialog.tsx:30–57). Plan mówił „klik poza zamyka" bez mechanizmu — ryzyko wynalezienia document-level listenera jako 2. wzorca.
- **Fix (applied)**: nota w kontrakcie — przezroczysty backdrop `fixed inset-0` (wzorzec ConfirmDialog bez `bg-black/50`), bez scroll locka.
- **Decision**: FIXED (auto-applied, fast track)
