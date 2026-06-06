<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-37 book-to-detection-focus

- **Plan**: context/changes/book-to-detection-focus/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: SOUND (po auto-apply 3 findingów LOW — Fast track)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓ (schema.ts, shelves/[id]/books.ts, books/search.ts, BookCard.tsx,
photos/[id].astro, DetectionReview.tsx — wszystkie czytane bezpośrednio),
5/5 symbols ✓ (`parseUuidParam(raw: string | undefined)`, `focusedDetectionId`,
`handleMarkerContextMenu`, testidy `detection-{card|row|tile}-{position_index}`
we wszystkich 3 trybach S-25, `BookCard.book: ShelfBookDTO`), brief↔plan ✓.

Zweryfikowane ryzyko kluczowe: potwierdzone detekcje SĄ renderowane w review
(API bez filtra statusu detekcji; `decidedIds` sesyjne) — deep-link do confirmed
detection działa.

## Findings

### F1 — Blast radius DTO: wymagane pole łamie istniejące fixtures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — DTO schema
- **Detail**: `detection_id` jako required field w ShelfBookDTO/CatalogBookDTO wywala
  TS w fixtures testów komponentów (BookCard, ShelfBooksIsland, CatalogSearchIsland).
- **Fix**: wymienić pliki fixtures w touched-set Phase 1.
- **Decision**: FIXED (auto-apply, Fast track)

### F2 — E2E „zero błędów konsoli" to asercja dekoracyjna

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — E2E
- **Detail**: asercja na konsolę nie failuje gdy ryzyko się materializuje i bywa flaky.
- **Fix**: scenariusz 2 asertuje business outcome (wszystkie markery, brak trybu fokus).
- **Decision**: FIXED (auto-apply, Fast track)

### F3 — Niezapisane odkrycie o renderowaniu confirmed detections

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries
- **Detail**: bez tej notki implementer może uznać deep-link do confirmed za martwy.
- **Fix**: dopisane do Key Discoveries.
- **Decision**: FIXED (auto-apply, Fast track)
