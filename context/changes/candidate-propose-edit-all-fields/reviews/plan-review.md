<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Popraw jako pełna edycja propozycji kandydata

- **Plan**: context/changes/candidate-propose-edit-all-fields/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-13
- **Werdykt**: SOLIDNY (po poprawkach)
- **Ustalenia**: 0 krytycznych, 4 ostrzeżenia, 0 obserwacji — wszystkie naprawione

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY (po poprawce F1) |
| Kompletność planu | ZALICZONY (po poprawkach F2-F4) |

## Ugruntowanie

10/10 ścieżek ✓, 7/7 twierdzeń potwierdzonych przez subagenta bez sprzeczności ✓, brief↔plan ✓

## Ustalenia

### F1 — `ConfirmBookInput.purchase_price` nie ma miejsca dodania w `correct.ts`

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 1, punkt 5 i 7
- **Szczegóły**: gałąź `manual_entry` w `correct.ts` buduje własny `bookInput: ConfirmBookInput` bez `purchase_price` — po dodaniu wymaganego pola do typu, ten literał przestałby się kompilować.
- **Poprawka**: Dopisano do Fazy 1 punktu 7 zdanie o `purchase_price: null` w `manual_entry` bookInput.
- **Decyzja**: NAPRAWIONE

### F2 — Istniejące testy `propose-cover-*` w `BookModal.test.tsx` nie wymienione w Fazie 4

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 4, punkt 2
- **Szczegóły**: 6 istniejących testów assertuje stary URL `/cover` i stare testidy `propose-cover-*`, wszystkie nieaktualne po scaleniu zapisu okładki z resztą pól.
- **Poprawka**: Dopisano do Fazy 4 punktu 2 wzmiankę o usunięciu/przepisaniu tych 6 testów.
- **Decyzja**: NAPRAWIONE

### F3 — Dwa istniejące mocki `/cover` w E2E specu nie wymienione w Fazie 4

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 4, punkt 3
- **Szczegóły**: `proposal-accept-to-catalog.spec.ts` ma 2 istniejące mocki `/cover` niezwiązane z testem field_edit, przestaną przechwytywać żądania po renamie endpointu.
- **Poprawka**: Dopisano do Fazy 4 punktu 3 aktualizację tych 2 mocków → `/candidate`.
- **Decyzja**: NAPRAWIONE

### F4 — Literówka ścieżki testu `confirm-batch`

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 4, punkt 1
- **Szczegóły**: plan podawał nieistniejącą ścieżkę `tests/unit/pages/api/photos/id/confirm-batch.test.ts`.
- **Poprawka**: Poprawiono na `tests/unit/pages/api/photos/confirm-batch.test.ts`.
- **Decyzja**: NAPRAWIONE
