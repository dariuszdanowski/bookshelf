<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Model picker dla klucza BYOK openai_compatible

- **Plan**: `context/changes/byok-openai-compatible-models/plan.md`
- **Zakres**: Faza 1-3 z 3 (pełny plan)
- **Data**: 2026-07-24
- **Werdykt**: ZAAKCEPTOWANY (po auto-poprawkach)
- **Ustalenia**: 0 krytycznych, 1 ostrzeżenie, 1 obserwacja — obie naprawione inline

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | PASS |
| Bezpieczeństwo i jakość | PASS (po poprawce) |
| Architektura | PASS |
| Spójność wzorców | PASS (po poprawce) |
| Kryteria sukcesu | PASS |

## Ugruntowanie

Dwaj niezależni podagenci zweryfikowali: (1) zgodność z planem — pełny MATCH na wszystkich 5 zmienionych/nowych plikach + `tests/e2e/byok-model-picker.spec.ts`; trzy adaptacje spoza pierwotnego kontraktu (`health`, `qualified_id`, `autoComplete`) są udokumentowane w `plan-brief.md` § „Otwarte ryzyka" i w commit message `75b0333` — nie stanowią niezadokumentowanego dryfu. (2) bezpieczeństwo/jakość/wzorce — SSRF-profil identyczny z zaakceptowanym precedensem `[id]/test.ts`, plaintext klucza nigdy nie loguje się ani nie wraca w odpowiedzi, ownership check poprawny, 10s timeout poprawnie obsłużony w try/catch. Automatyczne kryteria sukcesu (lint/typecheck/testy jednostkowe 1315/1315 zielone/e2e 5/5/build) zweryfikowane bezpośrednio przed przeglądem i ponownie po zastosowaniu poprawek. Kryteria ręczne (3.6/3.7) mają realny dowód wykonania w rozmowie — user manualnie testował na żywym `cf-llm-relay`, znalazł i wspólnie ze mną zdiagnozował dwa kalibrujące problemy (pole `health`, `qualified_id`) oraz jeden pre-existing bug (autofill Chrome) — nie jest to "podpisanie na ślepo".

## Ustalenia

### F1 — Niekonsekwentna obsługa błędów DB w nowym endpoincie (brak observability na nieoczekiwany błąd)

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość / Spójność wzorców
- **Lokalizacja**: `src/pages/api/account/keys/models.ts:55-57` (przed poprawką)
- **Szczegóły**: Każdy błąd Supabase przy pobieraniu wiersza (nie tylko `PGRST116`) był kolapsowany do generycznego `404 NOT_FOUND`, bez `console.error`. Odbiega to od `[id]/test.ts:33-43` i `[id].ts:54-68`, które rozróżniają `PGRST116` (→404) od nieoczekiwanego błędu (→ zalogowany `console.error` + `500 INTERNAL_ERROR`). Przejściowa awaria DB udawałaby "klucz nie istnieje" bez żadnego sygnału do debugowania.
- **Poprawka**: Rozróżniono `PGRST116` (→404) od innych błędów (→ `console.error` + 500), zgodnie z istniejącym wzorcem z `[id]/test.ts`. Dodano test `tests/unit/pages/api/account/keys/models.test.ts` („zwraca 500 na nieoczekiwany błąd DB").
- **Decyzja**: NAPRAWIONE (zastosowano inline)

### F2 — Brak limitu rozmiaru listy modeli z zewnętrznego serwera

- **Ważność**: OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość (Performance)
- **Lokalizacja**: `src/lib/keys/probe.ts` (`listModels`)
- **Szczegóły**: Brak górnego capu na `rawList.length` przed `.filter/.map/.sort` — niesprawny lub nieprzewidywalny serwer OpenAI-compatible mógłby zwrócić nieproporcjonalnie dużą listę, kosztując CPU Workera. Niska dotkliwość (to własny, konfigurowany przez usera serwer), ale tania ochrona.
- **Poprawka**: Dodano `MAX_MODELS = 500` + `.slice(0, MAX_MODELS)` przed przetwarzaniem listy.
- **Decyzja**: NAPRAWIONE (zastosowano inline)

Wszystkie ustalenia LOW-impact z jasną rekomendacją zaaplikowane automatycznie zgodnie z trybem fast-track (`CLAUDE.md` § Workflow agenta) — bez przerywania do menu interaktywnego.
