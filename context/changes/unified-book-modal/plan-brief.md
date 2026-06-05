# Ujednolicone modalne okno książki — Plan Brief

> Full plan: `context/changes/unified-book-modal/plan.md`

## What & Why

Skonsolidować rozproszone ścieżki pracy z książką w jedno DUŻE, reużywalne okno modalne
(`BookModal`) z trybem `add | edit | propose`. Użytkownik jest ostateczną instancją — z poziomu
okna wpisuje dowolny podzbiór danych (nawet sam ISBN), uruchamia identyfikację z baz, „Wyszukaj
okładki", „Szukaj w sieci" i override okładki. Definiowanie zawartości półek (z lub bez zdjęć)
w jednym spójnym miejscu.

## Starting Point

Po S-33 istnieją: `BookDetailModal` (edycja danych + identyfikacja + okładka + akcje, dla książki
zatwierdzonej i read-only kandydata) oraz OSOBNY `ManualAddBook` (formularz dodawania bez akcji
wyszukiwania). Identyfikacja działa tylko dla istniejącej książki (`POST /api/books/[id]/identify`).
Silnik `findBookCandidates` (GB+OL+BN) jest bezDB i reużywalny.

## Desired End State

Jeden `BookModal` w 3 miejscach: dodawanie na półkę (puste pola, pełne akcje, „Wyszukaj po danych"
prefiluje), edycja istniejącej (PATCH + okładka + re-identyfikacja), podgląd kandydata (read-only +
„Szukaj w sieci"). Identyfikacja po częściowych danych / samym ISBN działa też zanim książka istnieje.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Architektura | Jeden komponent `BookModal(mode)` | DRY; konsoliduje 2 komponenty + 3 panele | Plan |
| Wyszukiwanie w add (brak book id) | Nowy read-only `POST /api/books/candidates` | identify wymaga book id; reuse findBookCandidates | Plan |
| ISBN-only / częściowe | Query z wypełnionych pól (min. tytuł lub ISBN) | spełnia „samo ISBN/podzbiór" | Plan |
| propose-mode | Read-only podgląd; confirm zostaje w DetectionReview | bez duplikacji decyzji katalogowych | Plan |
| Okładka w add | Upload działa (ścieżka `{uid}/{uuid}`, RLS po uid) + URL/auto | bucket RLS sprawdza tylko uid (0018) | Plan |
| Zapis | add→`POST /api/books`(shelf_id); edit→`PATCH /api/books/[id]` | endpointy już przyjmują komplet pól | Plan |

## Scope

**In scope:** `BookModal(add/edit/propose)`; bezksiążkowy endpoint `/candidates`; wyszukiwanie po
częściowych danych/ISBN; override okładki w add; podmiana użyć (półka/katalog/review) + usunięcie
`ManualAddBook` i konsolidacja `BookDetailModal`; testy + e2e.

**Out of scope:** migracje/zmiany modelu; przeniesienie confirm kandydata do modala; crop obrazu;
zmiany w vision/BYOK; „dodaj na wiele półek".

## Architecture / Approach

Refaktor-konsolidacja. Backend: jeden read-only endpoint wyszukiwania (reuse `findBookCandidates`).
Frontend: `BookModal` hostuje wspólne pola + sekcję okładki + panel „Wyszukaj po danych"; `mode`
steruje zapisem (POST vs PATCH), źródłem wyszukiwania i read-only. Podmiana w `ShelfBooksIsland`/
`BookCard`/`CatalogSearchIsland`/`DetectionReview`, usunięcie duplikatów.

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Endpoint /candidates | Wyszukiwanie po danych/ISBN bez book id | spójność z identify (auto-extract autora) |
| 2. BookModal(mode) | Jeden duży reużywalny modal | regresja zachowań 3 paneli przy konsolidacji |
| 3. Podmiana + sprzątanie + E2E | Realne użycie, usunięcie duplikatów | regresja testid/e2e w półce/katalogu/review |

**Prerequisites:** merge S-33 (`change/byok-pipeline`) — dostarcza BookDetailModal/ManualAddBook,
endpointy i `findBookCandidates`.
**Estimated effort:** ~2–3 sesje (3 fazy); bez migracji.

## Open Risks & Assumptions

- Konsolidacja 3 paneli w 1 komponent niesie ryzyko regresji UX (okładka/identyfikacja/edycja) —
  mityguje pełny unit + zachowanie `data-testid` + e2e.
- Upload okładki w add bez bookId zakłada RLS po samym segmencie uid (potwierdzone migracją 0018).
- Slice zależny od merge S-33 (niezmergowany branch).

## Success Criteria (Summary)

- Z poziomu jednego dużego okna: dodać książkę na półkę (np. z samego ISBN przez „Wyszukaj po danych"),
  edytować istniejącą (pola + okładka), podejrzeć kandydata.
- Zero regresji: toggle read, przenoszenie, wyszukiwarka katalogu, identyfikacja edycyjna.
