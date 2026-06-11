<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cofnięcie akceptacji książki (unconfirm)

- **Plan**: context/changes/detection-unconfirm/plan.md
- **Scope**: Phase 1 + Phase 2 (all phases — full plan review)
- **Date**: 2026-06-12
- **Verdict**: APPROVED (2 warnings fixed inline under Fast Track)
- **Findings**: 0 critical, 2 warnings (fixed), 2 observations (fixed)

## Verdicts

| Dimension | Verdict |
|---|---|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (WARNING fixed — F2) |
| Architecture | PASS |
| Pattern Consistency | PASS (WARNING fixed — F1) |
| Success Criteria | PASS |

## Automated Verification

| Check | Result |
|---|---|
| `npm run test -- unconfirm` (7 unit tests) | ✅ PASS 7/7 |
| `npm run lint` | ✅ PASS 0 errors |
| `npx astro check` | ✅ PASS 0 errors, 0 warnings |
| `npm run build` | ✅ PASS |
| Integration RLS (confirmed by SHA acd4314) | ✅ PASS |

## Manual Verification

- **2.6** Realny flow: Akceptuj → Cofnij → książka znika z półki, detekcja wraca — ✅ potwierdzony przez usera
- **2.7** Re-akceptacja po cofnięciu nie dubluje wpisu — ✅ potwierdzony przez usera

## Findings

### F1 — Brak `code` w logu nieoczekiwanego błędu endpointu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/detections/[id]/unconfirm.ts:33
- **Detail**: `console.error` logował tylko `name` i `message`, tracąc pole `code` z PostgrestError (np. `42501`, `PGRST116`). Sibling `confirm.ts` loguje `{ name, message, code }`. Różnica utrudnia diagnozy w prod.
- **Fix**: Dodano `code: (err as { code?: string }).code` do obiektu logu — zgodnie z wzorcem z confirm.ts.
- **Decision**: FIXED

### F2 — Brak logu gdy DELETE orphan book się nie powiedzie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/books/confirm.ts:248
- **Detail**: `await supabase.from('books').delete().eq('id', bookId)` nie sprawdzał błędu. Silent failure → książka-sierota pozostaje w katalogu bez żadnego `shelf_entry` → unikatowy indeks `books_user_isbn13` może zablokować re-akceptację tej samej książki. Ryzyko niskie (delete własnej książki pod RLS rzadko zawiedzie), ale brak logu maskuje incydenty.
- **Fix**: Przechwycono `bookDeleteError`; dodano `console.error('[unconfirm] orphan book delete failed', { bookId, name, code })`. Operacja pozostaje best-effort (nie rzuca).
- **Decision**: FIXED

### F3 — N+1 w pętli orphan-safety bez komentarza uzasadnienia

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/books/confirm.ts:240
- **Detail**: Pętla `for (bookId of bookIds)` wykonuje SELECT count + opcjonalny DELETE per book_id. Strukturalnie N+1, ale `bookIds.length ≤ 1` w praktyce (1 detection → 1 shelf_entry). Brak komentarza sprawiał, że kod wyglądał jak nieoptymalizowany gap.
- **Fix**: Dodano komentarz `// detection → 1 shelf_entry → bookIds.length ≤ 1 (O(1) w praktyce)`.
- **Decision**: FIXED

### F4 — `_userId` dead parameter bez dokumentacji intencji

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/books/confirm.ts:208
- **Detail**: `_userId` przyjęty w sygnaturze ale nieużywany — autoryzacja delegowana do RLS przez `locals.supabase`. Bez komentarza nieoczywiste, czy parametr jest celowo ignorowany czy przez pomyłkę.
- **Fix**: Dodano inline komentarz wyjaśniający RLS-delegation i symetrię z `confirmDetectionToCatalog`.
- **Decision**: FIXED
