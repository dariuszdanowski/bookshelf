# Nowoczesna prezentacja katalogu książek z pełnym CRUD (S-34 rozszerzony) — Implementation Plan

## Overview

Wprowadzić tryby widoku (Karty / Lista / Kafelki) dla list książek na `/shelves/[id]`
i `/library`, ze spójną, nowoczesną prezentacją odsłaniającą **pełny CRUD** (edycja,
toggle przeczytania, przeniesienie, usunięcie) oraz operacje dodatkowe (Szukaj w sieci,
Wyszukaj po danych) w każdym układzie. Przełącznik widoków — dziś inline w `DetectionReview`
(S-25) — wynosimy do reużywalnego komponentu i przepinamy na niego również S-25.

## Current State Analysis

- **S-25 (`DetectionReview.tsx`)** ma kompletny, działający przełącznik widoków inline:
  typ `DetectionViewMode = 'cards' | 'list' | 'tiles'` (`DetectionReview.tsx:1602`),
  `VIEW_MODE_STORAGE_KEY = 'bookshelf:detection-view-mode'` (l.1604), `defaultViewMode()`
  z `matchMedia` guardem dla SSR/jsdom (l.1619–1624), `readStoredViewMode()` z walidacją
  śmieciowej wartości (l.1626), hydration-safe `useDetectionViewMode()` (start 'cards',
  preferencja czytana po mount; l.1637), oraz `ViewModeSwitcher` (l.1657). To wzorzec do
  ekstrakcji.
- **`BookCard.tsx`** renderuje dziś JEDEN układ (karta z okładką + akcjami): klik okładki →
  `BookModal mode=edit` (l.107), toggle read (l.166), „Źródłowe zdjęcie" (l.180), select
  „Przenieś na półkę" (l.191), „Usuń" + `ConfirmDialog` (po book-delete). Wszystkie handlery
  (`onToggleRead`, `onMove`, `onDelete`, edit-modal, `onCoverUpdated`) już są.
- **`ShelfBooksIsland.tsx`** + **`CatalogSearchIsland.tsx`** mapują książki na `BookCard`
  w gridzie; oba mają handlery toggle/move/delete (optimistic + rollback) i przekazują je do
  `BookCard`. Brak przełącznika widoku — zawsze grid kart.
- **`BookModal.tsx`** jest jednym miejscem operacji dodatkowych: „Szukaj w sieci"
  (`book-modal-web-search`) i „Wyszukaj po danych" (`search-candidates-toggle` → `/api/books/candidates`).
  Otwierany z `BookCard` (edit) i z przycisku „+ Dodaj" (add).
- **`ConfirmDialog.tsx`** — reużywalny dialog (tone danger) używany już przez delete książki.

## Desired End State

Na `/shelves/[id]` i `/library` użytkownik widzi przełącznik **Karty / Lista / Kafelki**
(preferencja w `localStorage`, default cards-desktop / list-mobile, hydration-safe). W każdym
układzie ma dostęp do pełnego CRUD: edycja (otwiera `BookModal` z metadanymi + okładką +
„Szukaj w sieci" + „Wyszukaj po danych"), toggle przeczytania, przeniesienie, usunięcie
(z `ConfirmDialog`). Układy:
- **Karty** — obecny szczegółowy widok (lekki restyle).
- **Lista** — 1 linia: mini-okładka + tytuł + autor + rok + ikonowe akcje (edit / read / move / delete).
- **Kafelki** — siatka cover-forward: okładka + tytuł + badge przeczytania; akcje na hover / kompaktowo; klik okładki → edit.

`DetectionReview` (S-25) działa bez zmian funkcjonalnych, ale konsumuje wspólny
`ViewModeSwitcher`/`useViewMode` z nowego modułu. Weryfikacja: przełączanie układów na obu
stronach, persystencja, wszystkie operacje (zwłaszcza delete) działają w każdym układzie,
zero regresji review S-25.

### Key Discoveries

- Wzorzec przełącznika gotowy do ekstrakcji: `DetectionReview.tsx:1602-1700`.
- `matchMedia` guard konieczny dla jsdom/SSR — inaczej testy oczekujące 'cards' padną
  (`DetectionReview.tsx:1616-1624`); ta sama pułapka dotyczy nowego wspólnego hooka.
- Wszystkie handlery CRUD już istnieją w islandach + `BookCard` — Faza 2 to reorganizacja
  prezentacji, nie nowa logika danych.
- Operacje dodatkowe (web/po danych) żyją w `BookModal` — układy ich NIE duplikują, tylko
  otwierają modal (edit/add).

## What We're NOT Doing

- Nie zmieniamy modelu danych ani endpointów (CRUD + candidates już są; zero migracji).
- Nie duplikujemy „Szukaj w sieci"/„Wyszukaj po danych" per-wiersz/kafelek — zostają w `BookModal`.
- Nie przenosimy logiki akceptacji kandydatów ani pipeline'u vision.
- Nie robimy app-wide redesignu — „modern look" ograniczony do prezentacji list książek
  (spacing, hover, dark-mode parity, cover-forward kafelki).
