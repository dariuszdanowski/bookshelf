<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-17 Catalog Description Search

- **Plan**: context/changes/catalog-description-search/plan.md
- **Scope**: Full plan (Phase 1–2 of 2)
- **Date**: 2026-06-06
- **Verdict**: APPROVED (po auto-aplikacji F1+F2; wcześniej NEEDS ATTENTION)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (15/15 pozycji MATCH, zero driftu kontraktowego) |
| Scope Discipline | PASS (guardraile zachowane; adaptacje inline wymuszone typem: `photos/[id].ts` literal, `refine.ts` preservedCandidates, typowane fixtures) |
| Safety & Quality | WARNING → naprawione (F1) |
| Architecture | PASS |
| Pattern Consistency | WARNING → naprawione (F2 stale comment) |
| Success Criteria | PASS (typecheck 0 err · unit 859/859 · E2E 130 pass lokalnie na prod DB z 0019 · CI verify+e2e PASS na 75e6876 i df8c7e7 · integration test zielony w CI · migracja 0019 na prodzie, search_text przeliczony 15/15) |

## Findings

### F1 — Stale description przy re-identyfikacji przez kandydata OL/BN

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/BookModal.tsx:551
- **Detail**: W trybie edit wybór kandydata z OL/BN (zawsze `description: null`) podmieniał tytuł/autorów/ISBN/okładkę, ale PATCH pomijał `description` (spread tylko gdy `!= null`) → stary opis poprzedniej tożsamości książki zostawał i zanieczyszczał `search_text` (full-text znajdowałby książkę po frazie z opisu innej pozycji).
- **Fix**: Sentinel `undefined` w stanie `candidateDescription` (`string | null | undefined`): `undefined` = kandydata nie wybrano → PATCH pomija pole (nie nadpisuje); `null` = wybrano kandydata bez opisu → PATCH wysyła `null` (czyści stary opis). POST add-mode bez zmian semantycznych (`?? null` + filtr).
- **Decision**: FIXED (auto-apply fast-track; zweryfikowane typecheck + unit 859 + E2E unified-book-modal 10/10)

### F2 — Przestarzały komentarz nad UpdateBookSchema

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/lib/books/schema.ts:177
- **Detail**: Komentarz mówił „search_text jest GENERATED z (title, authors, publisher)" — po 0019 lista zawiera też `description`.
- **Fix**: 1-linijkowa aktualizacja komentarza.
- **Decision**: FIXED (auto-apply fast-track)

### F3 — identify.ts apply zawsze nadpisuje description

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/books/[id]/identify.ts:111
- **Detail**: Tryb `apply` ustawia `description: c.description ?? null` bezwarunkowo (nadpisze istniejący opis nullem) — odwrotna semantyka niż PATCH. Dla pełnej re-identyfikacji „replace wholesale" jest jednak spójne z resztą pól (title/authors/ISBN też nadpisywane bezwarunkowo); endpoint legacy bez klienta UI (adnotacja w kodzie :94–96).
- **Decision**: ACCEPTED — semantyka wholesale-replace uznana za poprawną dla re-identyfikacji; endpoint do ewentualnego usunięcia w follow-upie.

## Pominięte jako moot (nie-findingi)

- Truncate `slice(0, 2000)` może rozciąć parę zastępczą (emoji na granicy) → kosmetyka, bez wpływu funkcjonalnego.
- `ADD COLUMN ... GENERATED ... STORED` bierze ACCESS EXCLUSIVE i przepisuje tabelę `books` — migracja już wykonana na prodzie (2026-06-06, ręczny `db push` za zgodą usera), bez incydentu.

## Notatki dowodowe

- Security czyste: opis trafia do `search_text` wyłącznie jako dane kolumny (nigdy jako pattern ILIKE — pattern tylko z `q` usera, escaped `[\%_]`, parametryzacja PostgREST); opis nigdzie nie renderowany w UI (zero powierzchni XSS).
- Data safety: `search_text` w pełni pochodny → DROP COLUMN bez utraty danych; migracja transakcyjna.
- Adaptacja weryfikacji 1.2/2.3: Windows→WSL TCP dropowany (Hyper-V firewall/AV) → dowód SQL przez `docker exec psql` na lokalnym stacku + oficjalny `npm run test:integration` w CI (zielony).
