# S-28: Responsywność mobilna — Implementation Plan

## Overview

Domknięcie mobilne 375 px: hamburger nav (jedyny CRITICAL z researchu), drobnica CSS
(padding stron, 2 sztywne gridy) i pokrycie E2E kluczowych ścieżek.

## Current State Analysis

- **Header** ([src/layouts/Layout.astro:47-93](src/layouts/Layout.astro)): 5 linków +
  ThemeToggle + email + LogoutButton w jednym `flex` bez breakpointów — na 375 px wrap/ścisk.
- **Już responsywne** (bez zmian): gridy książek/detekcji (`grid-cols-2 sm:… md:…`),
  PhotoListIsland, ShelfForm/ShelfListItem, drop-zone (click-fallback), mobilny default
  „Lista" (`ViewModeSwitcher.defaultViewMode()` — matchMedia <640 px → 'list').
- **Sztywne**: `p-8` na wszystkich stronach; `grid-cols-3 gap-4` shelf-stats
  ([src/pages/shelves/\[id\].astro:64-77](src/pages/shelves/[id].astro)); `grid-cols-2`
  stats w AccountIsland.
- **E2E mobile**: tylko `3.12` w `shelf-photo-pipeline-ui.spec.ts` (`/shelves/[id]`, 375 px).
- Dark mode = ręczne override'y w `global.css` na klasach Tailwinda — standardowe klasy wystarczą.

## What We're NOT Doing

- Kamera mobilna/getUserMedia (Parked), zmiany gridów już responsywnych, rework
  ViewModeSwitcher (default „Lista" done w S-34), custom breakpointy Tailwind.

## Implementation Approach

3 fazy: (1) hamburger nav — island + restrukturyzacja headera; (2) CSS drobnica;
(3) spec E2E mobile.

## Phase 1: MobileNav (hamburger)

### Changes Required:

#### 1. MobileNav island

**File**: `src/components/MobileNav.tsx` (nowy)

**Intent**: nawigacja mobilna — przycisk hamburger + rozwijany panel (stan interakcji
→ React island, zgodnie z granicą Astro/React).

**Contract**: props `{ email: string }`. Przycisk `mobile-nav-toggle`
(`aria-expanded`, `aria-controls`, `aria-label` PL); panel `mobile-nav-panel`
(absolute pod headerem, z-40, pełna szerokość) z 5 linkami
(`mobile-nav-{library|shelves|upload|add-purchase|account}`), separatorem i stopką
email (`mobile-user-email`, truncate) + `LogoutButton` (import bezpośredni — hydratacja
w ramach islandu). Całość w wrapperze `md:hidden`.

#### 2. Restrukturyzacja headera

**File**: `src/layouts/Layout.astro`

**Intent**: desktop bez zmian wizualnych (≥768 px), mobile = hamburger + ThemeToggle.

**Contract**: header `relative flex items-center justify-between p-3 sm:p-4 md:justify-end`;
dotychczasowe linki + email + LogoutButton w `<nav class="hidden items-center gap-4 md:flex">`
(istniejące testidy desktop zostają); `<MobileNav client:load email={user.email} />` przed nav;
pojedynczy `ThemeToggle` poza oboma (widoczny zawsze — unika podwójnej instancji client:only).

#### 3. Testy unit MobileNav

**File**: `tests/unit/components/MobileNav.test.tsx` (nowy)

**Intent**: toggle (aria-expanded), render 5 linków + email + logout w panelu,
zamknięcie po drugim kliku.

### Success Criteria:

#### Automated Verification:

- Typecheck / Lint / Unit zielone; istniejące E2E desktop (auth, smoke) bez regresu

#### Manual Verification:

- (faza 3 pokrywa automatem; manual w 3.4)

---

## Phase 2: CSS drobnica

### Changes Required:

#### 1. Padding stron

**Files**: `src/pages/library.astro`, `shelves.astro`, `shelves/[id].astro`,
`photos/[id].astro`, `upload.astro`, `account.astro`, `purchase.astro` (jeśli ma `p-8`)

**Intent**: 32 px paddingu to 17 % ekranu 375 px.

**Contract**: kontener main `p-8` → `p-4 sm:p-8` (mechanicznie, bez innych zmian).

#### 2. Sztywne gridy

**Files**: `src/pages/shelves/[id].astro` (shelf-stats), `src/components/AccountIsland.tsx`

**Intent**: oddech na wąskim ekranie.

**Contract**: shelf-stats `gap-4` → `gap-2 sm:gap-4` (3 kolumny zostają);
AccountIsland stats `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`.

### Success Criteria:

#### Automated Verification:

- Typecheck / Lint / Unit zielone

#### Manual Verification:

- (faza 3 pokrywa automatem)

---

## Phase 3: E2E mobile

### Changes Required:

#### 1. Spec mobile-responsive

**File**: `tests/e2e/mobile-responsive.spec.ts` (nowy)

**Intent**: ryzyko NFR wprost z Outcome — brak poziomego scrolla + działający hamburger.

**Contract**: viewport 375×812. Helper `expectNoHorizontalScroll(page)`
(`document.documentElement.scrollWidth <= clientWidth + 1`). Scenariusze:
(a) hamburger: na 375 px `mobile-nav-toggle` widoczny, desktop `nav-library` ukryty;
klik → panel z linkami; nawigacja do /shelves działa; na 1280 px toggle niewidoczny;
(b) `/library`, `/shelves`, `/upload`, `/account` — render + no-h-scroll (realne API,
puste dane); (c) `/photos/[id]` review z mockiem API (wzorzec z
`book-to-detection-focus.spec.ts` — 2 detekcje + 1px PNG) — no-h-scroll.
Nie dubluje testu 3.12 (`/shelves/[id]` zostaje tam).

### Success Criteria:

#### Automated Verification:

- E2E: `npm run test:e2e` (nowy spec + pełna regresja)
- Typecheck / Lint / Unit

#### Manual Verification:

- Realny telefon / DevTools device mode: header, review, upload (user-only)

---

## Testing Strategy

Unit: MobileNav. E2E: hamburger flow + no-h-scroll na 5 route'ach (1 z mockiem).
Regresja: pełny suite (desktop testidy nietknięte — linki przeniesione do nav,
nie zmienione).

## References

- Roadmapa S-28 (`context/foundation/roadmap.md:462-472`)
- Research: raport agenta w sesji 2026-06-07 (mapa problemów 375 px)
- Istniejący test mobilny: `tests/e2e/shelf-photo-pipeline-ui.spec.ts` (3.12)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>`.

### Phase 1: MobileNav (hamburger)

#### Automated

- [x] 1.1 Typecheck: `npm run typecheck` — c7846fb
- [x] 1.2 Lint: `npm run lint` — c7846fb
- [x] 1.3 Unit: `npm run test` — c7846fb (4 nowe MobileNav)

### Phase 2: CSS drobnica

#### Automated

- [x] 2.1 Typecheck: `npm run typecheck` — d606ce1
- [x] 2.2 Lint: `npm run lint` — d606ce1
- [x] 2.3 Unit: `npm run test` — d606ce1

### Phase 3: E2E mobile

#### Automated

- [x] 3.1 E2E: `npm run test:e2e` — 70eea6e (147 passed / 0 failed; spec wykrył i naprawił realny overflow trybu Lista)
- [x] 3.2 Typecheck: `npm run typecheck` — 70eea6e
- [x] 3.3 Lint: `npm run lint` — 70eea6e

#### Manual

- [ ] 3.4 Realny telefon / device mode: header + review + upload (user-only)
