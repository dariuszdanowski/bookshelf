<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Proposal Accept → Catalog (S-05)

- **Plan**: context/changes/proposal-accept-to-catalog/plan.md
- **Scope**: Pełny plan (Fazy 1–6)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria
Automated: typecheck 0 errors, lint clean, vitest 378/378, build complete, E2E 9/9 (S-05 spec). Manual (1.1 migracja na remote, 1.6/2.8 Studio) deferred-by-design do post-merge — pending, nie oznaczone jako done.

## Findings

### F1 — Niesprawdzane zapisy w confirm helper (orphan book + retry-dup)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/books/confirm.ts:109-143
- **Detail**: Tylko insert `books` (linia ~82) sprawdza `error`. Trzy kolejne zapisy połykają błędy: (a) `shelf_entries` insert — jeśli padnie, książka istnieje w katalogu BEZ wpisu półkowego → niewidoczna w `/shelves/[id]/books`, a pre-check dup (isbn_13) znajdzie ją przy następnej próbie → user permanentnie zablokowany; dla książek bez ISBN retry tworzy duplikat. (b) `detections.update status='confirmed'` — jeśli padnie, guard idempotencji nie zadziała przy retry → drugi `books` row. (c) `corrections` — telemetria, low-impact. Plan zaakceptował „bez transakcji", ale to nie to samo co „nie obserwować błędów".
- **Fix A ⭐ Recommended**: Sprawdź błędy `shelf_entries` insert + `detections` update; przy porażce `shelf_entries` best-effort skasuj świeżo utworzoną książkę (manual rollback) i zwróć `{ok:false, reason:'write_failed'}` (endpoint→500); loguj `{name,message,code}`.
  - Strength: Eliminuje orphan + retry-dup; ścieżka staje się retry-safe; spójne z „no-data-loss" guardrail NFR.
  - Tradeoff: Dokłada rollback-delete i nowy wariant wyniku helpera (caller mapuje na 500).
  - Confidence: HIGH — rollback to jeden dodatkowy `.delete().eq('id',bookId)`.
  - Blind spot: Sam rollback-delete też może paść (skrajnie rzadkie); zostaje log.
- **Fix B**: Tylko obserwuj + loguj błędy trzech zapisów i zwróć `write_failed` przy porażce `shelf_entries`, bez rollbacku.
  - Strength: Minimalna zmiana, diagnozowalność.
  - Tradeoff: Orphan book zostaje przy rzadkiej porażce (user-trapping dla isbn books).
  - Confidence: HIGH — czyste dodanie destrukturyzacji error + console.error.
  - Blind spot: Nie usuwa user-trap, tylko czyni go widocznym w logach.
- **Decision**: FIXED (Fix A — rollback + error-check)

### F2 — confirm-batch: brak try/catch per item (jeden throw wywraca cały batch)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/photos/[id]/confirm-batch.ts:123-150
- **Detail**: Pętla woła helper bez try/catch. Helper zwraca `{ok:false}` dla dup/already_confirmed (→skipped, OK), ale RZUCA przy nie-23505 błędzie books insert. Rzucony błąd propaguje → unhandled rejection → 500 dla całego batcha, gubiąc partial-success accounting (confirmed/skipped). Jeden zły item psuje wszystkie.
- **Fix**: Owiń per-item `await confirmDetectionToCatalog(...)` w try/catch; przy throw push do `skipped` z `reason:'error'`.
- **Decision**: FIXED (try/catch per item)

### F3 — Martwy kod w handleDecided (DetectionReview)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Reliability)
- **Location**: src/components/DetectionReview.tsx:563-573
- **Detail**: Blok `setDetections((prev) => {...})` liczy `remaining`, ma pusty `if` body i `return prev` (zero zmiany stanu). Czysty no-op — pozostałość po porzuconym podejściu „filtruj zdecydowane". Redirect działa poprawnie przez osobny `useEffect` (functional setters, świeży stan — zweryfikowane, brak stale-closure bug). Martwy blok czyta `decidedIds` (stale) w updaterze — nieszkodliwe bo wynik odrzucony, ale zaprasza przyszłego edytora do „naprawy" wprowadzającej realny bug.
- **Fix**: Usuń blok `setDetections` z `handleDecided` (linie ~566-572); redirect `useEffect` już posiada logikę „all decided".
- **Decision**: FIXED (usunięty martwy kod)

### F4 — DRIFT: plan obiecał realny book_count w GET /api/shelves/[id], którego endpoint nie ma

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/shelves/[id].ts (Faza 3 #3 kontrakt)
- **Detail**: Kontrakt Fazy 3 mówił „`ShelfDTO.book_count` w GET list **+ GET [id]** wypełniony realnie" i wymieniał `shelves/[id].ts`. Faktycznie `[id].ts` NIE ma GET handlera (tylko PATCH/DELETE), a PATCH zwraca hardcoded `book_count: 0`. Brak trasy `GET /api/shelves/[id]` w repo → brak żywego konsumenta realnego count tam (strona `.astro` czyta `name` bezpośrednio, island fetchuje `/books`). Niska blast-radius, ale literalne odstępstwo od zapisanego kontraktu.
- **Fix**: Align plan — usuń „+ GET [id]" z kontraktu Fazy 3 (nie ma takiej trasy; PATCH słusznie zostaje 0). Adaptacja literalna, oflagować w `/10x-archive`.
- **Decision**: FIXED (align plan)

### F5 — RLS shelf_entries waliduje tylko book_id, nie shelf_id (latentne)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Security)
- **Location**: supabase/migrations/0002_rls_policies.sql (shelf_entries_insert_own)
- **Detail**: Polityka sprawdza tylko `exists(books where id=book_id and user_id=auth.uid())`. User mógłby wstawić własną książkę na CUDZĄ półkę (shelf_id). S-05 tego NIE eksponuje — `confirm.ts`/`correct.ts`/`confirm-batch.ts` biorą `shelfId` z `photo.shelf_id` (server-side, RLS-scoped, nigdy z body). Luka jest latentna dla przyszłego endpointu przyjmującego shelf_id z klienta (S-07 move-book?).
- **Fix**: Backlog/lesson — dociśnij politykę o `exists(shelves where id=shelf_id and user_id=auth.uid())` ZANIM zjawi się endpoint z client-supplied shelf_id. Poza scope S-05.
- **Decision**: ACCEPTED-AS-RULE + FIXED (lekcja + migracja 0009)

### F6 — Nested select dla shelfHint: połknięty błąd + brak filtra is_current

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/books/confirm.ts:64-79
- **Detail**: `.select('id, shelf_entries(shelf_id, shelves(name))')` — składnia poprawna (FK embed), ale (a) nie destrukturyzuje `error` → malformed embed/RLS quirk daje `existing=undefined` → dup-check pominięty, ale `23505` backstop i tak złapie duplikat (fail-safe dla blokady, traci tylko shelfHint); (b) embedded `shelf_entries` nie filtrowane `is_current=true` → `[0]` może być stare placement. Oba minor.
- **Fix**: Opcjonalnie destrukturyzuj error dla observability; nie blokujące.
- **Decision**: SKIPPED (fail-safe)
