<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Bug Report → GitHub Issues

- **Plan**: `context/changes/bug-report-github/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-06-18
- **Werdykt**: SOLIDNY
- **Ustalenia**: 0 krytycznych | 1 ostrzeżenie | 1 obserwacja

## Werdykty

| Wymiar | Werdykt |
|--------|---------|
| Zgodność ze stanem końcowym | ZALICZONY ✅ |
| Oszczędne wykonanie | ZALICZONY ✅ |
| Dopasowanie architektoniczne | ZALICZONY ✅ |
| Martwe punkty | OSTRZEŻENIE ⚠️ |
| Kompletność planu | OSTRZEŻENIE ⚠️ |

## Ugruntowanie

5/5 ścieżek ✓ (src/env.d.ts, Layout.astro, api/account/keys/index.ts, ConfirmDialog.tsx, http/response.ts), symbole apiResponse/locals.user/env ✓, brief↔plan ✓

## Ustalenia

### F1 — E2E mock wskazuje na zewnętrzny URL, który Playwright NIE przechwytuje

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Kluczowe odkrycia + Faza 3 kontrakt
- **Szczegóły**: Plan twierdziło że E2E mock przez `page.route('https://api.github.com/repos/**')` to "taki sam mechanizm jak vision mock". To błędne — grep tests/e2e/*.spec.ts potwierdza że WSZYSTKIE mocki używają `page.route('**/api/**')`. Server-side fetch (endpoint → GitHub) jest poza zasięgiem Playwright. Mock github.com URL cicho nie zadziałałby lub dałby niestabilne testy.
- **Poprawka**: `page.route('**/api/feedback', ...)` jako jedyne podejście.
- **Decyzja**: NAPRAWIONE

### F2 — Sukces nie pokazywał numeru/linku issue

- **Waga**: ℹ️ OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 2, kontrakt BugReportModal
- **Szczegóły**: Auto-close po 1.5s bez wyświetlenia numeru issue. Endpoint zwraca `{ issueNumber, issueUrl }` — można pokazać użytkownikowi jako potwierdzenie.
- **Poprawka**: Wyświetl "Zgłoszenie #N →" przez 2.5s przed close.
- **Decyzja**: NAPRAWIONE
