---
id: dependency-sweep
title: Patch/minor dependency sweep — czerwiec 2026
---

# Plan Brief — dependency-sweep

**Zmiana**: `npm install` 13 pakietów patch/minor. Piny celowe: `eslint@9`+`@eslint/js@9` (czekamy na `eslint-plugin-react@8`), `wrangler` 4.100 (dev server blokuje miniflare).

**Dlaczego**: dryf 10+ dni, 14 pakietów za starszą wersją po ostatnim sweepie.

**Jedyna faza**: `npm install` → lint/typecheck/unit (wszystkie zielone). Brak zmian w kodzie źródłowym.
