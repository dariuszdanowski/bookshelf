# header-nav-when-auth — Implementation Plan (Stream E micro-slice)

## Overview

Naprawia 2 powiązane UX gaps po S-02:
1. **Brak linka do `/shelves`** w UI — auth user musi wpisywać URL ręcznie (S-02 dostarczył CRUD + dedykowaną stronę, ale żadnej nawigacji do niej).
2. **Landing CTA z S-09** linkuje do `/library`, które jeszcze nie istnieje (przyjdzie w S-08) — dla auth user'a klikającego CTA = 404 (renderuje custom S-10).

Rozwiązanie: dorzucamy link „Moje półki" do existing header'a w `Layout.astro` (już renderuje się dla auth user'a z email + LogoutButton z S-01) oraz pivot CTA target z `/library` na `/shelves` w `index.astro` (do czasu aż S-08 dostarczy /library).

## Current State Analysis

- `src/layouts/Layout.astro:23-32` renderuje `<header>` tylko dla `Astro.locals.user !== null` — zawiera `<span>{user.email}</span>` + `<LogoutButton client:load />`. Klasy `flex justify-end gap-4 p-4 text-sm` — header right-aligned.
- `src/pages/index.astro` (po S-09) — `Astro.locals.user` conditional CTA dla auth user'a: button-link „Przejdź do biblioteki" → `/library`.
- `/library` route nie ma pliku Astro → middleware redirektuje anon, auth user dostaje S-10 custom 404.
- F-02 middleware whitelist: `/`, `/login`, `/signup`, `/api/auth/*`, `/api/health` — `/shelves` jest protected (auth required), co zostaje.

## Desired End State

1. **`<header>` w `Layout.astro` dla zalogowanego user'a** zawiera (od lewej do prawej):
   - Link „Moje półki" → `/shelves`
   - Email user'a (jak teraz)
   - LogoutButton (jak teraz)
2. **CTA `index.astro` dla zalogowanego** linkuje do `/shelves` (pivot z `/library`), label „Przejdź do moich półek". Comment in code referencing przyszły S-08 pivot back.
3. Anon user — bez zmian (brak header'a, landing CTAs „Zaloguj się"/„Załóż konto" jak teraz).

## What We're NOT Doing

- Brand link „BookShelf" w header'ze (→ `/`) — minimalizm, scope discipline.
- Header dla anon user'a (Zaloguj/Załóż konto w nav) — landing CTA już to pokrywa; scope creep.
- Active page indicator (focus ring / underline na current page) — przy 1 linku nie ma sensu.
- Mobile responsive hamburger menu — desktop-first per PRD §Non-Goals.
- Nawigacja do `/library` — file nie istnieje, S-08 dostarczy.
- Edycja pozostałych stron (`signup.astro`, `login.astro`) — używają Layout więc dziedziczą header (lub nie, bo anon).

## Phase 1: header nav link + landing CTA pivot

### Changes Required

1. **`src/layouts/Layout.astro`** (edit): w `<header>` block (linia ~26) dorzuć `<a href="/shelves">Moje półki</a>` PRZED `<span>{user.email}</span>`. Styling Tailwind: `text-sm font-medium text-gray-700 hover:text-gray-900` (visual hierarchy: nav link slightly subdued vs LogoutButton primary action). Header zmień klasę z `justify-end` na `justify-between` z dwoma sekcjami — left (nav) + right (email + LogoutButton). Albo prościej: zostaw `justify-end gap-4`, link będzie pierwszy po lewej (gap'em od email).

   Wybieramy **prostszy** wariant: zostawiamy `justify-end gap-4`, link „Moje półki" jako pierwszy element (po lewej od email + LogoutButton). Wystarczająca rozdzielczość wizualna.

2. **`src/pages/index.astro`** (edit): w CTA section dla `user !== null` zmień:
   - `href="/library"` → `href="/shelves"`
   - Text „Przejdź do biblioteki" → „Przejdź do moich półek"
   - `data-testid="cta-library"` → `data-testid="cta-shelves"`
   - Dorzuć short comment: `<!-- S-08 doda /library jako docelowy CTA; tymczasem prowadzi do /shelves (S-02 ready). -->`

### Success Criteria

#### Automated

- `npm run typecheck` zielony — 0 errors (Astro components zazwyczaj bez problemów typecheck'owych po małej edycji)
- `npm run lint` zielony
- `npm run test` zielony — 97/97 (regression check; brak nowych testów planowanych, edycje są wizualne)

#### Manual

- Code review: header w Layout ma `<a href="/shelves">` PRZED user.email; landing index ma CTA pointing `/shelves` z polish label

## References

- S-02 dostarczył `/shelves` route: `context/archive/2026-05-26-shelves-crud-and-purchased/`
- S-09 dostarczył landing CTA: `context/archive/2026-05-26-landing-auth-cta/`
- Layout.astro (do edycji): `src/layouts/Layout.astro`
- index.astro (do edycji): `src/pages/index.astro`
- Workflow „branch per change": `CLAUDE.md` § Workflow agenta

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: header nav link + landing CTA pivot

#### Automated

- [x] 1.1 `npm run typecheck` zielony — 0 errors (0/0/0)
- [x] 1.2 `npm run lint` zielony
- [x] 1.3 `npm run test` zielony — 97/97 (regression check)

#### Manual

- [ ] 1.4 Code review: header w Layout ma link „Moje półki" PRZED email; landing index CTA pointing `/shelves`
- [ ] 1.5 Dev/prod smoke (user, po merge + deploy): otworzyć `/login` → zalogować się → header widoczny z linkiem „Moje półki" → klik → wchodzi na `/shelves`. Również: `/` dla zalogowanego pokazuje CTA „Przejdź do moich półek" → klik → `/shelves`.
