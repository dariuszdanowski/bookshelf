# landing-auth-cta — Implementation Plan (Stream E micro-slice)

## Overview

Niezalogowany na `/` widzi 2 CTA „Zaloguj się" (→ `/login`) i „Załóż konto" (→ `/signup`). Zalogowany widzi 1 CTA „Przejdź do biblioteki" (→ `/library`). LogoutButton po wylogowaniu redirektuje na `/login` (zamiast obecnego `/`). Pure UI polish; zero ryzyka technicznego.

## Current State Analysis

- `src/pages/index.astro` to landing page Astro SSR — text-only placeholder z M1 bootstrap. `Astro.locals.user` dostępne (F-02), ale niezużywane.
- `src/components/LogoutButton.tsx:18` ma `window.location.href = '/'` — chcemy `'/login'`.
- F-02 middleware whitelist `'/'` i `'/login'` jako public — działa dla obu stanów.

## Desired End State

- `/` dla niezalogowanego: tekst landing + sekcja z 2 buttonami CTA (Tailwind styling spójny z resztą app).
- `/` dla zalogowanego: tekst landing + 1 button „Przejdź do biblioteki".
- Po kliknięciu LogoutButton: redirect na `/login` (cookies sb-* scleared, user trafia od razu na ekran logowania).

## What We're NOT Doing

- Nie tykać `src/lib/middleware/handler.ts` (poza scope tego slice'a; S-11 będzie to edytował dla `/api/health`).
- Nie tykać `src/lib/db/**`, `src/pages/api/**`, `supabase/migrations/**`.
- Nie dodawać nawigacji typu „header z menu" (osobny micro-slice jeśli ktoś chce).
- Nie dodawać nowych shadcn/ui komponentów — używać plain Tailwind + native button.

## Phase 1: Update index.astro + LogoutButton

### Changes Required:

1. **`src/pages/index.astro`** (edit): pod istniejącym pitch text dorzucić conditional section:
   - Jeśli `Astro.locals.user === null`: dwa `<a>` linki stylizowane jako buttony (`href="/login"` i `href="/signup"`).
   - Jeśli `Astro.locals.user !== null`: jeden `<a href="/library">` button „Przejdź do biblioteki".
   - Styling Tailwind: `inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium`, primary CTA hover state.

2. **`src/components/LogoutButton.tsx`**: zmień linię 18 `window.location.href = '/'` na `'/login'`. Zaktualizuj JSDoc komentarz (linia 6) — „po reloadzie user wraca na anon state na `/login`".

3. **`tests/unit/components/LogoutButton.test.tsx`** (NOWY): minimum 1 test sprawdzający że po `onClick` `window.location.href` ma wartość `/login`. Mock `fetch` (`vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())`); mock `window.location` (`Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })` lub przez `vi.stubGlobal`).

### Success Criteria

#### Automated

- `npm run typecheck` zielony
- `npm run lint` zielony
- `npm run test` zielony — istniejące 55 testów + minimum 1 nowy dla LogoutButton

#### Manual

- Code review: `index.astro` ma conditional na `locals.user`; LogoutButton.tsx ma `'/login'`

## References

- S-09 w roadmapie: `context/foundation/roadmap.md`
- F-02 middleware (już whitelistuje `/login` jako public): `src/lib/middleware/handler.ts`
- LogoutButton (do edycji): `src/components/LogoutButton.tsx`
- Layout (już renderuje header dla zalogowanego — bez zmian tutaj): `src/layouts/Layout.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Update index.astro + LogoutButton

#### Automated

- [x] 1.1 `npm run typecheck` zielony — baseline 1 error w `src/lib/db/supabase.server.ts` (cloudflare:workers module resolution) pre-existing, poza scope tego slice'a; slice nie wprowadza nowych błędów typów
- [x] 1.2 `npm run lint` zielony
- [x] 1.3 `npm run test` zielony — 57/57 (55 baseline + 2 nowe dla LogoutButton: /login redirect happy path + idempotent po fetch reject)

#### Manual

- [ ] 1.4 Code review: index.astro conditional na locals.user; LogoutButton href = '/login'
