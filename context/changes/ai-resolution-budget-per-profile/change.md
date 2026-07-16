---
change_id: ai-resolution-budget-per-profile
title: Limity budżetu AI-resolution konfigurowalne per-profil
status: implemented
created: 2026-07-16
updated: 2026-07-17
---

## Notes

Realizacja Propozycji 7 z `modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md`
(dopisanej 2026-07-16 na wniosek właściciela repo). Dziś `AI_RESOLUTION_BUDGET_LIMITS`
(`src/lib/resolution/budgetPolicy.ts:4-8`) to trzy stałe globalne, identyczne dla każdego
użytkownika (`maxCallsPerPhoto: 3`, `maxCallsPerUserAction: 1`, `maxCallsPerDay: 20`). Ten
change przenosi dwie z nich (`maxCallsPerPhoto`, `maxCallsPerDay`) na kolumny per-profil,
edytowalne self-service przez użytkownika na `/account` — `maxCallsPerUserAction` zostaje
wewnętrzną stałą (potwierdzone w badaniu: dziś całkowicie martwy parametr, zero call-site
poza definicją).

Rozszerzenie zakresu ustalone podczas `/10x-plan` (2026-07-16): dodatkowo mechanizm miękkiego
resetu dzisiejszego licznika zużycia (`profiles.ai_resolution_daily_reset_at`), bez naruszania
append-only tabeli audytowej `resolution_calls`, oraz wskaźnik dzisiejszego zużycia w UI.

Niezależne od Propozycji 1 (`context/changes/ai-resolution-search-tool/`) — inny obszar kodu
(budżet, nie tool-calling), można wdrożyć w dowolnej kolejności względem niej.
