<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-17 Catalog Description Search

- **Plan**: context/changes/catalog-description-search/plan.md
- **Mode**: Deep
- **Date**: 2026-06-06
- **Verdict**: REVISE → **SOUND po fixach** (wszystkie findingi zaaplikowane inline — Fast track auto-apply)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS po F1 |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS po F2/F4 |
| Plan Completeness | WARNING → PASS po F3/F5 |

## Grounding

10/10 paths ✓ (`identify.ts` istnieje — Test-Path wymagał LiteralPath dla `[id]`), `books_search_text` 3-arg GENERATED w 0011 potwierdzony ✓, najwyższa migracja 0018 → numer 0019 wolny ✓, brief↔plan ✓.

## Findings

### F1 — Per-book backfill prowadził przez martwy endpoint identify

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — realna korekta trasy, ale jasny zwycięzca
- **Dimension**: End-State Alignment
- **Location**: Phase 2 #4, Key Discoveries, Key Decisions (brief)
- **Detail**: Plan opierał „ręczny per-book backfill" na `POST /api/books/[id]/identify` (apply). Weryfikacja kodowa: po refaktorze unified-book-modal ŻADEN komponent UI nie woła identify (tylko unit test — legacy). Realny flow „Wyszukaj po danych" = BookModal → `POST /api/books/candidates` (read-only) → `handleCandidateSelect` (enumeruje 6 pól, `BookModal.tsx:404–418`, opis by się zgubił) → `POST /api/books` / `PATCH /api/books/[id]`. Obiecany refresh starych książek nie zmaterializowałby się.
- **Fix ⭐ Recommended**: propagacja przez BookModal w OBU trybach (add: `AddPurchaseSchema` `.strict()` + POST; edit: schema PATCH + `books/[id].ts`), `SearchCandidate` + ukryty stan; `identify.ts` dostaje pole 1-liniowo dla kompletności z adnotacją legacy.
  - Strength: trasa przez realnie używany kod; edit-mode = działający per-book backfill.
  - Tradeoff: +2 pliki (`books/[id].ts`, schema PATCH) względem pierwotnego zakresu.
  - Confidence: HIGH — flow zweryfikowany w kodzie z file:line.
  - Blind spot: czy ukryty stan opisu powinien się czyścić przy ręcznej edycji tytułu po wyborze kandydata (decyzja implementacyjna, niskie stawki).
- **Decision**: FIXED (auto-apply, Fast track)

### F2 — Inwentarz ścieżek niekompletny (3 INSERTy, 5 enumerowanych SELECTów)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots / Plan Completeness
- **Location**: Phase 2 #3/#4
- **Detail**: Plan wymieniał 1 miejsce insertu kandydatów; w kodzie są 3 (match.ts:451–466/502–505, rematch.ts:156–174, refine.ts:333–349) — wszystkie enumerowane, zero spreadów. Dodatkowo enumerowane SELECTy: confirm.ts:89–94, confirm-batch.ts:90–94, correct.ts:99–106, match.ts:248, rematch.ts:174 (returning). Bez nich opis = null na ścieżkach rematch/refine/correct.
- **Fix**: jawna lista plików z liniami w Phase 2.
- **Decision**: FIXED (auto-apply)

### F3 — AddPurchaseSchema jest `.strict()` — niejawne „dołącz description" = 400

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #4
- **Detail**: `books/schema.ts:244–267` — `.strict()` odrzuci nieznane pole; plan mówił ogólnie „BookModal dołącza description do payloadu".
- **Fix**: jawny kontrakt: pole w `AddPurchaseSchema` + schemie PATCH + typ `SearchCandidate` + ukryty stan (nie `BookFieldValues`).
- **Decision**: FIXED (auto-apply, w ramach F1)

### F4 — `npm run test:integration` lokalnie bije w REMOTE PROD bez migracji

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Blind Spots
- **Location**: Phase 1 Success Criteria 1.2
- **Detail**: `vitest.integration.config.ts:11–39` czyta `.dev.vars` (u developera = remote prod). Pre-merge kolumn 0019 tam nie ma → test padnie; testy tworzą realnych userów przez `auth.admin.createUser` (zombie przy przerwaniu).
- **Fix**: kryterium 1.2 scoped do CI / lokalnego stacku WSL; test w pattern `describe.skip` + timestamp + `afterAll` cleanup; nota w Critical Implementation Details.
- **Decision**: FIXED (auto-apply)

### F5 — Blast radius REQUIRED pola: 5 typowanych miejsc, nie 3

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details
- **Detail**: Poza 3 mapperami typecheck złamią: literal `match.ts:411–422` (parametr `checkCatalogDuplicate`) i `dedupe.test.ts:5–19` (`makeCandidate(): ScoredCandidate`). Untyped fixtures bez zmian.
- **Fix**: dopisane do Critical Implementation Details.
- **Decision**: FIXED (auto-apply)
