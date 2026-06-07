<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cost Analysis View (S-41)

- **Plan**: context/changes/cost-analysis-view/plan.md
- **Scope**: Phase 1–2 of 2 (full plan, post-merge PR #80/#81)
- **Date**: 2026-06-07
- **Verdict**: APPROVED (z 2 warningami — fixy skolejkowane)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS (obserwacje) |
| Success Criteria | PASS |

Security headline POTWIERDZONY: `security_invoker = true` w 0021:9 (pierwszy widok w repo — bez tego byłby RLS bypass), izolacja A/B dowiedziona testem integracyjnym w CI (step green w run 27103317098), endpoint dodatkowo `eq('user_id')` na obu zapytaniach (defense-in-depth ponad plan), zero service-role, envelope F-02 z `private, no-store`. Guardraile „NOT doing" respektowane (stats.ts nietknięty, brak wykresów/CSV/backfillu).

## Findings

### F1 — Przycisk „Spróbuj ponownie" w error state jest no-opem

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/CostAnalysisModal.tsx:239
- **Detail**: `onClick={() => setPage((p) => p)}` — setState na identyczną wartość → React bailout → effect fetch (deps [filterKey, filterType, filterPeriod, page]) nie odpala się. Po błędzie sieci jedyny ratunek to przełączenie filtra lub reopen modala. Plan wymagał „error state z retry"; retry nie działa i nie jest pokryty żadnym testem (unit ani E2E — brak scenariusza error-path, wbrew regule „pełne scenariusze, nie tylko happy path").
- **Fix**: Stan `refetchNonce` w deps effecta + `onClick={() => setRefetchNonce(n => n + 1)}`; dołożyć unit test retry + E2E error-path (500 → error visible → retry → refetch).
- **Decision**: PENDING

### F2 — `formatCost(0)` zmienia rendering CostPanel wbrew „zero zmian zachowania"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/costs/format.ts:10
- **Detail**: Ekstrakcja dodała branch `usd === 0 → '$0.0000'`; oryginał w CostPanel zwracał `'<$0.0001'` dla 0. Plan deklarował „Zero zmian zachowania". Drift literalny, arguably poprawa ($0 ≠ „mniej niż cent").
- **Fix**: Zaakceptować i odnotować (ten wpis = write-back); alternatywnie przywrócić stare zachowanie — nie rekomendowane, '$0.0000' jest semantycznie poprawniejsze.
- **Decision**: PENDING

### F3 — E2E: lokatory testId-only + fixtures z niepoprawnymi UUID

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/account-costs.spec.ts:14,28,41 + całość
- **Detail**: (a) Lokatory wyłącznie `getByTestId`, mimo dostępnych aria-labels („Zamknij", „Filtruj po kluczu", „Szczegóły", „Następna") — zgodne z house style (13× getByRole na 28 speców), ale reguła repo mówi getByRole/getByLabel primary; (b) `MOCK_KEY.id = '...k1'` ('k' nie-hex) i `ev-...` nie przechodzą `CostEventsQuerySchema` — działają tylko bo endpoint w pełni zmockowany; prefiltr `key=<id>` dostałby 400 od realnego endpointu. Fixtures powinny być contract-compatible.
- **Fix**: Poprawić fixtures na walidne hex UUID; lokatory wymieniać przy okazji (nowe specy = miejsce na zginanie krzywej).
- **Decision**: PENDING

### F4 — Endpoint: redundantny count + sekwencyjne awaity

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/api/account/costs.ts:85,109-124
- **Detail**: Query sumy pobiera wszystkie pasujące `cost_usd` → `sumResult.data.length` już JEST total_count; `count: 'exact'` na page query to drugi pełny count tego samego predykatu. Dodatkowo dwa niezależne zapytania awaited sekwencyjnie zamiast `Promise.all`. Skala osobista — bez znaczenia praktycznego.
- **Fix**: Przy następnym dotknięciu pliku: total_count z sum query + Promise.all (lub agregat SQL).
- **Decision**: PENDING

### F5 — Testy: asercje dekoracyjne (nazwa obiecuje, mock połyka argumenty)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/pages/api/account/costs.test.ts:43-60,208
- **Detail**: Builder mockuje eq/is/gte/range jako no-opy bez przechwytywania argumentów — test „paginacja page=2 — range (25,49)" nie asertuje range args; `is('api_key_id', null)`, granica `gte`, `eq('user_id')` (linia defense-in-depth) nieasertowane. Izolacja danych pokryta testem integracyjnym RLS, więc belt-and-suspenders; ale refactor mógłby cicho usunąć user_id eq.
- **Fix**: Captured-args w builderze + asercje przy następnym dotknięciu testów.
- **Decision**: PENDING

### F6 — Drobne adaptacje nieoflagowane (skonsolidowane, do świadomości)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/AccountIsland.tsx:24,~910
- **Detail**: (a) Z 2 planowanych konsolidacji formatCost wykonano 1 — `formatUsd` (:24) zachowany, bo ma inną semantykę (toFixed(2) powyżej $0.01); adaptacja słuszna, nieoflagowana; (b) tooltip chipa stracił disclaimer o wywołaniach sprzed atrybucji (zastąpiony „Kliknij, by zobaczyć szczegóły") — utrata informacji, prawdopodobnie zamierzona.
- **Fix**: Brak akcji; ten wpis pełni rolę write-backu do planu.
- **Decision**: PENDING

## Success criteria — weryfikacja

| Kryterium | Wynik |
|---|---|
| 1.1 db reset (migracja) | ✅ (odhaczone z SHA; CI e2e step „Start local Supabase" + migracje green) |
| 1.3 integracja RLS w CI | ✅ run 27103317098, step „Run integration tests (RLS isolation)" = success |
| typecheck / lint / unit / build | ✅ green (lokalnie 2026-06-07 + CI verify job success) |
| e2e account-costs | ✅ green w CI (failure joba dotyczy single-bbox-edit z PR #79 — zob. impl-review camera-capture F1) |
| Manual 2.7–2.9 | ✅ odhaczone przez usera (realne dane prod) |
