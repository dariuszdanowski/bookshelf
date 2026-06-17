---
id: upgrade-actions-node20
title: Upgrade actions/checkout + actions/setup-node z v4 (Node 20) na v5 (Node 24) w impl-review.yml
status: archived
created: 2026-06-17
updated: 2026-06-17
---

# upgrade-actions-node20

## Problem

GitHub ogłosił deprecację Node.js 20 w GitHub Actions z dniem 2026-06-30 i usunięciem 2026-09-15.
`actions/checkout@v4` i `actions/setup-node@v4` używają Node 20 — generują ostrzeżenia w logach CI.
Pliki `ci.yml` i `deploy.yml` zostały już wcześniej zaktualizowane do `@v5` (Node 24).
Pominięty plik: `.github/workflows/impl-review.yml` (linie 22 i 27) — pozostał na `@v4`.

## Cel

Zaktualizować `impl-review.yml` do `actions/checkout@v5` i `actions/setup-node@v5` (Node 24),
eliminując deprecation warnings i zapewniając spójność z pozostałymi workflow.
