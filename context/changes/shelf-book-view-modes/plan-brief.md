# Nowoczesna prezentacja katalogu książek z pełnym CRUD (S-34 rozszerzony) — Plan Brief

> Full plan: `context/changes/shelf-book-view-modes/plan.md`

## What & Why

Listy książek na `/shelves/[id]` i `/library` mają dziś jeden układ (grid kart). Wprowadzamy
przełącznik **Karty / Lista / Kafelki** (jak S-25 dla detekcji) i — szerzej — spójną,
nowoczesną prezentację, w której **każdy układ odsłania pełny CRUD** (edycja, przeczytane,
przenieś, usuń) oraz operacje dodatkowe (Szukaj w sieci, Wyszukaj po danych). Powód: po
dodaniu operacji „usuń" katalog zasługuje na uporządkowaną, kompletną prezentację zamiast
rozjeżdżających się akcji na pojedynczym układzie.

## Starting Point

S-25 ma działający przełącznik widoków inline w `DetectionReview`. `BookCard` renderuje jeden
układ z kompletem akcji (edit/read/move/delete + okładka→modal); `ShelfBooksIsland` i
`CatalogSearchIsland` mapują książki na `BookCard` w gridzie. `BookModal` jest jedynym miejscem
„Szukaj w sieci"/„Wyszukaj po danych". Wszystkie handlery CRUD już istnieją.

## Desired End State

Na obu stronach widoczny przełącznik 3 układów (preferencja w `localStorage`, default
cards-desktop / list-mobile). W Kartach, Liście i Kafelkach dostępny pełny CRUD; edycja otwiera
`BookModal` z operacjami dodatkowymi. `DetectionReview` (S-25) działa bez zmian, ale na wspólnym
przełączniku.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Wzorzec przełącznika | cards/list/tiles + localStorage + matchMedia guard (jak S-25) | sprawdzony, hydration-safe | Plan |
| Współdzielenie z S-25 | wynieść wspólny + przepiąć DetectionReview | DRY, jeden wzorzec UX | User |
| BookCard | jeden komponent, prop `viewMode`, 3 layouty | logika/handlery w jednym miejscu (jak DetectionCard S-25) | Plan |
| Operacje web/po danych | zostają w BookModal, nie duplikowane per-wiersz | unika clutteru w kompaktowych układach | Plan |
| Klucz preferencji | wspólny `bookshelf:book-view-mode` dla obu stron | spójna preferencja katalogu | Plan |
| „Modern look" | bounded restyle list książek, bez app-wide redesign | trzyma scope | Plan |

## Scope

**In scope:** 3 układy na /shelves/[id] + /library; pełny CRUD (edit/read/move/delete) + edit→ops
w każdym; wspólny ViewModeSwitcher/useViewMode; przepięcie S-25; localStorage; dark/responsive.

**Out of scope:** migracje/endpointy; duplikacja web/po-danych per-wiersz; bulk-operacje;
app-wide redesign; zmiana storage key S-25.

## Architecture / Approach

Nowy `src/components/ViewModeSwitcher.tsx` (typ `ViewMode`, hook `useViewMode(storageKey)`,
komponent switchera) — generalizacja inline'u z S-25. `BookCard` zyskuje prop `viewMode` i
renderuje 3 layouty współdzieląc handlery/dialog. Obie wyspy trzymają stan trybu przez
`useViewMode('bookshelf:book-view-mode')`, renderują switcher i dobierają kontener (grid vs
kolumna).

## Phases at a Glance

| Faza | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Wspólny primitive | ViewModeSwitcher/useViewMode + przepięcie S-25 | regresja review S-25 (mitygacja: testidy + storage key bez zmian) |
| 2. BookCard 3 układy | cards/list/tiles z pełnym CRUD | zgubienie data-testid / akcji w kompaktowych układach |
| 3. Wpięcie + E2E | switcher w obu wyspach + testy | delete/edit muszą działać w list/tiles, nie tylko cards |

**Prerequisites:** book-delete na main (jest), S-25 wzorzec (jest).
**Estimated effort:** ~1–2 sesje, 3 fazy.

## Open Risks & Assumptions

- Przepięcie S-25 dotyka działającego kodu — regresję łapią istniejące testy review + niezmieniony storage key/testidy.
- `matchMedia` guard musi trafić do wspólnego hooka (jsdom default = cards), inaczej padają testy oczekujące kart.
- „Modern look" jest subiektywny — bounded do spacing/hover/dark/cover-forward; finalny wygląd weryfikuje user manualnie.

## Success Criteria (Summary)

- Przełącznik Karty/Lista/Kafelki na /shelves/[id] i /library, preferencja przeżywa reload.
- Pełny CRUD + edit→(web/po danych) działa w KAŻDYM układzie (zwłaszcza delete poza kartami).
- Zero regresji przełącznika detekcji w review (S-25).
