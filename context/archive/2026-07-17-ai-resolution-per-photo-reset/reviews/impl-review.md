<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: Usunięcie blokady AI-resolution per-zdjęcie + informacyjny licznik prób

- **Plan**: context/changes/ai-resolution-per-photo-reset/plan.md
- **Zakres**: Wszystkie 4 fazy
- **Data**: 2026-07-17
- **Werdykt**: WYMAGA UWAGI → naprawione (F1, F2), F3 świadomie pominięte (pre-existing, poza zakresem)
- **Ustalenia**: 0 krytycznych, 2 ostrzeżenia (oba naprawione), 1 obserwacja (pominięta)

## Werdykty

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | PASS |
| Dyscyplina zakresu | PASS |
| Bezpieczeństwo i jakość | PASS |
| Architektura | PASS |
| Spójność wzorców | WARNING (naprawione) |
| Kryteria sukcesu | WARNING (naprawione) |

Dedykowany subagent driftu potwierdził pełny MATCH na wszystkich 12 zaplanowanych elementach
(wliczając aneks Fazy 3 punkt 4) — zero rozjazdu, zero nieplanowanych plików, wszystkie granice
"Czego NIE robimy" przestrzegane. Subagent bezpieczeństwa/jakości nie znalazł ustaleń
KRYTYCZNYCH — bezpieczne degradowanie best-effort agregacji, brak N+1, brak mutacji
`resolution_calls`, zgodność z konwencją logowania błędów i mapowania SQLSTATE.

## Ustalenia

### F1 — Agregacja per-detekcja (resolutionCostByDet/CountByDet) nie miała pokrycia testowego

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Kryteria sukcesu (uczciwość pokrycia testowego)
- **Lokalizacja**: tests/unit/pages/api/photos/[id].test.ts:112-215 vs. src/pages/api/photos/[id].ts:91-92,104,115-128,339-340
- **Szczegóły**: Oba istniejące testy GET trafiały w early-return (`latestRun=null`), nigdy nie
  docierając do mapowania wierszy konsumującego `resolutionCostByDet`/`resolutionCountByDet`.
  Błąd w logice Map przeszedłby wszystkie istniejące testy niewykryty.
- **Poprawka**: Dodano `makeFullDetectionsContext()` + nowy test
  `'agreguje koszt/liczbę prób AI-resolution per detekcja (nie tylko photo-level)'` —
  pełny mock z niepustym `latestRun`, dwiema detekcjami, wierszami `resolution_calls`
  obejmującymi dwie różne `detection_id` + jeden `detection_id: null` (dowód guarda).
  Weryfikuje `resolution_cost_usd`/`resolution_attempts_count` per detekcja.
- **Decyzja**: NAPRAWIONE (18/18 testów zielonych w `photos/[id].test.ts`)

### F2 — Nowe funkcje UI (licznik zdjęcia + połączony badge $) bez pokrycia E2E

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🔎 ŚREDNI — prawdziwy kompromis; zatrzymaj się, aby to przemyśleć
- **Wymiar**: Kryteria sukcesu / konwencja repo
- **Lokalizacja**: tests/e2e/cost-panel.spec.ts (istniejący plik, nie dotknięty w oryginalnym diffie)
- **Szczegóły**: `cost-panel.spec.ts` już testował te same powierzchnie UI (vision-run-panel +
  badge $ per detekcja), ale mocki nie ustawiały `resolution_cost_usd`/`resolution_attempts_count`
  — nowa logika nie miała strażnika end-to-end. Plan świadomie zawęził E2E Fazy 4 do
  `account.spec.ts`, co koliduje z konwencją CLAUDE.md § Testy (E2E dla zmian UI nie do pominięcia).
- **Poprawka**: Dodano detekcję DET_3 (OCR + AI-resolution) do fixture'a + 3 nowe testy:
  licznik prób widoczny w panelu zdjęcia, badge $ łączy oba koszty z tooltipem liczby prób,
  klik $ pokazuje wpis AI w rozwijanym panelu. Przy okazji poprawiono `costs_total_usd`/`totals`
  w fixture na spójną sumę (0.0231) — dwa istniejące testy zaktualizowane, żeby odzwierciedlić
  realistyczny wpływ nowego kosztu na sumę zdjęcia (bez tego byłaby to fałszywa spójność fixture'a).
- **Decyzja**: NAPRAWIONE (14/14 testów zielonych w `cost-panel.spec.ts`, w tym jeden transient
  flake w `beforeEach` niezwiązany ze zmianą, potwierdzony powtórnym zielonym przebiegiem)

### F3 — Martwy rzut `as any` obok nowego, czysto typowanego zapytania (pre-existing)

- **Ważność**: OBSERWACJA
- **Wymiar**: Spójność wzorców (poza zakresem tego diffu)
- **Lokalizacja**: src/pages/api/photos/[id].ts:96-103 (refine_calls) + src/pages/api/photos/[id]/costs.ts:42-44,68-71 (nieedytowany plik)
- **Szczegóły**: Ten sam diff dowodzi, że rzut `(locals.supabase as any)` na `refine_calls`
  jest już zbędny — ale to kod pre-existing, poza zakresem tej zmiany.
- **Decyzja**: POMINIĘTE — pre-existing, poza zakresem tego cyklu; kandydat do osobnego,
  małego follow-upu.