- Nie zmieniamy `VIEW_MODE_STORAGE_KEY` S-25 (`bookshelf:detection-view-mode`) — books dostają
  własny wspólny klucz `bookshelf:book-view-mode`.
- Nie dodajemy bulk-operacji (multi-select delete/move).

## Implementation Approach

Trzy fazy, każda atomic: (1) wynieść wspólny primitive z S-25 i przepiąć S-25 na niego
(refaktor bez zmiany zachowania), (2) `BookCard` na 3 układy sterowane propem `viewMode`
(jak `DetectionCard` w S-25), (3) wpiąć przełącznik w obie wyspy + E2E.

## Phase 1: Wspólny primitive widoków (ekstrakcja z S-25)

### Overview
Wynieść generyczny przełącznik + hook do reużywalnego modułu; przepiąć `DetectionReview`.

### Changes Required

#### 1. Wspólny moduł view-mode

**File**: `src/components/ViewModeSwitcher.tsx` (new)

**Intent**: Generyczny, parametryzowany odpowiednik inline'owego przełącznika z S-25.
Eksportuje typ `ViewMode = 'cards' | 'list' | 'tiles'`, hook `useViewMode(storageKey)`
(hydration-safe: start 'cards', `readStored` po mount; `matchMedia` guard dla SSR/jsdom →
cards-desktop / list-mobile; walidacja śmieciowej wartości w localStorage; zapis przy zmianie)
oraz komponent `ViewModeSwitcher({ mode, onChange, labels?, testIdPrefix? })`.

**Contract**: `useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void]`;
`ViewModeSwitcher` zachowuje `data-testid="view-mode-switcher"` + `view-mode-${m}` (S-25 testy
ich oczekują), `testIdPrefix` opcjonalny dla niezależnych instancji. Default labels: Karty /
Lista / Kafelki.

#### 2. Przepięcie S-25

**File**: `src/components/DetectionReview.tsx`

**Intent**: Zastąpić inline `useDetectionViewMode`/`ViewModeSwitcher`/`defaultViewMode`/
`readStoredViewMode`/`isViewMode` importem ze wspólnego modułu; przekazać
`'bookshelf:detection-view-mode'` jako storageKey.

**Contract**: zero zmian zachowania i testidów; `VIEW_MODE_STORAGE_KEY` bez zmian. **Back-compat
re-eksport (F1 plan-review):** dwa istniejące testy importują symbole wprost z `DetectionReview`
(`tests/unit/components/useDetectionViewMode.test.tsx` → `useDetectionViewMode`, `VIEW_MODE_STORAGE_KEY`;
`tests/unit/components/ViewModeSwitcher.test.tsx` → `ViewModeSwitcher`). `DetectionReview` MUSI
nadal eksportować te symbole: `ViewModeSwitcher` (re-eksport ze wspólnego modułu),
`VIEW_MODE_STORAGE_KEY` (stała bez zmian), `DetectionViewMode` (alias `ViewMode`) oraz
`useDetectionViewMode()` jako cienki wrapper nad `useViewMode(VIEW_MODE_STORAGE_KEY)` (zachowuje
sygnaturę bezargumentową). Dzięki temu oba testy zielone bez zmian. Brak src/ poza-testowych
importerów (zweryfikowane grepem).

### Success Criteria

