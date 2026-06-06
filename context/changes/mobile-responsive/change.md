---
change_id: mobile-responsive
title: "S-28: Responsywność mobilna (375px) — hamburger nav + CSS drobnica + E2E"
status: planned
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Slice S-28 z roadmapy. Research (2026-06-07) pokazał, że fundamenty już istnieją:
gridy książek/detekcji responsywne (2→3→4→5 kolumn), PhotoListIsland `flex-col sm:flex-row`,
ShelfForm/ShelfListItem mobile-first, drop-zone ma click-fallback (touch OK),
**mobilny default „Lista" w S-25/S-34 już zaimplementowany** (`defaultViewMode()`
z matchMedia w ViewModeSwitcher). Realny brak: header nav (9 elementów w jednym
rzędzie, zero breakpointów), page-padding `p-8` (32 px na 375 px), 2 sztywne gridy
(shelf-stats, AccountIsland) i pokrycie E2E (1 test mobilny, 1 route).

## Outcome

Na 375 px: header składa się do hamburgera (React island `MobileNav`, panel z
5 linkami + email + wyloguj; desktop ≥768 px bez zmian); strony z paddingiem
`p-4 sm:p-8`; shelf-stats i AccountIsland bez ciasnoty; ścieżki read (library,
shelves, widok półki) i write (upload, review) bez poziomego scrolla — pokryte
nowym specem E2E `mobile-responsive.spec.ts` (viewport 375×812 + asercja
`scrollWidth <= clientWidth` + hamburger flow).
