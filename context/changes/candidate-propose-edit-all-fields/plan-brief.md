# Popraw jako pełna edycja propozycji kandydata — Krótki plan

> Pełny plan: `context/changes/candidate-propose-edit-all-fields/plan.md`

## Co i dlaczego

Dzisiejsze „Popraw" edytuje pola i **natychmiast** zatwierdza detekcję jako książkę w jednym kroku — user nie może poprawić danych i zostawić decyzji o katalogowaniu na później. Zastępujemy to dwuetapowym flow: w pełni edytowalny modal propozycji z osobnym „Zapisz" (do kandydata, bez zatwierdzania) i osobnym, jawnym „Zatwierdź" (do katalogu).

## Punkt wyjścia

`BookModal mode="propose"` już istnieje i (po poprzedniej zmianie, `candidate-cover-override`) ma edytowalną okładkę z własnym „Zapisz okładkę". Reszta pól (tytuł, autorzy, ISBN, wydawca, rok) jest tam dziś read-only — edycja idzie przez osobny, znikający po użyciu formularz `CorrectForm mode="field_edit"`, który łączy edycję z natychmiastowym zatwierdzeniem.

## Pożądany stan końcowy

Klik „Popraw" (Karty/Lista/Kafelki) otwiera ten sam modal propozycji, teraz w pełni edytowalny (włącznie z ISBN i danymi zakupu). „Zapisz" persystuje zmiany do kandydata i zostaje w modalu. „Zatwierdź" — jeśli są niezapisane zmiany, pyta o potwierdzenie zapisu przed zatwierdzeniem; jeśli nie, zatwierdza od razu przez istniejący, niezmieniony endpoint.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Liczba akcji w modalu | Zapisz + Zatwierdź + Anuluj (3) | Rozdziela dwie różne intencje usera — edytować vs zatwierdzić | Rozmowa |
| Zapis okładki + metadanych | Jeden wspólny „Zapisz" | Spójne z istniejącym unify-book-save w add/edit | Rozmowa |
| Telemetria korekt | Nowa kolumna `edited_at` na kandydacie | Minimalna migracja, zero utraty istniejącej semantyki `accept` | Rozmowa |
| Stary `/correct` (field_edit) | Usunięty całkowicie | Nowy flow go w pełni zastępuje, brak dwóch ścieżek do tego samego celu | Rozmowa |
| Kształt endpointu | Rozszerzenie `cover.ts` → ogólny `candidate.ts` | Jeden endpoint, jeden kontrakt, spójne z jednym „Zapisz" | Rozmowa |
| Wyszukaj po danych w propose | Dostępny | User może doszukać innego kandydata bez zamykania modala | Rozmowa |
| Sekcja zakupu w propose | Widoczna i edytowalna, nowe kolumny na kandydacie | User chce edytować dane zakupu już na etapie propozycji | Rozmowa |
| Zatwierdź z niezapisanymi zmianami | Dialog: zapisz-i-zatwierdź / anuluj | Nie gubi pracy usera, ale wymaga jawnej zgody zamiast cichego auto-save | Rozmowa |

## Zakres

**W zakresie:**
- Rozszerzenie `book_candidates` o `edited_at` + 4 kolumny zakupu (migracja)
- Uogólnienie `PATCH /api/detections/[id]/cover` → `.../candidate` (wszystkie edytowalne pola)
- `confirm.ts` + `confirm-batch.ts` — telemetria `field_edit` z `edited_at`, fallback zakupu kandydat??photo
- `BookModal mode="propose"` — pełna edycja, 3 akcje, dirty-check dialog
- Wiring w 3 widokach `DetectionReview.tsx` (Karty/Lista/Kafelki) — Lista dostaje nowe wejście do modala
- Usunięcie wariantu `field_edit` z `CorrectDetectionSchema`/`correct.ts`

**Poza zakresem:**
- Wariant `manual_entry` (detekcja bez kandydata) — bez zmian
- `RematchForm` (Szukaj po tytule) — osobna, niezmieniana ścieżka
- Ostrzeżenie przy zamknięciu modala (X/Anuluj) z niezapisanymi zmianami — tylko Zatwierdź ma dirty-check
- Przenoszenie edycji/danych zakupu kandydata przez rematch/refine (te akcje zastępują wiersz kandydata świeżym wyszukiwaniem, jak dziś)

## Architektura / Podejście

`confirm.ts` już dziś czyta świeże dane kandydata z DB przy zatwierdzaniu — kluczowa obserwacja, która czyni to podejście tanim: wystarczy PATCH-ować `book_candidates` PRZED wywołaniem istniejącego, niezmienionego `/confirm`, żeby edycje automatycznie popłynęły do nowej książki. Jedyny prawdziwy dodatek to `edited_at` (telemetria) i override danych zakupu (nowe kolumny, bo `book_candidates` ich nie miało).

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Migracja + endpoint + telemetria | `book_candidates` rozszerzony, endpoint uogólniony, `confirm`/`confirm-batch` świadome edycji | Trzecia kopia logiki w `confirm-batch.ts` — łatwo pominąć |
| 2. BookModal — propose edytowalny | 3 akcje (Zapisz/Zatwierdź/Anuluj), dirty-check dialog | Sekwencja zapis→zatwierdź musi być atomowa z perspektywy usera |
| 3. Wiring 3 widoków | Popraw wszędzie otwiera ten sam modal; Lista dostaje nowe wejście | Kafelki ma dziś DWIE ścieżki do scalenia w jedną |
| 4. Testy | Jednostkowe + E2E dla nowego flow, usunięcie testów field_edit | Duży refaktor testowy — łatwo zostawić martwe asercje |

**Wymagania wstępne:** `candidate-cover-override` już zmergowany do `main` (propose-mode CoverEditor jako baza).
**Szacowany nakład pracy:** ~4 fazy, jedna sesja per faza.

## Otwarte ryzyka i założenia

- Telemetria `field_edit` po tej zmianie nie niesie już porównania „przed vs po" (tylko finalną wartość) — świadomy downgrade, akceptowalny wobec wcześniejszej słabej jakości tego sygnału.
- Kafelki dziś ma dwie równoległe ścieżki do tego samego kandydata (klik okładki + Popraw) — scalenie w jedną instancję modala zakłada, że to był dług techniczny, nie świadomy projekt.

## Kryteria sukcesu (podsumowanie)

- „Popraw" na dowolnym z 3 widoków otwiera w pełni edytowalny modal propozycji z osobnymi Zapisz/Zatwierdź
- Zatwierdzona (po edycji) książka ma wszystkie edytowane pola, włącznie z ISBN i danymi zakupu
- Historia korekt poprawnie rejestruje `field_edit` dla tego flow