#### Automated Verification:
- Unit wspólnego modułu (default cards w jsdom, walidacja localStorage, zapis/odczyt, switch): `npm run test`
- Regresja: istniejące testy `DetectionReview` (unit) zielone: `npm run test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

#### Manual Verification:
- (objęte Fazą 3 — przełącznik widoczny dopiero w listach książek; review S-25 bez zmian wizualnych)

---

## Phase 2: `BookCard` na 3 układy + pełny CRUD/ops

### Overview
Jeden `BookCard` renderujący Karty / Lista / Kafelki wg propu `viewMode`, z pełnym CRUD w każdym.

### Changes Required

#### 1. BookCard wielowariantowy

**File**: `src/components/BookCard.tsx`

**Intent**: Dodać prop `viewMode?: ViewMode` (default 'cards'). Wydzielić wspólny stan/handlery
(edit-modal, confirm-delete, cover) i renderować 3 layouty:
- **cards** — obecny szczegółowy (lekki restyle: hover, dark-mode parity).
- **list** — wiersz 1-linia: mini-okładka (klik → edit modal) + tytuł + autor + rok + ikonowe
  akcje: edit, toggle read, move (select kompaktowy lub menu), delete (z ConfirmDialog).
- **tiles** — kafelek cover-forward: okładka (klik → edit) + tytuł + badge przeczytania;
  akcje read/delete kompaktowo (hover/stopka kafelka).
Operacje dodatkowe (web/po danych) NIE są duplikowane — dostępne przez edit→`BookModal`.

**Contract**: zachować istniejące `data-testid` (`book-card-${id}`, `book-cover-button-${id}`,
`toggle-read-${id}`, `move-book-${id}`, `delete-book-${id}`, `delete-book-dialog-${id}*`,
`source-photo-link-${id}`) w każdym układzie który daną akcję pokazuje; dodać kontenerowe testidy
`book-row-${id}` (list) i `book-tile-${id}` (tiles) dla asercji układu. Propsy CRUD bez zmian
(`onToggleRead`/`onMove`/`onDelete`/`onCoverUpdated`/`onBookSaved`).

### Success Criteria

#### Automated Verification:
- Unit `BookCard` × 3 tryby: render + obecność/działanie akcji (toggle, delete→dialog→confirm, move, edit-open) w każdym; zachowane testidy: `npm run test`
- Typecheck + lint
- Build: `npm run build`

#### Manual Verification:
- (objęte Fazą 3)

---

## Phase 3: Wpięcie przełącznika w wyspy + E2E

### Overview
`ShelfBooksIsland` i `CatalogSearchIsland` dostają przełącznik + przekazują `viewMode` do `BookCard`.

### Changes Required

#### 1. ShelfBooksIsland + CatalogSearchIsland

**File**: `src/components/ShelfBooksIsland.tsx`, `src/components/CatalogSearchIsland.tsx`

**Intent**: Dodać `useViewMode('bookshelf:book-view-mode')`, wyrenderować `ViewModeSwitcher`
nad listą (w `CatalogSearchIsland` — przy nagłówku wyników), przekazać `viewMode` do `BookCard`
i dobrać kontener (grid dla cards/tiles, kolumna dla list) zależnie od trybu.

**Contract**: wspólny klucz `bookshelf:book-view-mode` dla obu stron; istniejące testidy list
(`shelf-books-grid`, `search-results`) zachowane lub uzupełnione o wariant układu; switcher
`view-mode-switcher` (instancja per strona).

### Success Criteria

#### Automated Verification:
- Pełny unit zielony (BookCard + islandy + review regresja): `npm run test`
- Typecheck + lint + build
- E2E: przełączanie Karty/Lista/Kafelki na `/shelves/[id]` i `/library`, persystencja `localStorage`, **delete w trybie Lista i Kafelki** (regresja — akcje muszą działać poza kartami): `npx playwright test` (w CI / na dev serverze :4321)

#### Manual Verification:
- Przełącznik działa na obu stronach; preferencja przeżywa reload.
- W każdym układzie: edycja (otwiera modal z „Szukaj w sieci" + „Wyszukaj po danych"), toggle read, move, **usuń** (dialog → znika).
- Wygląd spójny i nowoczesny w light + dark; mobile bez poziomego scrolla.
- Zero regresji: review S-25 (Karty/Lista/Kafelki detekcji) działa jak wcześniej.

---

## Testing Strategy

### Unit Tests:
- Wspólny `useViewMode`/`ViewModeSwitcher`: default w jsdom = cards, walidacja localStorage, switch + zapis.
- `BookCard` × 3 tryby: akcje obecne i działające w każdym; testidy zachowane.
- Regresja `DetectionReview` po przepięciu.

### Integration / E2E:
- `/shelves/[id]` i `/library`: switch trybów, persystencja, delete + edit-open w trybie list/tiles.

### Manual Testing Steps (user-only):
1. `/shelves/[id]` → przełącz Karty→Lista→Kafelki; reload → tryb zachowany.
2. W trybie Lista: usuń książkę (dialog), przełącz read, przenieś, otwórz edycję → „Wyszukaj po danych".
3. `/library` → ten sam tryb (wspólny klucz); dark mode.
4. Review (S-25) nadal przełącza widoki detekcji bez zmian.

## Migration Notes
Brak migracji — czysty frontend. Reuse istniejących endpointów (CRUD + candidates) i `ConfirmDialog`.

## References
- Wzorzec przełącznika (do ekstrakcji): `src/components/DetectionReview.tsx:1602-1700`
- Operacje dodatkowe: `src/components/BookModal.tsx`
- Delete (świeżo na main): `src/pages/api/books/[id].ts` DELETE + `BookCard` „Usuń"
- Reużywalny dialog: `src/components/ConfirmDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Wspólny primitive widoków

#### Automated
- [ ] 1.1 Unit wspólnego modułu (default cards w jsdom / walidacja localStorage / switch+zapis)
- [ ] 1.2 Regresja unit DetectionReview po przepięciu
- [ ] 1.3 Typecheck
- [ ] 1.4 Lint

### Phase 2: BookCard na 3 układy + pełny CRUD/ops

#### Automated
- [ ] 2.1 Unit BookCard × 3 tryby (akcje + zachowane testidy)
- [ ] 2.2 Typecheck + lint
- [ ] 2.3 Build

### Phase 3: Wpięcie przełącznika w wyspy + E2E

#### Automated
- [ ] 3.1 Pełny unit zielony (BookCard + islandy + review)
- [ ] 3.2 Typecheck + lint + build
- [ ] 3.3 E2E (switch Karty/Lista/Kafelki na /shelves + /library, persystencja, delete w list/tiles)

#### Manual
- [ ] 3.4 Przełącznik + persystencja na obu stronach
- [ ] 3.5 Pełny CRUD + ops w każdym układzie (edit→modal web/po danych, read, move, delete)
- [ ] 3.6 Spójny wygląd light+dark, mobile bez poziomego scrolla
- [ ] 3.7 Zero regresji review S-25
