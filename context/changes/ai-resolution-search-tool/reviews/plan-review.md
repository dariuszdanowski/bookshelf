<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: search_book tool dla AI-resolution (openai_compatible/openai/openrouter)

- **Plan**: context/changes/ai-resolution-search-tool/plan.md
- **Tryb**: Głęboki
- **Data**: 2026-07-15
- **Werdykt**: SOLIDNY (po poprawkach; DO POPRAWY przed sortowaniem)
- **Ustalenia**: 0 krytycznych, 3 ostrzeżenia, 1 obserwacja — wszystkie naprawione

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | ZALICZONY |
| Martwe punkty | ZALICZONY (po F1/F2) |
| Kompletność planu | ZALICZONY (po F3/F4) |

## Ugruntowanie

5/5 ścieżek ✓ (`src/lib/resolution/client.ts`, `src/lib/resolution/prompt.ts`,
`src/lib/matching/findCandidates.ts`, `tests/unit/lib/resolution/client.test.ts`,
`modificationPlans/20260714-PROPOSAL-llm-book-search-extensions.md`), 6/6 symboli ✓
(`resolveViaOpenAICompat`, `resolveBookViaAI`, `findBookCandidates`, `ScoredCandidate`,
`AI_RESOLUTION_OPENAI_COMPAT_SYSTEM_PROMPT`, `AI_RESOLUTION_BUDGET_LIMITS`), brief↔plan ✓.
Sekcja Progress↔Faza spójna 1:1 dla obu faz.

## Ustalenia

### F1 — Równoległe tool_calls podważają własną matematykę ryzyka planu

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: § Krytyczne szczegóły implementacji + § Uwagi dotyczące wydajności
- **Szczegóły**: Plan wymagał obsługi wielu równoległych `tool_calls` w jednej rundzie bez
  górnego limitu, podczas gdy szacunek ryzyka („do 9 dodatkowych wywołań zewnętrznych")
  zakładał 1 `search_book` na rundę. `AI_RESOLUTION_BUDGET_LIMITS` liczy wywołania
  `resolveBookViaAI`, nie wywołania `findBookCandidates` wewnątrz pętli — nie chroniło przed
  burstem wewnątrz jednej rundy.
- **Poprawka A ⭐ Zalecana**: Dodać twardy limit równoległych `tool_calls` przetwarzanych w
  jednej rundzie (`MAX_PARALLEL_TOOL_CALLS = 3`, symetryczny do `MAX_TOOL_ROUNDS`).
- **Decyzja**: NAPRAWIONE (Poprawka A) — dodano `MAX_PARALLEL_TOOL_CALLS = 3`, guard w §
  Krytyczne szczegóły, skorygowany worst-case w § Uwagi dotyczące wydajności, nowy test
  case w Fazie 2.

### F2 — Mechanizm timeout/AbortController nie zaadresowany dla pętli wielorundowej

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Martwe punkty
- **Lokalizacja**: § Krytyczne szczegóły implementacji / Faza 1 §3
- **Szczegóły**: Dzisiejszy kod tworzy jeden `AbortController`/`setTimeout` na jedno
  wywołanie `fetch`. Refaktor na pętlę (do 4 sekwencyjnych requestów) nie mógł reużywać
  jednego kontrolera (`abort()` jednorazowy), a plan nie rozstrzygał, czy
  `requestTimeoutMs` jest per-request czy per-pętla.
- **Poprawka**: Jasno zdefiniować per-request `AbortController`/`setTimeout` + worst-case
  latency całej pętli.
- **Decyzja**: NAPRAWIONE — dopisano do § Krytyczne szczegóły implementacji.

### F3 — Manualny smoke test odwołuje się do logów, których Faza 1 nie definiuje

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: § Kroki testowania ręcznego (krok 3) vs Faza 1 § Kontrakt
- **Szczegóły**: Krok manualnej weryfikacji zakładał log potwierdzający wywołanie
  `search_book`, którego kontrakt Fazy 1 nie wymagał.
- **Poprawka**: Dodać wymóg logowania per rundę z `tool_calls`.
- **Decyzja**: NAPRAWIONE — dodano wymóg `console.log('[resolution:openai-compat:tool-call]',
  { round, toolCallCount })` do kontraktu Fazy 1.

### F4 — `rateLimited` z `findBookCandidates` nie jest przekazywane modelowi

- **Waga**: 📝 OBSERWACJA
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Faza 1 § Kontrakt (format wyniku narzędzia)
- **Szczegóły**: Przy rate-limicie GB model dostawałby pustą listę bez informacji, że to
  problem przejściowy, a nie „nie znaleziono".
- **Poprawka**: Dołączyć `rateLimited: true` do JSON-a zwracanego modelowi, gdy dotyczy.
- **Decyzja**: NAPRAWIONE — dopisano do kontraktu wyniku narzędzia w Fazie 1.

## Podsumowanie sortowania

Naprawiono: F1 (Poprawka A), F2, F3, F4 (4)

► Werdykt po poprawkach: **SOLIDNY** — plan gotowy do `/10x-implement`.
