# S-28: Responsywność mobilna — Plan Brief

> Full plan: `context/changes/mobile-responsive/plan.md`

## What & Why

Telefon (375 px) ma działać na ścieżkach read/write bez poziomego scrolla. Research
pokazał, że ~70 % Outcome'u już istnieje (responsywne gridy, mobile default „Lista"
z S-34, touch-owy uploader) — realny brak to header (9 elementów bez breakpointów),
padding stron i pokrycie E2E.

## Key Decisions Made (Fast track — zawetuj wyjątki)

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Hamburger | React island `MobileNav` (nie `<details>`) | Stan interakcji + aria-expanded → granica Astro/React z CLAUDE.md |
| ThemeToggle | Jedna instancja, zawsze widoczna | Dwie instancje `client:only` desynchronizowałyby stan przy resize |
| Desktop ≥768 px | Zero zmian wizualnych; istniejące testidy zostają w `<nav>` | Bez regresu E2E (auth/smoke asertują nav-*) |
| Mobilny default „Lista" | **Poza zakresem** — już done (S-34 `defaultViewMode()`) | Nie duplikujemy |
| Padding | `p-4 sm:p-8` mechanicznie na stronach | 32 px = 17 % ekranu 375 px |
| Asercja E2E | `scrollWidth <= clientWidth + 1` na 5 route'ach | Wprost mierzy ryzyko z Outcome („bez poziomego scrollowania") |

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. MobileNav | Hamburger + restrukturyzacja headera + unit | regres desktopowych testidów nav |
| 2. CSS drobnica | padding stron + 2 gridy | niski |
| 3. E2E mobile | spec 375 px (hamburger + no-h-scroll ×5) | flaky scrollWidth na fontach |

**Prerequisites:** wszystkie wcześniejsze PR-y zmergowane (✓) · **Effort:** 1 sesja, 3 fazy (M)

## Success Criteria (Summary)

- 375 px: hamburger działa, desktop bez zmian; /library, /shelves, /upload, /account,
  review — bez poziomego scrolla (asercje E2E)
- Pełna regresja unit + E2E zielona
