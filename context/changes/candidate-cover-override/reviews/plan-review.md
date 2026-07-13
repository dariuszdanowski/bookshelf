<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Candidate cover override

- **Plan**: context/changes/candidate-cover-override/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-13
- **Werdykt**: SOLIDNY
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia, 0 obserwacji

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | OSTRZEŻENIE |
| Kompletność planu | OSTRZEŻENIE |

## Ugruntowanie

Grounding: 6/6 ścieżek ✓, 5/5 symboli ✓, brief↔plan ✓. Głęboka weryfikacja (1 subagent, 5 twierdzeń): wszystkie 5 potwierdzone (Lista bez podglądu kandydata, `onRefined` realnie wpięty do `setDetections`, `BookModalBook`/`candidateToDetail` mają dokładnie 2 miejsca użycia, ścieżka uploadu per-uid nie wymaga zmian RLS). Dodatkowo zweryfikowałem samodzielnie: `confirm-batch.ts:97,148` również świeżo czyta `book_candidates.cover_url` — bulk-accept automatycznie skorzysta z ustawionej okładki mimo że UI dla bulk jest poza zakresem (potwierdza słuszność decyzji o zakresie).

## Ustalenia

### F1 — Brakuje cytowania bliższego precedensu dla endpointu PATCH

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja, poprawka oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1, punkt 2 (endpoint) + sekcja Referencje
- **Szczegóły**: Plan cytuje `confirm.ts:92-112` jako wzorzec select-before-update. Weryfikacja podagenta znalazła bliższy strukturalnie precedens: `src/pages/api/detections/[id]/bbox.ts` — ten sam katalog, ten sam czasownik PATCH, ten sam kształt „wąska aktualizacja jednego pola" (auth guard → parseUuidParam → Zod → update+select → 404-if-empty). `confirm.ts` jest `POST` i robi pełną logikę accept-to-catalog — mniej trafny mirror dla samego kształtu endpointu, choć nadal poprawny dla wzorca podwójnego sprawdzenia ownership (detekcja I kandydat), którego `bbox.ts` nie potrzebuje (bbox dotyczy tylko jednej detekcji).
- **Poprawka**: Dopisz `bbox.ts` jako dodatkowy wzorzec w Referencjach i w Kontrakcie Fazy 1 punkt 2 — implementator powinien spojrzeć na oba: `bbox.ts` dla kształtu PATCH/pliku, `confirm.ts` dla podwójnego sprawdzenia ownership (detekcja + kandydat).
- **Decyzja**: NAPRAWIONE — dopisano `bbox.ts` do Referencji i Kontraktu Fazy 1 punkt 2.

### F2 — Nadpisana okładka kandydata ginie przy kolejnym rematch/refine

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis, warto się zatrzymać
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Pożądany stan końcowy / Czego NIE robimy
- **Szczegóły**: `rematch.ts`/`refine.ts` (gdy `shouldReplace` jest `true`) usuwają istniejące wiersze `book_candidates` i wstawiają nowe (nowe `id`) z wynikami wyszukiwania. Jeśli user ustawi okładkę kandydata przez nową funkcję, a POTEM (przed zatwierdzeniem) zrobi kolejne „Szukaj po tytule"/„Doprecyzuj odczyt" które zastąpi kandydatów — ręcznie ustawiona okładka znika bezpowrotnie razem ze starym wierszem, bez ostrzeżenia. Analogiczny mechanizm do niedawno naprawionego problemu z historią OCR (`weak-match-resolve-and-ocr-audit`), ale tym razem NIE objęty żadną naprawą w tym planie.
- **Poprawka A ⭐ Recommended**: Zaakceptuj jako świadome ograniczenie — dopisz jedno zdanie do „Czego NIE robimy": „Nadpisana okładka kandydata nie przetrwa kolejnego rematch/refine na tej samej detekcji (wiersz book_candidates jest usuwany i zastępowany) — user musi ustawić okładkę PO ostatnim wyszukiwaniu, przed zatwierdzeniem."
  - Siła: Zero dodatkowej złożoności; user story mówi wprost o jednorazowym ustawieniu okładki tuż przed akceptacją, nie o wielokrotnym rematch cyklu.
  - Kompromis: Rzadki, ale realny scenariusz utraty pracy usera bez ostrzeżenia w UI.
  - Pewność: WYSOKA — dokładnie ten sam kompromis zaakceptowano dla historii OCR w poprzednim slice'u.
  - Martwy punkt: Brak — to świadoma decyzja zakresu, nie techniczne ryzyko.
- **Poprawka B**: W `rematch.ts`/`refine.ts` kopiuj `cover_url` ze starego kandydata do nowego wiersza, jeśli nowy wynik wyszukiwania nie ma własnej okładki.
  - Siła: Zero utraty pracy usera niezależnie od kolejności akcji.
  - Kompromis: Dotyka plików jawnie wyłączonych z zakresu tego planu („Nie zmieniamy confirm.ts/correct.ts" — ale to rematch.ts/refine.ts, inny plik); wymaga decyzji projektowej co się dzieje gdy NOWY kandydat ma WŁASNĄ (inną) okładkę.
  - Pewność: ŚREDNIA — nie zbadano czy „nowy kandydat ma się okładkę" bywa fałszywym negatywem (np. pusty string vs null).
  - Martwy punkt: Rozszerza zakres poza to, co user zatwierdził w pytaniach (rematch.ts/refine.ts nie były wymienione jako dotknięte pliki).
- **Decyzja**: NAPRAWIONE (Poprawka B) — dopisano punkty 3-4 do Fazy 1 (dziedziczenie `cover_url` dla rank-1 kandydata w `rematch.ts`/`refine.ts`), rozszerzono testy Fazy 4, dopisano pozostałe ograniczenie (tylko rank-1, nie alt) do „Czego NIE robimy".

## Podsumowanie sortowania

- Naprawiono: F1 (dopisano bbox.ts jako precedens), F2 (Poprawka B — dziedziczenie cover_url w rematch.ts/refine.ts)
- Werdykt po poprawkach: SOLIDNY

