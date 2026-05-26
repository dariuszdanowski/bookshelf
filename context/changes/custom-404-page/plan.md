# custom-404-page — Implementation Plan (Stream E micro-slice)

## Overview

Astro renderuje `src/pages/404.astro` dla unmatched routes. Zastępujemy default białą stronę „Page not found" custom version używającą `Layout.astro`. Plain Tailwind, conditional na `Astro.locals.user`: zalogowany dostaje link do `/library`, anonymous teoretycznie nigdy nie zobaczy 404 (middleware redirektuje wcześniej) — ale dla bezpieczeństwa pokazujemy też CTA „Zaloguj się".

## Current State Analysis

- Brak `src/pages/404.astro` → Astro używa wbudowanego default 404 page.
- `Layout.astro` istnieje i renderuje header z user info + LogoutButton dla zalogowanego.
- Middleware (F-02) redirektuje unauth na `/login` dla wszystkich non-public paths — więc dla anonymous'a 404 prawdopodobnie nie ląduje, ale Astro 404 może być triggered w specyficznych scenariuszach (np. statyczne assets miss).

## Desired End State

- Nowy plik `src/pages/404.astro` renderuje:
  - Tytuł „Nie znaleziono strony"
  - Krótki opis
  - 1 CTA button: zalogowany — „Wróć do biblioteki" (`/library`); niezalogowany — „Wróć do strony głównej" (`/`).
- Używa `Layout.astro` (jak inne strony).
- Tailwind styling spójny z resztą app.

## What We're NOT Doing

- Nie tykać `src/lib/middleware/handler.ts` (poza scope; pozostałe slice'y też nie tykają).
- Nie dodawać Easter eggów ani fancy animacji.
- Nie tykać `Layout.astro` ani `index.astro` (osobny slice S-09 landing-auth-cta zajmie się indexem).
- Nie dodawać shadcn/ui ani innych nowych komponentów.

## Phase 1: Create 404.astro

### Changes Required:

1. **`src/pages/404.astro`** (NEW): Astro page używająca `Layout.astro` z `title="Nie znaleziono"`. Frontmatter pobiera `const user = Astro.locals.user`. Body: `<main class="...">`  z h1 + p + conditional CTA `<a>` (jak w S-09 styling — `inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium`).

### Success Criteria

#### Automated

- `npm run typecheck` zielony (`astro check` widzi nowy plik)
- `npm run lint` zielony
- `npm run test` zielony — istniejące 55 testów (regression)

#### Manual

- Code review: 404.astro używa Layout + locals.user; styling Tailwind spójny

## References

- S-10 w roadmapie: `context/foundation/roadmap.md`
- Layout (do reuse): `src/layouts/Layout.astro`
- Astro 404 docs: https://docs.astro.build/en/basics/astro-pages/#custom-404-error-page

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Create 404.astro

#### Automated

- [ ] 1.1 `npm run typecheck` zielony
- [ ] 1.2 `npm run lint` zielony
- [ ] 1.3 `npm run test` zielony — istniejące 55 testów (regression check)

#### Manual

- [ ] 1.4 Code review: 404.astro używa Layout + locals.user; styling Tailwind spójny
