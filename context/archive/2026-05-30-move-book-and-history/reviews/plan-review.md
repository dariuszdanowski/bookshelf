<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Move Book Between Shelves + Versioned Location History (S-07)

- **Plan**: context/changes/move-book-and-history/plan.md
- **Mode**: Deep
- **Date**: 2026-05-30
- **Verdict**: REVISE → SOUND po triage (F1 Fix A zaaplikowany)
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding
7/7 paths ✓, move endpoint absent (expected) ✓, 0 existing `.rpc(` calls in src ✓, brief↔plan ✓

## Findings

### F1 — `supabase.rpc('move_book_to_shelf')` nie przejdzie typecheck w branchu

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — funkcja Postgres + endpoint
- **Detail**: `database.types.ts:458-460` ma `Functions: { [_ in never]: never }` (puste). `locals.supabase` to `SupabaseClient<Database>` (`env.d.ts:36-41`), więc `rpc('move_book_to_shelf', …)` jest nieprzypisywalny → błąd TS pod `astro/tsconfigs/strict`. `database.types.ts` regeneruje się TYLKO z żywej DB; migracja idzie na prod dopiero po merge (branch-per-change), lokalny stack AV-blocked. Branch nie ma jak wygenerować typu funkcji → automaty Phase 1 (typecheck) padają. Brak precedensu rpc w repo.
- **Fix A ⭐ Recommended**: Endpoint robi dwa typowane zapisy bez rpc/funkcji; INSERT nowego bieżącego (max+1 na docelowej), potem UPDATE starego → `is_current=false`. Bez partial unique index (kolejność insert-first wymaga braku indeksu). Historia zachowana (stary wpis = historyczny).
  - Strength: W pełni typowane (`.from().insert()` / `.update()`), zero hacków na generated file, zgodne z istniejącym non-atomic multi-write w `confirm.ts` (świadomie zaakceptowanym w S-05). Insert-first → książka **nigdy nie znika** (najwyżej chwilowo na 2 półkach przy rzadkim błędzie sieci, widoczna i naprawialna).
  - Tradeoff: FR-029 „dokładnie jedna półka" egzekwowane tylko app-level (status quo — dziś też brak constraintu); brak atomowości (okno na podwójną lokalizację przy awarii między dwoma zapisami).
  - Confidence: HIGH — `confirm.ts` już tak działa i przeszło review.
  - Blind spot: brak.
- **Fix B**: Atomowy BEFORE UPDATE trigger na `shelf_entries` (snapshot OLD → wiersz `is_current=false` przy zmianie `shelf_id`) + partial unique index; endpoint robi zwykły typowany `.update({ shelf_id, position_index })`.
  - Strength: Atomowy (jedna transakcja), FR-029 egzekwowane w DB, w pełni typowany (zwykły update, nie rpc), trigger to ustalony wzorzec repo.
  - Tradeoff: „Magia" — UPDATE cicho tworzy wiersz historii; migracja z triggerem testowana dopiero na prod `db push`.
  - Confidence: MED — trigger snapshot-on-update mniej oczywisty niż triggery walidacyjne; nietestowalny lokalnie.
  - Blind spot: zachowanie triggera przy przyszłych innych UPDATE-ach na `shelf_entries`.
- **Decision**: FIXED via Fix A (user, 2026-05-30) — plan przeprojektowany na dwa typowane zapisy, bez migracji/funkcji/indeksu.

### F2 — Partial unique index może nie zbudować się na brudnych danych prod

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — migracja 0012
- **Detail**: Plan zakładał, że każda książka ma dokładnie jeden `is_current=true`. Agent zweryfikował: prawda dla normalnych flow, ale istnieje dziura (ISBN-less re-confirm po nieudanym `detections.status` UPDATE — `confirm.ts:150-163`, znana z S-05 plan-review F). Jeśli prod ma duplikat, `CREATE UNIQUE INDEX` padnie.
- **Fix**: Moot jeśli F1→Fix A (brak indeksu). Jeśli F1→Fix B: przed/wraz z migracją zweryfikuj prod (`select book_id from shelf_entries where is_current group by book_id having count(*)>1`); index i tak retroaktywnie domyka dziurę (kolejny duplikat → 23505 zamiast cichego dubla).
- **Decision**: DISMISSED — moot, F1→Fix A nie dodaje indeksu.

### F3 — E2E zależy od ścieżki ręcznego zakupu (S-06)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — E2E
- **Detail**: E2E seeduje książkę przez Flow B manual (bez vision → zero kosztu LLM), co jest poprawne, ale wiąże test move z UI add-purchase. Jeśli ten flow się zmieni, test move stanie się kruchy.
- **Fix**: Akceptowalne — to najtańszy bezkosztowy seeding. Odnotować zależność w komentarzu spec.
- **Decision**: ACCEPTED — zależność odnotowana w planie (komentarz w spec).
