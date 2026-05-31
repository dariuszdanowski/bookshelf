# Plan implementacji — S-25 `detection-list-views`

## Overview

Dodanie przełącznika trybu prezentacji listy detekcji w widoku review zdjęcia (`/photos/[id]`): **Karty** (obecny widok), **Lista** (kompakt 1-linia), **Kafelki** (siatka okładek). Wybór persystowany w `localStorage`, default zależny od szerokości ekranu. Czysto frontend — zero zmian API/DB/migracji.

**Roadmap:** S-25 (Prereq: S-04, S-05 — oba `done`). **Branch:** `change/detection-list-views`.

## Current State Analysis

Cała warstwa review żyje w jednym pliku `src/components/DetectionReview.tsx` (803 linie, 29 KB) z inline subkomponentami:

- `CoverImage` (l. 36) — okładka + placeholder SVG.
- `CorrectForm` (l. 79–211) — formularz korekty / ręcznego wpisu. Propsy: `mode: 'field_edit' | 'manual_entry'`, `detectionId`, `candidateId?`, `initialTitle/Authors/Publisher/Year`, `onSuccess`, `onCancel`. POST `/api/detections/{id}/correct`. testid: `correct-form`, `correct-title|authors|publisher|year`, `correct-error|submit|cancel`.
- `DetectionCard` (l. 224–506) — **trzyma własny stan i własne fetch**: `handleConfirm` (POST `/api/detections/{id}/confirm`), `handleReject` (POST `/api/detections/{id}/reject`), `selectedCandidateId/showAlts/showCorrectForm/state/busy/errorMsg`. „Popraw"/„Wpisz ręcznie" renderują `CorrectForm` **inline**.
- `DetectionReview` (l. 542, `export default`) — props `{ photoId }`, fetch `GET /api/photos/{id}`, `decidedIds`, bulk-confirm, rerun vision/match, redirect po zdecydowaniu wszystkich. Render listy: `<div className="space-y-4">` mapuje `DetectionCard` (l. 792–800).

### Key Discoveries:

- **Blast radius zweryfikowany:** `DetectionReview` importowany **wyłącznie** w `src/pages/photos/[id].astro:5` (`client:load`). `DetectionCard`/`CorrectForm`/`CoverImage` są inline (nieeksportowane) → refaktor wewnątrzplikowy, zero zewnętrznych callerów.
- **Logika decyzji jest wewnątrz `DetectionCard`** → żeby 3 tryby nie duplikowały wywołań API, ekstrahujemy ją do współdzielonego hooka (rdzeń Fazy 1).
- **Badge pewności:** `getMatchTier(matchScore)` → `TIER_STYLES` (high/mid/low, l. 12–34). Reużyjemy w Lista/Kafelki.
- **DTO:** `DetectionWithCandidatesDTO` w `src/lib/photos/schema.ts:54` (`id, position_index, raw_title, raw_author, vision_confidence, spine_color, bbox, status, candidates[], duplicate`); `BookCandidateDTO` w `src/lib/books/schema.ts:30` (`matchScore` napędza badge).
- **Test do ochrony — `tests/unit/components/DetectionReview.test.tsx` (390 linii, 14 testów):** asercje **wyłącznie** przez `getByTestId` na stabilnych testid (`detection-review`, `detection-review-loading/error`, `detection-card-1/2`, `bulk-confirm-button`, `confirm-button`, `reject-button`, `correct-button`, `correct-form`, `correct-title/submit`, `detection-error`, `no-match-placeholder`, `manual-entry-button`). **Zero asercji na klasy CSS / strukturę DOM** → refaktor bezpieczny pod warunkiem zachowania testid i domyślnego renderu Karty w jsdom.
- **jsdom nie ma `window.matchMedia`** (potwierdzony blind spot F2) → default trybu MUSI spaść do `cards`, gdy `matchMedia`/`window` niedostępne, inaczej testy oczekujące `detection-card-N` padną.
- **Tailwind v4** zero-config (`@import 'tailwindcss'` w `src/styles/global.css`, plugin `@tailwindcss/vite`). Warianty `sm:`/`grid-cols-*` out-of-the-box.
- **Brak istniejącego wzorca `localStorage`** w repo. Wzorzec optimistic UI: `ShelfBooksIsland.tsx`.
- **Playwright** chromium default viewport 1280×720 (≥640) → istniejące e2e zostają w trybie Karty po wprowadzeniu defaultu responsywnego (blind spot F5).

## Desired End State

