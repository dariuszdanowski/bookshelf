---
id: upgrade-actions-node20
title: Upgrade actions v4→v5 w impl-review.yml
---

# Plan Brief — upgrade-actions-node20

**Zmiana**: `actions/checkout@v4`→`@v5` + `actions/setup-node@v4`→`@v5` w `.github/workflows/impl-review.yml` (linie 22 i 27).

**Dlaczego**: GitHub deprecuje Node 20 w akcjach od 2026-06-30. `ci.yml` i `deploy.yml` już na `@v5`. Zostało tylko `impl-review.yml`.

**Jedyna faza**: 2 linie w 1 pliku. Commit, push, PR z etykietą `impl-review`.
