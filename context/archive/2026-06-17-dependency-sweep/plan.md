---
id: dependency-sweep
title: Patch/minor dependency sweep — czerwiec 2026
status: implementing
created: 2026-06-17
updated: 2026-06-17
complexity: LOW
---

# Plan: dependency-sweep

## Problem Statement

14 pakietów z dostępnymi aktualizacjami patch/minor (dryf ~10 dni od ostatniego sweepü).
`eslint`/`@eslint/js` celowo przypięte do v9 (czekamy na `eslint-plugin-react@8`).
`wrangler` 4.100→4.101 zostanie w follow-up (dev server blokuje miniflare podczas aktualizacji).

## Decyzje

| Obszar | Decyzja | Uzasadnienie |
|---|---|---|
| eslint pin | Bez zmian (9.39.4) | `eslint-plugin-react@7.x` deklaruje peer `eslint: <=^9` |
| @eslint/js pin | Bez zmian (9.39.4) | Para z eslint — razem lub osobno |
| wrangler | 4.98→4.100 (nie 4.101) | Miniflare locked przez dev server; 4.101 w follow-up |
| @anthropic-ai/sdk | 0.102→0.104.2 explicit | 0.x caret nie podciąga przez `npm update` |

## Aktualne pliki

| Plik | Akcja |
|---|---|
| `package.json` | bumpy wersji |
| `package-lock.json` | regenerowany przez npm install |

## Fazy

### Faza 1 — npm install ze świeżymi wersjami

**Touched files:** `package.json`, `package-lock.json`

**Kroki:**
1. `npm install @anthropic-ai/sdk@0.104.2 @astrojs/cloudflare@latest @playwright/test@latest @supabase/ssr@latest @supabase/supabase-js@latest @tailwindcss/vite@latest @types/node@latest @vitest/coverage-v8@latest astro@latest prettier@latest tailwindcss@latest typescript-eslint@latest vitest@latest`
2. `npm run lint` — zielony
3. `npm run typecheck` — 0 errors
4. `npm test` — 1013/1013

**Weryfikacja:**
- `npm outdated` zwraca tylko eslint@9 + wrangler@4.100

## Success criteria

- [ ] `npm outdated` — tylko deliberate piny i wrangler follow-up
- [ ] lint/typecheck/unit — wszystkie zielone
- [ ] CI job `verify` zielony po pushu PR
