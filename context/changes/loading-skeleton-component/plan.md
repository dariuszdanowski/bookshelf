# loading-skeleton-component — Implementation Plan (Stream E micro-slice)

## Overview

Generic React `<Skeleton />` komponent — gray pulsing div, gotowy do użycia w przyszłych widokach (S-03 photo upload progress, S-04 book candidates loading, S-08 search results). Czysty substrate — żadnego konsumenta jeszcze nie ma, więc test sprawdza props handling + ARIA attributes.

## Current State Analysis

- `src/components/` zawiera React islands: `SignupForm.tsx`, `LoginForm.tsx`, `LogoutButton.tsx`. Brak shared UI components.
- Tailwind 4 — `animate-pulse` utility class dostępne out-of-the-box.
- Vitest + jsdom + @testing-library — wzorzec testowania React components ustanowiony przez S-01 (`tests/unit/middleware.test.ts` używa vitest, ale komponenty jeszcze nie były testowane; jest setup w `tests/unit/setup.ts` importujący `@testing-library/jest-dom/vitest`).

## Desired End State

- `src/components/Skeleton.tsx` exports default `Skeleton` komponent:
  - Props: `className?: string` (override / extend domyślnego styling'u), `width?: string | number`, `height?: string | number`, `aria-label?: string` (default „Ładowanie").
  - Implementacja: `<div role="status" aria-label={...} className="animate-pulse bg-gray-200 rounded {className}" style={{width, height}}>` (jeśli `width/height` podane, applied jako inline style; inaczej parent controls via className).
- Unit testy w `tests/unit/components/Skeleton.test.tsx` — minimum 3 testy: renderuje z domyślnym aria-label, akceptuje custom className, akceptuje width/height props.

## What We're NOT Doing

- Nie konsumować tego komponentu w żadnym istniejącym pliku (nie ma jeszcze sensu — substrate dla S-03/S-04/S-08).
- Nie dodawać wariantów (`<SkeletonText />`, `<SkeletonAvatar />`) — KISS, jedna implementacja.
- Nie tykać żadnego pliku poza `src/components/Skeleton.tsx` i jego testem.
- Nie tykać `tailwind.config.*` — `animate-pulse` jest built-in.

## Phase 1: Skeleton komponent + testy

### Changes Required:

1. **`src/components/Skeleton.tsx`** (NEW): functional component z TypeScript Props interface:
   ```ts
   type SkeletonProps = {
     className?: string;
     width?: string | number;
     height?: string | number;
     'aria-label'?: string;
   };
   ```
   Default export. ARIA role=status. Tailwind `animate-pulse bg-gray-200 rounded` w base className; `{className}` mergowany na końcu.

2. **`tests/unit/components/Skeleton.test.tsx`** (NEW): minimum 3 testy używające `@testing-library/react`:
   - Renders z `role="status"` + default `aria-label="Ładowanie"`
   - Accepts custom `className` — np. `<Skeleton className="my-custom" />` w renderze pokazuje className zawierającym `my-custom`
   - Accepts `width`/`height` props i applies jako inline style — np. `<Skeleton width={100} height={50} />` → element ma `style="width:100px;height:50px"`

### Success Criteria

#### Automated

- `npm run typecheck` zielony (Props interface bez `any`)
- `npm run lint` zielony
- `npm run test` zielony — istniejące 55 testów + minimum 3 nowe dla Skeleton

#### Manual

- Code review: Props typed bez `any`; aria-label default = „Ładowanie"; Tailwind classes spójne

## References

- S-12 w roadmapie: `context/foundation/roadmap.md`
- Vitest setup (do reuse): `tests/unit/setup.ts`
- Tailwind 4 `animate-pulse`: https://tailwindcss.com/docs/animation#pulse

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Skeleton komponent + testy

#### Automated

- [x] 1.1 `npm run typecheck` zielony — Props typed bez `any` (0 errors / 0 warnings / 0 hints, 40 files)
- [x] 1.2 `npm run lint` zielony — `npx eslint src tests` zero errors (root-scan flaguje preexisting `.astro/` generated + sibling worktree dirs — poza scope tego slice'a)
- [x] 1.3 `npm run test` zielony — 59/59 passed (55 istniejących + 4 nowe Skeleton tests)

#### Manual

- [ ] 1.4 Code review: Props typed; aria-label default; Tailwind classes spójne z konwencjami projektu
