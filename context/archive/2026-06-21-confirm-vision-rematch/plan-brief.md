# Potwierdzenie przed vision / rematch — Krótki plan

> Pełny plan: `context/changes/confirm-vision-rematch/plan.md`

## Co i dlaczego

Przyciski "Uruchom vision", "Uruchom match", "Ponów match" i "Doprecyzuj odczyt" są jednym kliknięciem od wywołania kosztownych operacji AI / nadpisania danych. Dodajemy `ConfirmDialog` przed każdą z nich — dokładnie ten sam wzorzec, który już chroni "Ponów vision" i "Usuń zdjęcie".

## Punkt wyjścia

`ConfirmDialog` istnieje (`src/components/ConfirmDialog.tsx`) i jest już używany w 7 miejscach. Wzorzec: pending-id state → dialog → callback. `useDetectionDecision` (hook per-detekcja) zwraca `handleRefine` — wystarczy dodać `confirmRefine` state do hooka.

## Pożądany stan końcowy

Każde "niebezpieczne" kliknięcie otwiera dialog. Anuluj — brak efektu. Potwierdź — akcja uruchomiona. Brak zmian w API, handlerach ani logice biznesowej.

## Kluczowe decyzje

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| Komponent dialogu | Istniejący `ConfirmDialog` | Gotowy, przetestowany, 7 precedensów |
| "Szukaj po tytule" (rematch form) | Bez dialogu | Form = wystarczający friction |
| PhotoUploader retry | Bez dialogu | Kontekst error = user świadomy |
| Lokalizacja stanu refine | Wewnątrz `useDetectionDecision` | Hook już zarządza pozostałymi stanami detekcji |

## Zakres

**W zakresie:**
- "Uruchom vision" (PhotoListIsland, stage=uploaded)
- "Uruchom match" + "Ponów match" (PhotoListIsland)
- "Doprecyzuj odczyt" (DetectionReview, 3 widoki przez hook)

**Poza zakresem:**
- "Szukaj po tytule" — rematch form jest friction
- "Ponów vision (nowy run)" — już ma dialog
- PhotoUploader retry — kontekst błędu

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. PhotoListIsland | Confirm dla vision + match (2 dialogi, 3 przyciski) | Brak — prosty wzorzec pending-id |
| 2. DetectionReview + E2E | Confirm dla refine (hook + 3 widoki) + nowy spec E2E | Stan w hooku musi trafiać do każdego z 3 widoków |

**Szacowany nakład:** 1 sesja, 2 fazy
