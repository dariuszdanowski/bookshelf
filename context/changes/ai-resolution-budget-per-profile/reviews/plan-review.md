<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Limity budżetu AI-resolution per-profil

- **Plan**: `context/changes/ai-resolution-budget-per-profile/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-07-16
- **Werdykt**: DO POPRAWY → wszystkie ustalenia naprawione w trakcie sortowania, patrz Decyzje
- **Ustalenia**: 1 krytyczne, 2 ostrzeżenia, 0 obserwacji

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY |
| Kompletność planu | NIEZALICZONY (przed poprawkami) → ZALICZONY (po) |

## Ugruntowanie

11/11 ścieżek plików ✓ (w tym numery linii cytowane w planie), 6/6 symboli ✓
(`isAiResolutionBudgetAvailable`, `AI_RESOLUTION_BUDGET_LIMITS`, `UpdateProfileSchema`,
RLS `profiles_update_own`, RLS `resolution_calls_user_policy`, precedens `ai_enabled` w
`database.types.ts`), brief↔plan ✓. Blast-radius (subagent `general-purpose`): brak dodatkowych
call-site'ów `isAiResolutionBudgetAvailable`/`UpdateProfileSchema` poza planem, brak
`select('*')` na `profiles` w całym `src/`, brak współdzielonego aliasu typu `Profile`, testowe
mocki `.from('profiles')` poza `resolve.test.ts` nie są zagrożone.

## Ustalenia

### F1 — Rozjazd nazwy Fazy 3 między treścią a sekcją Progress

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: linia 309 vs linia 488
- **Szczegóły**: Treść planu miała `## Faza 3: UI \`/account\`` (z backtickami), sekcja Progress
  `### Faza 3: UI /account` (bez). Realny parsing contract (`progress-format.md` § „Parsing
  contract for tooling") parsuje po numerze fazy/stanie checkboxów, nie po bajt-identycznym
  stringu, więc ryzyko praktyczne było niskie — mimo to dokładnie klasa problemu, którą ta reguła
  ma wyłapywać.
- **Fix**: Usunięto backticki z nagłówka Fazy 3 w treści planu — teraz identyczny z Progress.
- **Decyzja**: NAPRAWIONE (auto-apply, fast-track LOW impact)

### F2 — Kontrakt partial-update w profile.ts nie precyzował mechanizmu budowania `.update({...})`

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 2, punkt 2 „Endpoint profilu"
- **Szczegóły**: Plan mówił „buduje `.update({...})` tylko z podanych kluczy" bez wskazania jak —
  ryzyko, że implementator doda niepotrzebną logikę filtrującą klucze zamiast polegać na tym, że
  `JSON.stringify` (supabase-js) pomija `undefined`.
- **Fix**: Dopisano do kontraktu dokładny kształt `.update()` (wszystkie trzy pola wprost z
  `parsed.data`, z wyjaśnieniem dlaczego to wystarcza).
- **Decyzja**: NAPRAWIONE (auto-apply, fast-track LOW impact)

### F3 — Kontrakt account.astro dla licznika zużycia nie precyzował explicit filtra `.eq('user_id', ...)`

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 3, punkt 1 „SSR fetch limitów i zużycia"
- **Szczegóły**: RLS wystarcza do poprawnego scope'owania, ale repo konsekwentnie dodaje explicit
  `.eq('user_id'/'id', ...)` obok RLS (belt-and-suspenders) w każdym analogicznym query —
  kontrakt tego nie wymieniał.
- **Fix**: Dopisano `.eq('user_id', user.id)` do kontraktu query count na `resolution_calls`.
- **Decyzja**: NAPRAWIONE (auto-apply, fast-track LOW impact)

## Podsumowanie sortowania

Wszystkie 3 ustalenia naprawione bezpośrednio w `plan.md` zgodnie z regułą fast-track z
`CLAUDE.md` (auto-apply LOW/MEDIUM impact bez interactive menu). Werdykt po poprawkach:
**SOLIDNY** — plan bezpieczny do `/10x-implement`.
