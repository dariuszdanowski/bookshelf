<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Proposal Accept → Catalog (S-05)

- **Plan**: context/changes/proposal-accept-to-catalog/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 existing paths ✓, 7/7 new paths absent ✓, symbols ✓ (CONFLICT, checkCatalogDuplicate, photo.shelf_id), brief↔plan ✓. detection→photo→shelf_id collapses to one nested PostgREST select (CONFIRM). test:e2e + db:types scripts exist (CONFIRM).

## Findings

### F1 — Re-confirm książek bez ISBN tworzy duplikaty (brak guardu idempotencji)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — helper confirmDetectionToCatalog + confirm/correct/confirm-batch
- **Detail**: Pre-check exact-dup działa po `isbn_13`. Książki BEZ ISBN (manual entry, kandydaci bez ISBN) nie mają unique constraintu (`books_user_isbn13` jest partial `where isbn_13 is not null`). Podwójny confirm tej samej detekcji (double-click, reload review, retry batch) wstawi duplikat `books` + `shelf_entries`. To dotyka guardrail NFR „ponowne uruchomienie nie tworzy duplikatów książek".
- **Fix A ⭐ Recommended**: Guard po `detection.status` w helperze — jeśli detekcja jest już `confirmed`, zwróć idempotentny skip/409 zamiast wstawiać.
  - Strength: Tani, pokrywa najczęstszy przypadek (re-accept tej samej detekcji); `detections.status` już ma wartość `confirmed`; spójny z confirm-batch (skipped).
  - Tradeoff: Nie pokrywa dwóch RÓŻNYCH detekcji wskazujących tę samą książkę bez ISBN (rzadkie, akceptowalne w MVP).
  - Confidence: HIGH — status guard to standardowy wzorzec, zero nowej infrastruktury.
  - Blind spot: Wyścig dwóch równoległych requestów na tej samej detekcji (bardzo mało prawdopodobne przy single-user).
- **Fix B**: Dodatkowo unique constraint `shelf_entries(detection_id) where detection_id is not null` (migracja 0008).
  - Strength: Gwarancja DB-level „jedna detekcja → jeden wpis"; odporne na wyścigi.
  - Tradeoff: Kolejny constraint + mapowanie 23505 w helperze; koliduje z przyszłym S-07 (re-scan / wiele wpisów per detekcja) jeśli model się zmieni.
  - Confidence: MED — solidne, ale dokłada zobowiązanie schematu przed S-07.
  - Blind spot: Czy S-07 (historia lokalizacji) będzie chciał wiele wpisów per detekcja.
- **Decision**: FIXED (Fix A — status-guard)

### F2 — book_count: „count per półka" to N+1; brak idiomatycznej ścieżki agregacji

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 3 — realny book_count w /api/shelves
- **Detail**: Kontrakt fazy 3 mówi „jedno zapytanie agregujące LUB count per półka". PostgREST/supabase-js NIE wyraża `GROUP BY count` w jednym wywołaniu (brak API group-by), a „count per półka" = N+1 round-tripów (regres NFR p95 < 1 s na liście półek). Repo ma zero precedensu `count:'exact'`. Idiom repo to „fetch flat rows + agreguj w JS" (już użyte w `shelves/index.ts` sort i `photos/[id].ts` candidatesByDetId Map).
- **Fix ⭐**: Doprecyzuj kontrakt: pobierz `shelf_entries.select('shelf_id').eq('is_current', true)` (RLS-scoped) równolegle z `shelves`, zlicz do `Map<shelf_id,number>` w JS, wypełnij `book_count`. Dwa zapytania total, bez N+1, zgodne z idiomem repo. Filtr `is_current=true` spójny z GET books-on-shelf.
  - Strength: Skaluje do ~1000 wpisów bez problemu (target_scale: small); zero RPC/view.
  - Tradeoff: Dwa zapytania zamiast jednego (akceptowalne).
  - Confidence: HIGH — dokładnie wzorzec już obecny w tym pliku.
  - Blind spot: Brak.
- **Decision**: FIXED (Fix w planie)

### F3 — Blast radius book_count: konkretne testy + ShelfListItem nienazwane

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — realny book_count
- **Detail**: Plan mówi ogólnie „zaktualizować odpowiadające unit testy". Konkretnie pękną: `tests/unit/pages/api/shelves/index.test.ts:87,89,128,131` (asercje `book_count: 0` / `toMatchObject`), oraz fixture `tests/unit/components/PhotoUploader.test.tsx:24`. `src/components/ShelfListItem.tsx:147-149` już renderuje `book_count` (UI gotowe, pokaże realne liczby). POST /api/shelves (nowa półka) słusznie zostaje `book_count: 0`.
- **Fix**: Wymień te pliki explicite w kontrakcie fazy 3 (index.test.ts, PhotoUploader fixture); zaznacz że POST new-shelf zostaje 0, a GET list + GET [id] dostają realny count.
- **Decision**: FIXED (Fix w planie)

### F4 — database.types.ts: regen MUSI być commitowany (CI nie regeneruje)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — regeneracja typów
- **Detail**: `src/lib/db/database.types.ts` jest **git-tracked** (committed), a CI (`ci.yml`) ma tylko `npx wrangler types`, BRAK kroku `supabase gen types`. CI typecheck (`astro check`) czyta commitowany plik. Więc po dodaniu `books.is_read` implementer MUSI zregenerować (`npm run db:types`, skrypt istnieje) I **zacommitować** plik — inaczej CI typecheck nie zobaczy kolumny. Plik jest już w `eslint.config.mjs` ignores (lesson „generated artifacts").
- **Fix**: Dopisz w kontrakcie fazy 1: „zregeneruj `npm run db:types` (wymaga lokalnego stacku/linked) i **zacommituj** database.types.ts — CI nie ma kroku gen-types; offline fallback = ręczny dopis `is_read`".
- **Decision**: FIXED (Fix w planie)
