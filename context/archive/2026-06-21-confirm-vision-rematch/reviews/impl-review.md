<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Potwierdzenie przed vision/rematch

- **Plan**: context/changes/confirm-vision-rematch/plan.md
- **Zakres**: Fazy 1 i 2 (pełny plan)
- **Data**: 2026-06-21
- **Werdykt**: ZAAKCEPTOWANY (po naprawach)
- **Ustalenia**: 0 krytycznych / 1 ostrzeżenie (naprawione) / 3 obserwacje (2 naprawione, 1 pominięta)

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność z planem | PASS ✅ (po naprawie F1) |
| Dyscyplina zakresu | WARNING ⚠️ (BookCard.tsx poza planem — addytywna, pominięta) |
| Bezpieczeństwo i jakość | PASS ✅ (po naprawie F3) |
| Architektura | PASS ✅ |
| Spójność wzorców | PASS ✅ (po naprawie F1) |
| Kryteria sukcesu | PASS ✅ (lint ✓, 1035 unit ✓, E2E rozszerzony) |

## Ustalenia

### F1 — RefineButton w trybach Lista i Kafelki pomijał ConfirmDialog

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Zgodność z planem / Spójność wzorców
- **Lokalizacja**: DetectionReview.tsx:1593 (DetectionRow), :1908 (DetectionTile)
- **Szczegóły**: Plan wymagał `setConfirmRefine(true)` w onClick RefineButton dla 3 widoków. DetectionCard (karty) — poprawnie. DetectionRow i DetectionTile miały `onClick={() => void handleRefine()}` — ConfirmDialog renderowany ale martwy kod, refine wywoływało płatne API bez dialogu.
- **Poprawka**: zmieniono `void handleRefine()` → `setConfirmRefine(true)` w liniach 1593 i 1908. Zaktualizowano unit testy DetectionRow.test.tsx i DetectionTile.test.tsx (dodano klik `refine-confirm-confirm`).
- **Decyzja**: NAPRAWIONE

### F2 — BookCard.tsx zmodyfikowany poza zakresem planu

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Dyscyplina zakresu
- **Lokalizacja**: src/components/BookCard.tsx
- **Szczegóły**: Plik pojawił się w diffie tej zmiany, chociaż plan go nie wymieniał. Zawiera ConfirmDialog dla operacji na książkach (move-book, delete-book) — addytywna zmiana nieingerująca w zakres. Kod działa prawidłowo.
- **Poprawka**: brak akcji
- **Decyzja**: POMINIĘTE

### F3 — match-stream.ts:407 logował raw `e` w catch strumienia

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Bezpieczeństwo / Spójność wzorców
- **Lokalizacja**: src/pages/api/photos/[id]/match-stream.ts:407
- **Szczegóły**: `console.error('[...] stream error', e)` logował raw `e`. Niezgodne z lessons.md "Server-side error logging: nigdy raw err object" i z pozostałymi catch'ami w pliku.
- **Poprawka**: zmieniono na `e instanceof Error ? e.message : String(e)`.
- **Decyzja**: NAPRAWIONE

### F4 — E2E spec: brak testu API-call dla "Ponów match" confirm

- **Ważność**: 👁 OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kryteria sukcesu
- **Lokalizacja**: tests/e2e/confirm-vision-rematch.spec.ts
- **Szczegóły**: Sekcja "Ponów match" miała 2 testy (open dialog + Anuluj). Brakowało testu "Potwierdź wywołuje endpoint" analogicznego do sekcji vision i match.
- **Poprawka**: dodano trzeci test z waitForRequest dla `rerun-match-confirm-confirm` → `/match-stream`.
- **Decyzja**: NAPRAWIONE
