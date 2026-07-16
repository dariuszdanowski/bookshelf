# Jeden punkt wejścia do edycji detekcji — Krótki plan

> Pełny plan: `context/changes/unify-detection-edit-entrypoint/plan.md`
> Krótki opis ramowy: `context/changes/unify-detection-edit-entrypoint/frame.md`

## Co i dlaczego

Karta detekcji ma dziś trzy rozjechane, częściowo nakładające się ścieżki edycji (RematchForm-search,
CorrectForm-manual, BookModal.propose-search+edit) rozproszone na dwa niespójne stany
(match/no-match), zamiast jednego spójnego punktu wejścia do „wszystkiego poza Akceptuj/Odrzuć" —
zgodnie z pierwotną intencją `unified-book-modal` (2026-06-06), która nigdy nie objęła stanu
no-match. Ten change dowozi tę intencję do końca.

## Punkt wyjścia

`BookModal mode="propose"` już ma pełne pola, „Wyszukaj po danych" z prefillem i dwuetapowy zapis
(PATCH draft → POST confirm) — ale jest twardo zablokowany bez istniejącego `candidate.id`. Dla
stanu no-match dziś nie ma żadnej klikalnej okładki/placeholdera — tylko tekst + dwa przyciski
(„Szukaj po tytule" → RematchForm auto-persist; „Wpisz ręcznie" → CorrectForm jednoetapowy zapis,
inny endpoint niż obie pozostałe ścieżki).

## Pożądany stan końcowy

Klik okładki (albo placeholdera dla no-match) w KAŻDYM z 3 widoków karty (Karty/Lista/Kafelki)
otwiera ten sam `BookModal`: pełna edycja, wyszukiwanie, „Oryginalny odczyt OCR" (nowość: działa
też dla no-match i dla match), jeden model zapisu (draft→confirm) wszędzie. RematchForm,
CorrectForm i osobny endpoint `/correct` znikają.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Jak propose zdobywa id dla no-match | Draft-kandydat tworzony przy otwarciu (`POST /candidate`) | Reużywa istniejący PATCH/confirm flow bez zmiany kontraktu | Plan (pytanie usera) |
| Semantyka zapisu | Jeden model wszędzie (draft→confirm) | Jeden kod, łatwiejsze utrzymanie; correct.ts staje się zbędny | Plan (pytanie usera) |
| Konsolidacja 3 widoków | Wspólny komponent dla Lista+Kafelki (niemal 1:1 kopie); Karty osobno (realnie różne) | Oparte na dowodach z researchu — usuwa realny dług, nie fikcyjny | Plan (pytanie usera) |
| „Oryginalny odczyt OCR" | Dostępny w obu stanach (match i no-match) wewnątrz BookModal | Spójne z zasadą „wszystko w jednym miejscu" | Plan (pytanie usera) |
| Placeholder okładki no-match | Reużyty `CoverImage` (już ma fallback dla `url=null`), interakcja 1:1 jak `candidate-cover-button` | Zero nowego assetu — user zauważył że wzorzec już istnieje dla match | Plan (doprecyzowanie usera w trakcie) |
| Martwa gałąź `field_edit` | Usunięta w Fazie 5 | Zero funkcjonalnego ryzyka (nieosiągalna z UI), już dotykamy ten plik | Plan (pytanie usera) |
| `WebSearchButton` vs `googleSearchUrl()` | Scalone w jeden wspólny helper | Druga realna duplikacja znaleziona w researchu, mały koszt | Plan (pytanie usera) |
| Podział testów na fazy | Testy razem z każdą fazą + finalny E2E sweep (Faza 6) | Zgodne z konwencją repo „testy razem ze zmianą" | Plan (pytanie usera) |

## Zakres

**W zakresie:** migracja DB (`book_candidates.source` + `'manual'`), nowy `POST`/`DELETE
/api/detections/[id]/candidate` (draft lifecycle), „Oryginalny odczyt OCR" w BookModal,
placeholder okładki dla no-match (3 widoki), konsolidacja Lista+Kafelki, usunięcie
RematchForm/CorrectForm/correct.ts/martwego `field_edit`, dedup WebSearchButton/googleSearchUrl(),
pełny sweep testów jednostkowych i E2E.

**Poza zakresem:** `RefineButton`/`/api/detections/[id]/refine` (bez zmian), `ai-resolution-search-tool`
(osobny równoległy change), `confirm.ts`/`confirmDetectionToCatalog` (bez zmian kontraktu),
backfill istniejących wierszy `book_candidates`.

## Architektura / Podejście

Klik placeholdera/okładki → (dla no-match) `POST /candidate` tworzy draft z `source='manual'` →
mount `BookModal mode="propose"` identycznie jak dla istniejącego kandydata → Zapisz (`PATCH
/candidate`) → Zatwierdź (`POST /confirm`, niezmieniony). Zamknięcie bez zapisu → `DELETE
/candidate` sprząta draft. Karty/Lista/Kafelki dzielą tę samą logikę (`useDetectionDecision`),
różni się tylko JSX — Lista+Kafelki konsolidowane w `DetectionActionsRow`, Karty zostają osobno.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Backend | Migracja + POST/DELETE draft-kandydata | Migracja musi przejść PRZED czymkolwiek innym (twardy prerequisite) |
| 2. BookModal | „Oryginalny odczyt OCR" w propose | Musi replikować obie gałęzie handleUseOriginal (z/bez historii) |
| 3. Placeholder + wpięcie ×3 | UI dla no-match we wszystkich widokach | Sprzątanie porzuconych draftów (DELETE) — łatwo przeoczyć |
| 4. Konsolidacja Lista+Kafelki | `DetectionActionsRow` | Czysty refaktor — regresja = zmiana zachowania, nie tylko stylu |
| 5. Sprzątanie | Usunięcie RematchForm/CorrectForm/correct.ts/dedup WebSearch | Ostatnie call site'y „Szukaj po tytule" żyją w stanie MATCH, nie tylko no-match |
| 6. E2E sweep | Aktualizacja 4 spec'ów + manualny smoke | manual-rematch.spec.ts wymaga przepisania, nie tylko poprawek |

**Wymagania wstępne:** brak (moduł izolowany od `ai-resolution-search-tool`, który biegnie
równolegle na innym branchu).
**Szacowany nakład pracy:** ~2-3 sesje, 6 faz — duży refaktor UI + jedna migracja DB.

## Otwarte ryzyka i założenia

- Zakładamy że `detections.raw_title` jest wystarczającym fallbackiem dla `title` draftu (NOT
  NULL, ale może być pusty string) — jeśli okaże się mylące w UI, można dodać placeholder tekst
  w Fazie 3 bez zmiany kontraktu backendu.
- `manual-rematch.spec.ts` (Faza 6.1) wymaga realnego przepisania scenariuszy, nie tylko zmiany
  selektorów — ryzyko niedoszacowania czasu tej fazy.

## Kryteria sukcesu (podsumowanie)

- Klik okładki/placeholdera w każdym z 3 widoków otwiera ten sam, w pełni funkcjonalny BookModal
  (wyszukiwanie + Oryginalny odczyt OCR + zapis) — zarówno dla match, jak i no-match.
- Zero osieroconych wierszy `book_candidates` po otwarciu-i-porzuceniu edycji.
- `RematchForm`, `CorrectForm`, `/api/detections/[id]/correct` nie istnieją w kodzie po Fazie 5.
