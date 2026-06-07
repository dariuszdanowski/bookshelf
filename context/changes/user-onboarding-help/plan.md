# S-38: Onboarding i pomoc kontekstowa — Implementation Plan

## Overview

Trzy warstwy pomocy (M7): instruktażowe empty states, kontekstowe popovery „?",
strona `/help`. Bez tour-biblioteki (poza zakresem — follow-up).

## Current State Analysis

- Empty states istnieją technicznie (`photo-list-empty`, pusta lista półek/katalogu),
  ale komunikują stan, nie uczą następnego kroku.
- Zero pomocy kontekstowej; jedyne wyjaśnienia siedzą w labelach (np. „dodatkowa
  analiza AI — płatne" przy refine z S-35).
- `docs/screenshots/` ma 6 aktualnych zrzutów (odświeżane automatem
  `screenshots.spec.ts`) — gotowy materiał dla `/help`.
- Wzorzec popovera nie istnieje — `MarkerTooltip` w overlay jest najbliższy,
  ale specyficzny (fixed, pozycjonowany od kursora).

## Desired End State

Użytkownik bez wiedzy o aplikacji przechodzi golden path prowadzony przez UI;
„?" wyjaśnia nietrywialne decyzje w miejscu ich podjęcia; `/help` służy jako
spis treści + FAQ (m.in. koszty vision/BYOK).

## What We're NOT Doing

- Tour/spotlight (driver.js) — osobny slice, jeśli empty states nie wystarczą.
- Wyszukiwarka pomocy, czat, i18n. Zmiany w API — zero.

## Implementation Approach

3 fazy niezależnie shippowalne; komponent `HelpTip` (React, popover po kliknięciu,
zamykany Esc/klik poza — konwencja modali repo) jako wspólny klocek fazy 2.

## Phase 1: Instruktażowe empty states

**Files**: `ShelvesIsland`, `PhotoListIsland` (empty), `ShelfBooksIsland` (empty),
`CatalogSearchIsland` (empty), `DetectionReview` (brak detekcji — istnieje, doszlifować CTA)

**Intent**: każdy pusty stan = 1 zdanie „co to" + 1 przycisk następnego kroku
(np. pusta półka → „+ Dodaj zdjęcie" / „+ Dodaj książkę ręcznie"; pusty katalog →
link do /upload).

**Contract**: czysty JSX/treść; testidy `*-empty` zostają (rozszerzenie treści,
nie wymiana). Unit: asercje na CTA w empty state.

## Phase 2: HelpTip — kontekstowe „?"

**Files**: `src/components/HelpTip.tsx` (nowy) + wpięcia: progi dopasowania
(legenda review przy %), RefineButton (koszt), sekcja BYOK na /account,
checkbox „Analizuj od razu" (S-36), dedup-warning uploadu, przełączniki trybów.

**Intent**: 2–3 zdania wyjaśnienia przy decyzjach kosztowych/nietrywialnych.

**Contract**: `<HelpTip label="...">treść</HelpTip>` — przycisk `?` (aria-label,
aria-expanded), popover absolute, Esc/klik-poza zamyka, `useBodyScrollLock` NIE
(popover, nie modal). Testid `help-tip-{slug}`. Unit testy komponentu + 1 wpięcia.

## Phase 3: Strona /help

**Files**: `src/pages/help.astro` (nowa, server-only), link w nav (desktop + MobileNav),
sekcja w `/account`? (nie — tylko nav)

**Intent**: przewodnik golden path (upload → review → akceptacja → katalog)
z 6 screenshotami z `docs/screenshots/`, sekcja kosztów (vision/BYOK/refine), FAQ
(dedup, tryby widoku, „dlaczego match nie znalazł" → odsyłacz do ręcznego szukania).

**Contract**: czysta strona Astro (`prerender = false` jak reszta protected? —
help może być publiczny: whitelist w middleware jak `/login`; decyzja: publiczny,
bez danych usera). E2E: nav → /help renderuje sekcje; mobile bez h-scrolla.

## Testing Strategy

Unit: HelpTip (open/close/Esc/aria) + empty-state CTA. E2E: /help (nav, render,
375 px no-h-scroll — dopisać route do `mobile-responsive.spec.ts`).

## References

- Uwaga M7 + rekomendacja warstw: raport sesji 2026-06-07
- Materiał: `docs/screenshots/*`, istniejące teksty kosztowe S-35

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>`.

### Phase 1: Instruktażowe empty states

#### Automated

- [ ] 1.1 Typecheck / Lint / Unit zielone

### Phase 2: HelpTip — kontekstowe „?"

#### Automated

- [ ] 2.1 Typecheck / Lint / Unit zielone (testy HelpTip + wpięcie)

### Phase 3: Strona /help

#### Automated

- [ ] 3.1 Typecheck / Lint / Unit / E2E zielone (w tym /help w mobile-responsive)

#### Manual

- [ ] 3.2 Przejście golden path „oczami nowego usera" (user-only)
