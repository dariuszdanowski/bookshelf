<!-- IMPL-REVIEW-REPORT -->
# Przegląd implementacji: AI book resolution przez BYOK openai_compatible provider

- **Plan**: `context/changes/resolution-openai-compatible-provider/plan.md`
- **Zakres**: Faza 4 z 4 (pełny plan)
- **Data**: 2026-07-14
- **Werdykt**: WYMAGA UWAGI → wszystkie ustalenia naprawione w trakcie sortowania (fast-track auto-apply, LOW impact)
- **Ustalenia**: 0 krytycznych, 3 ostrzeżenia, 1 obserwacja — wszystkie NAPRAWIONE lub potwierdzone jako zamierzone

## Werdykty (przed poprawkami)

| Wymiar | Werdykt |
|-----------|---------|
| Zgodność z planem | WARNING |
| Dyscyplina zakresu | WARNING (uzasadnione rozszerzenia) |
| Bezpieczeństwo i jakość | WARNING |
| Architektura | PASS |
| Spójność wzorców | WARNING |
| Kryteria sukcesu | PASS |

## Ustalenia

### F1 — vision/client.ts nie łapie błędu parsowania odpowiedzi HTTP

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Bezpieczeństwo i jakość
- **Lokalizacja**: src/lib/vision/client.ts:162 (detectSpinesOpenAICompat)
- **Szczegóły**: `resp.json()` nie było w try/catch, w przeciwieństwie do analogicznego miejsca w resolution/client.ts. 200 OK z niepoprawnym JSON-em (realny scenariusz dla self-hosted serwerów) powodowało nieobsłużony throw — traconą telemetrię corrections w process.ts i potencjalny raw throw w refine.ts (łamie regułę CLAUDE.md).
- **Poprawka**: Owinięto `resp.json()` w try/catch zwracający `{ok:false}`, skopiowano wzorzec z resolution/client.ts. Dodano test regresyjny.
- **Decyzja**: NAPRAWIONE — src/lib/vision/client.ts + nowy test w tests/unit/lib/vision/client.test.ts.

### F2 — Adaptacje literalne nieopisane w plan.md

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Zgodność z planem (dokumentacja)
- **Lokalizacja**: context/changes/resolution-openai-compatible-provider/plan.md
- **Szczegóły**: Normalizacja base_url i fix vision_runs.model były oflagowane w commit message ale nie w plan.md (drugi krok reguły "Adaptacje literalne" z CLAUDE.md).
- **Poprawka**: Dopisano aneks do Fazy 4 plan.md z opisem obu adaptacji i odniesieniem do commitów.
- **Decyzja**: NAPRAWIONE — plan.md § Faza 4 aneks.

### F3 — Cost-hint przycisku AI resolution pozostaje statycznie "płatne" dla openai_compatible

- **Ważność**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka jest oczywista i wąsko zakrojona
- **Wymiar**: Spójność wzorców / Zgodność z planem
- **Lokalizacja**: src/components/DetectionReview.tsx:168-184 (AiResolutionButton, cost-hint)
- **Szczegóły**: Faza 4 naprawiła tooltip/dialog/busyLabel by nie mówiły "płatne" dla non-Anthropic, ale sąsiedni cost-hint pozostał bezwarunkowy — niespójne z resztą tej samej fazy.
- **Poprawka**: Warunkowano tekst hinta na `activeProviderIsAnthropic === false`, identycznie jak pozostałe 3 elementy.
- **Decyzja**: NAPRAWIONE — DetectionReview.tsx.

### F4 — Martwy kod: AI_RESOLUTION_PROVIDER_UNSUPPORTED handling

- **Ważność**: 👁️ OBSERWACJA
- **Wpływ**: 🏃 NISKI
- **Wymiar**: Spójność wzorców
- **Lokalizacja**: DetectionReview.tsx:1047-1053, http/response.ts:22
- **Szczegóły**: Backend już nigdy nie zwraca tego kodu (guard zdjęty w Fazie 3) — to dokładnie to, co plan świadomie przewidział i zaakceptował ("zostaw jako dead-but-harmless defensive branch").
- **Decyzja**: ZAAKCEPTOWANE — zgodne z jawną decyzją planu, brak akcji.