Użytkownik na `/photos/[id]` widzi przełącznik 3 trybów; każdy renderuje detekcje w innym layoucie, zachowując pełen zestaw akcji (Akceptuj / Odrzuć / Popraw / „Wpisz ręcznie"). Preferencja przeżywa reload (localStorage). W Lista/Kafelki „Popraw" i „Wpisz ręcznie" otwierają modal; w Karty zostają inline. Wszystkie istniejące testy (unit + e2e) zielone; nowe testy pokrywają 3 tryby i persystencję.

## What We're NOT Doing

- Zmiany endpointów / DTO / migracji / RLS.
- Pełna responsywność reszty aplikacji (to S-28) — dotykamy tylko widoku review.
- Dark mode (S-27).
- Selektor alternatywnych kandydatów w trybach kompaktowych (Lista/Kafelki działają na top-kandydacie; zmiana kandydata przez „Popraw" lub tryb Karty — decyzja D8).
- Wydzielanie subkomponentów do osobnego folderu (dopuszczone jako opcjonalny osobny commit refaktorowy, nie część slice'a).

## Implementation Approach

Refaktor wewnątrzplikowy w 4 atomowych fazach: (1) ekstrakcja logiki decyzji do hooka + infrastruktura trybu, render Karty bez zmian → testy zielone; (2) modal korekty + tryb Lista; (3) tryb Kafelki; (4) testy unit+e2e + zielona pętla. Nowy kod inline w `DetectionReview.tsx`, zgodnie ze stylem pliku (który już ma inline subkomponenty) i z regułą CLAUDE.md „kod czyta się jak otoczenie".

## Critical Implementation Details

Decyzje (rekomendowane cally fast-track; zawetuj wyjątki):

| # | Decyzja | Wybór | Odrzucone |
| --- | --- | --- | --- |
| D1 | Persystencja | `localStorage` klucz `bookshelf:detection-view-mode` + hook `useDetectionViewMode` | URL query (gubi się) |
| D2 | Default responsywny | `matchMedia('(min-width:640px)')`; **przy braku window/matchMedia → `cards`** (SSR+jsdom) | zawsze Karty (łamie spec mobile) / domyślnie list przy braku matchMedia (łamie testy — F2) |
| D3 | „Popraw"/„Wpisz ręcznie" w Lista/Kafelki | modal opakowujący istniejący `CorrectForm` | inline w wąskim wierszu |
| D4 | Lokalizacja kodu | inline w `DetectionReview.tsx` | nowy folder (większy refaktor) |
| D5 | Logika decyzji | hook `useDetectionDecision(detection, onDecided)` | duplikacja per-tryb |
| D6 | Switcher UI | segmented control 3 przyciski, `aria-pressed`, ikona+label | `<select>` |
| D7 | Walidacja localStorage | odczyt walidowany do `'cards'\|'list'\|'tiles'`, inaczej default (F3) | ufać surowej wartości |
| D8 | Alternatywy w kompakcie | brak — akcje na top-kandydacie | port pełnego selektora |

## Phase 1: Hook decyzji + infrastruktura trybu (Karty bez zmian)

### Overview
Pure refactor + dołożenie stanu trybu i przełącznika. Render Karty pixel-identyczny → istniejące testy zielone bez modyfikacji.

### Changes Required:

1. `src/components/DetectionReview.tsx` — `useDetectionDecision(detection, onDecided)`: przenosi z `DetectionCard` `state/busy/errorMsg`, `selectedCandidateId/activeCandidate`, `handleConfirm`, `handleReject`, `handleCorrectSuccess`. `DetectionCard` przepisany na konsumpcję hooka — render i wszystkie testid bez zmian.
2. `useDetectionViewMode()`: typ `DetectionViewMode = 'cards' | 'list' | 'tiles'`. Odczyt z `localStorage` przy mount z **walidacją** wartości (D7); brak/niepoprawna → default. Default: gdy `typeof window === 'undefined'` lub brak `window.matchMedia` → `'cards'` (F2); inaczej `matchMedia('(min-width:640px)').matches ? 'cards' : 'list'`. `setMode` zapisuje do `localStorage`. Zwraca `[mode, setMode]`.
3. `ViewModeSwitcher` (inline) — 3 przyciski, `aria-pressed`, testid `view-mode-switcher` + `view-mode-cards|list|tiles`.
4. `DetectionReview`: renderuje `ViewModeSwitcher` nad listą; `mode` z hooka; **w tej fazie wszystkie tryby renderują nadal `DetectionCard`** (sama infrastruktura).

### Success Criteria:

#### Automated Verification:
- [ ] 1.1 `npm run typecheck` zielony
- [ ] 1.2 `npm run lint` zielony
- [ ] 1.3 istniejący `npm run test -- DetectionReview` zielony **bez modyfikacji testu** (gate F4: odpalić PO ekstrakcji hooka, PRZED dodaniem switchera)
- [ ] 1.4 nowy `useDetectionViewMode.test.ts` zielony: localStorage R/W, walidacja śmieciowej wartości → default, default `cards` gdy `matchMedia` undefined, `list` gdy zamockowany mobile match
- [ ] 1.5 nowy `ViewModeSwitcher.test.tsx` zielony: klik zmienia `aria-pressed`

#### Manual Verification:
- [ ] 1.6 (user-only, post-merge) przełącznik widoczny nad listą, klik podświetla aktywny tryb

## Phase 2: Modal korekty + tryb Lista

### Overview
Wprowadzenie współdzielonego modala (opakowanie istniejącego `CorrectForm`) i kompaktowego wiersza.

### Changes Required:

1. `src/components/DetectionReview.tsx` — `CorrectionModal`: opakowuje `CorrectForm` w `<dialog>`/`role="dialog"` (zamknięcie Esc + klik backdrop), testid `correction-modal`. `CorrectForm` **bez zmian** (te same testid działają w modalu).
2. `DetectionRow` — wiersz: `#position` · tytuł — autor (truncate) · badge `TIER_STYLES[getMatchTier(matchScore)]` · `[Akceptuj][Odrzuć][Popraw]`. Używa `useDetectionDecision`. „Popraw"/„Wpisz ręcznie" → `CorrectionModal`. Ścieżka „brak matchu" (pusty `candidates`) renderuje `no-match-placeholder` + `manual-entry-button` → modal. testid `detection-row-{position_index}` + reużyte `confirm-button/reject-button/correct-button/manual-entry-button`.
3. `DetectionReview`: `mode==='list'` → `<div className="space-y-2">` z `DetectionRow`.

### Success Criteria:

#### Automated Verification:
- [ ] 2.1 `npm run typecheck` zielony
- [ ] 2.2 `npm run lint` zielony
- [ ] 2.3 nowy `DetectionRow.test.tsx`: render pól, Akceptuj/Odrzuć wołają fetch (zamockowany), „Popraw" otwiera `correction-modal`
- [ ] 2.4 nowy test `CorrectionModal`: Esc zamyka, submit przechodzi (POST /correct zamockowany)
- [ ] 2.5 istniejące testy (unit + e2e) zielone

#### Manual Verification:
- [ ] 2.6 (user-only) w trybie Lista wszystkie akcje działają; „Popraw" otwiera modal i zapisuje

## Phase 3: Tryb Kafelki

### Overview
Siatka kafli okładek z mini-akcjami.

### Changes Required:

1. `src/components/DetectionReview.tsx` — `DetectionTile`: `CoverImage` + tytuł (truncate) + badge `TIER_STYLES` + mini-akcje (ikony Akceptuj/Odrzuć + „Popraw"→`CorrectionModal`). Używa `useDetectionDecision`. Ścieżka „brak matchu" → manual entry przez modal. testid `detection-tile-{position_index}`.
2. `DetectionReview`: `mode==='tiles'` → `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4`.

### Success Criteria:

#### Automated Verification:
- [ ] 3.1 `npm run typecheck` zielony
- [ ] 3.2 `npm run lint` zielony
- [ ] 3.3 nowy `DetectionTile.test.tsx`: render + akcje + modal
- [ ] 3.4 istniejące testy zielone

#### Manual Verification:
- [ ] 3.5 (user-only) w trybie Kafelki siatka renderuje okładki, akcje + modal działają

## Phase 4: E2E + domknięcie

### Overview
Pełnościeżkowy e2e dla 3 trybów i persystencji; zielona pętla.

### Changes Required:

1. `tests/e2e/detection-list-views.spec.ts` (mock vision/match przez `page.route` — **nigdy realny LLM**):
   - **ustawia `localStorage` jawnie przed nawigacją** (F5 — nie polega na wycieku stanu między specami);
   - przełączanie 3 trybów zmienia layout (asercje `detection-card-* / detection-row-* / detection-tile-*`);
   - persystencja: zmień tryb → reload → tryb zachowany;
   - Akceptuj/Odrzuć działa w każdym trybie (mock endpoint);
   - „Popraw" w Lista i Kafelki otwiera `correction-modal`; w Kartach inline bez zmian.
2. Przegląd testid: zero usunięć/kolizji względem mapy z Current State Analysis.

### Success Criteria:

#### Automated Verification:
- [ ] 4.1 `npm run typecheck && npm run lint` zielone
- [ ] 4.2 `npm run test` (vitest) zielony — istniejące + nowe
- [ ] 4.3 `npm run test:e2e` (playwright) zielony — istniejące + nowy spec
- [ ] 4.4 grep potwierdza obecność wszystkich oryginalnych testid w `DetectionReview.tsx`

#### Manual Verification:
- [ ] 4.5 (user-only, post-merge) wizualny przegląd 3 trybów na realnym zdjęciu ≥19 detekcji + persystencja po reloadzie + „Popraw" modal

## Testing Strategy

### Unit Tests:
- `useDetectionViewMode` (localStorage R/W, walidacja, default responsywny z mockiem `matchMedia`).
- `ViewModeSwitcher`, `DetectionRow`, `DetectionTile`, `CorrectionModal`.
- Istniejący `DetectionReview.test.tsx` — bez zmian, jako regression gate.

### Integration Tests:
- N/D (brak zmian API/DB).

### Manual Testing Steps (user-only, post-merge):
1. `/photos/[id]` z ≥19 detekcjami — przełącz Karty/Lista/Kafelki.
2. Zmień tryb → reload → tryb zachowany.
3. W Lista i Kafelki: Akceptuj, Odrzuć, „Popraw" (modal), „Wpisz ręcznie" (modal).
4. Wąski ekran (<640px) bez zapisu → default Lista.

## Performance Considerations
Brak — render po stronie klienta, te same dane, brak dodatkowych fetchy. Tryb Kafelki używa `loading="lazy"` na okładkach (jak `CoverImage`).

## Migration Notes
Brak migracji DB. Klucz `localStorage` `bookshelf:detection-view-mode` — nowy, walidowany, samo-naprawialny przy nieznanej wartości.

## References
- Roadmap S-25: `context/foundation/roadmap.md`
- Wzorzec formatu/struktury: `context/archive/2026-05-30-photo-detection-overlay/plan.md`
- Plik docelowy: `src/components/DetectionReview.tsx`
- Test-regression gate: `tests/unit/components/DetectionReview.test.tsx`

## Progress

### Phase 1: Hook decyzji + infrastruktura trybu (Karty bez zmian)

#### Automated
- [x] 1.1 `npm run typecheck` zielony
- [x] 1.2 `npm run lint` zielony
- [x] 1.3 istniejący `DetectionReview.test.tsx` zielony bez modyfikacji (gate F4)
- [x] 1.4 `useDetectionViewMode.test.tsx` zielony (R/W, walidacja, default cards bez matchMedia, list przy mobile mock) — adaptacja vs plan: `.tsx` zamiast `.ts` (harness z `render()`, bo interop vitest+RTL16 pod React 19 nie eksponuje `renderHook`)
- [x] 1.5 `ViewModeSwitcher.test.tsx` zielony (aria-pressed)

#### Manual
- [ ] 1.6 przełącznik widoczny + aktywny tryb podświetlony

### Phase 2: Modal korekty + tryb Lista

#### Automated
- [ ] 2.1 `npm run typecheck` zielony
- [ ] 2.2 `npm run lint` zielony
- [ ] 2.3 `DetectionRow.test.tsx` zielony (render, akcje, „Popraw"→modal)
- [ ] 2.4 test `CorrectionModal` zielony (Esc, submit)
- [ ] 2.5 istniejące testy zielone

#### Manual
- [ ] 2.6 tryb Lista: akcje + modal działają

### Phase 3: Tryb Kafelki

#### Automated
- [ ] 3.1 `npm run typecheck` zielony
- [ ] 3.2 `npm run lint` zielony
- [ ] 3.3 `DetectionTile.test.tsx` zielony
- [ ] 3.4 istniejące testy zielone

#### Manual
- [ ] 3.5 tryb Kafelki: siatka + akcje + modal

### Phase 4: E2E + domknięcie

#### Automated
- [ ] 4.1 `typecheck` + `lint` zielone
- [ ] 4.2 `npm run test` (vitest) zielony — istniejące + nowe
- [ ] 4.3 `npm run test:e2e` zielony — istniejące + nowy spec
- [ ] 4.4 grep potwierdza wszystkie oryginalne testid w `DetectionReview.tsx`

#### Manual
- [ ] 4.5 przegląd 3 trybów na realnym zdjęciu + persystencja + „Popraw" modal
