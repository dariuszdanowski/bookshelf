---
id: upgrade-actions-node20
title: Upgrade actions/checkout + actions/setup-node v4→v5 w impl-review.yml
status: implementing
created: 2026-06-17
updated: 2026-06-17
complexity: LOW
---

# Plan: upgrade-actions-node20

## Problem Statement

`impl-review.yml` używa `actions/checkout@v4` i `actions/setup-node@v4`, które opierają się
na Node.js 20 — zdeprecjonowanym przez GitHub od 2026-06-30, usuwanym 2026-09-15.
`ci.yml` i `deploy.yml` już mają `@v5` (Node 24). Pozostał jeden niespójny plik.

## Decyzje (fast-track)

| Obszar | Decyzja | Uzasadnienie |
|---|---|---|
| Zakres | Tylko `impl-review.yml` linie 22 i 27 | `ci.yml` + `deploy.yml` już na `@v5` |
| Wersja docelowa | `@v5` (checkout) + `@v5` (setup-node) | Aktualna major, Node 24, zero breaking changes dla naszego use-case |
| `node-version` pin | Bez zmian (`22.13.0`) | v5 akceptuje ten sam format; pinowanie wersji runtime to oddzielna decyzja |
| Testy weryfikujące | CI job `verify` + job `impl-review` w pipelines (manual trigger) | Automatyczne — lint/build/typecheck wystarczają dla change tej klasy |
| Migracja danych | Brak | Zmiana wyłącznie w konfiguracji CI |

## Aktualne pliki

| Plik | Akcja |
|---|---|
| `.github/workflows/impl-review.yml` | Zmiana `checkout@v4`→`@v5`, `setup-node@v4`→`@v5` |
| Pozostałe pliki | Brak zmian |

## Fazy

### Faza 1 — Upgrade akcji w impl-review.yml

**Touched files:** `.github/workflows/impl-review.yml`

**Kroki:**
1. Linia 22: `uses: actions/checkout@v4` → `uses: actions/checkout@v5`
2. Linia 27: `uses: actions/setup-node@v4` → `uses: actions/setup-node@v5`

**Weryfikacja:**
- `grep "checkout@\|setup-node@" .github/workflows/impl-review.yml` — brak `@v4`
- `npm run lint` zielony (workflow YAML nie wchodzi w zakres ESLint, ale jako sanity check)
- `npm run build` zielony

**Commit:** `chore(upgrade-actions-node20): checkout@v4→v5 + setup-node@v4→v5 w impl-review.yml`

## Success criteria

- [ ] `impl-review.yml` nie zawiera `@v4` dla checkout/setup-node
- [ ] Wszystkie trzy pliki workflow spójne na `@v5`
- [ ] CI job `verify` zielony po push brancha
- [ ] Brak deprecation warnings Node.js 20 w logach impl-review
