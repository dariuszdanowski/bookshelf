<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Usuń i przenieś zdjęcie z /photos/[id]

- **Plan**: context/changes/photo-delete-and-move/plan.md
- **Zakres**: Faza 1 + Faza 2 (pełny plan)
- **Data**: 2026-06-21
- **Werdykt**: WYMAGA UWAGI
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 4 obserwacje

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | WARNING |
| Bezpieczeństwo i jakość | WARNING |
| Architektura | PASS |
| Spójność wzorców | WARNING |
| Kryteria sukcesu | PASS |

## Weryfikacja automatyczna

| Kryterium | Wynik |
|---|---|
| typecheck | ✅ 0 errors, 0 warnings |
| lint | ✅ passed |
| unit testy | ✅ 1035/1035 passed |
| E2E | ✅ zielone przy commit 4132ada (potwierdzone w plan.md) |

## Ustalenia

### F1 — Cichy błąd przy nieudanym delete/move — brak feedbacku dla usera

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąska
- **Wymiar**: Bezpieczeństwo i jakość + Spójność wzorców
- **Lokalizacja**: src/components/DetectionReview.tsx ~2452–2490
- **Szczegóły**: handleDeletePhoto i handleMovePhoto na !res.ok rzucają Error('delete failed') i pomijają body odpowiedzi API; na catch jedynie resetują flagę busy + console.error. User nie otrzymuje żadnego komunikatu o błędzie. PhotoListIsland.tsx (~280-285) parsuje res.json() i wyświetla komunikat przez setActionMsg. DetectionReview ma już mechanizm setActionMsg — wystarczy go użyć.
- **Poprawka**: W obu handlerach po `!res.ok` sparsować res.json() i wywołać setActionMsg() z komunikatem błędu z API; w bloku catch też ustawić setActionMsg z ogólnym komunikatem — wzorując się na analogicznym kodzie w PhotoListIsland.
- **Decyzja**: OCZEKUJĄCA

### F2 — Nieplanlowe zmiany w byok-enforcement.spec.ts i photo-dedup.spec.ts

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; nie wpływa na funkcjonalność
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: tests/e2e/byok-enforcement.spec.ts, tests/e2e/photo-dedup.spec.ts
- **Szczegóły**: W obu plikach zmieniono wzorzec page.route() dla /process z glob-stringa na predykat pathname URL. Zmiana poprawna (dokładniejsze dopasowanie) i nieszkodliwa, ale nie jest w planie. Brak zmiany logiki testów.
- **Poprawka**: Brak — zmiana korzystna; odnotować jako housecleaning.
- **Decyzja**: POMINIĘTE

### F3 — E2E testy nie potwierdzają że DELETE/PATCH faktycznie został wysłany

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; test spełnia swój cel, ale można go wzmocnić
- **Wymiar**: Kryteria sukcesu (jakość testów)
- **Lokalizacja**: tests/e2e/photo-delete-and-move.spec.ts ~138
- **Szczegóły**: Oba testy asertują redirect (waitForURL), ale nie weryfikują że właściwy HTTP request (DELETE / PATCH) faktycznie poszedł. Redirect mógłby zajść z innego powodu — test by nie wychwycił regresji w wywołaniu API.
- **Poprawka**: Dodać page.waitForRequest() z predykatem metody przed kliknięciem przycisku — standardowy wzorzec Playwright dla weryfikacji side-effectów.
- **Decyzja**: OCZEKUJĄCA

### F4 — useEffect dependency [photo] zamiast planowanego [photo?.shelf_id]

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; brak efektu behawioralnego w praktyce
- **Wymiar**: Zgodność z planem (minimalny drift)
- **Lokalizacja**: src/components/DetectionReview.tsx ~2197 (useEffect dep array)
- **Szczegóły**: Plan zakładał [photo?.shelf_id] — efekt reruns tylko gdy shelf_id się zmieni. Implementacja używa [photo] — szerszy dep, reruns przy każdej zmianie photo. W praktyce photo nie zmienia się bez zmiany shelf_id w tym kontekście.
- **Poprawka**: Zmienić dep array na [photo?.id, photo?.shelf_id] lub [photo?.shelf_id] zgodnie z intencją planu.
- **Decyzja**: OCZEKUJĄCA

### F5 — Shelves fetch error i stan pusty nie do odróżnienia w dropdown

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; UX edge-case na błędzie fetcha
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/components/DetectionReview.tsx ~2205, ~2871–2873
- **Szczegóły**: Na błąd fetcha setAllShelves([]) — identyczny stan jak "user ma tylko 1 półkę". Dropdown jest disabled z tym samym placeholder "Przenieś na…" w obu przypadkach. User nie wie czy lista jest pusta, czy fetch failował.
- **Poprawka**: Użyć null jako sentinel dla błędu (zamiast []), renderować krótki hint "Nie można załadować półek" przy null vs disabled select przy []. Opcjonalnie dodać title="Brak innych półek" na disabled select.
- **Decyzja**: OCZEKUJĄCA
