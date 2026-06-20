# ProgressModal we wszystkich flow vision+match — Krótki plan

> Pełny plan: `context/changes/match-progress-all-flows/plan.md`

## Co i dlaczego

Ujednolicenie UX: każdy flow uruchamiający vision lub matching pokazuje modal z krokami i paskiem postępu. Po zmianie `match-vision-progress-sse` tylko `PhotoListIsland` ma 2-step modal — `PhotoUploader` i `DetectionReview` blokują użytkownika na statycznym labellu (lub w ogóle bez postępu) przez ~70s.

## Punkt wyjścia

`PhotoUploader` już renderuje 2-step ProgressModal z krokami `processing`/`matching`, ale wywołuje `/process` BEZ `?skipMatch=1` — backend robi vision + auto-match w jednym call (~70s) zanim modal przejdzie do kroku 2 (co tworzy też bug podwójnego matchowania). `DetectionReview.runRerunVision` wywołuje `/process` + stary `/match` (nie-SSE) bez żadnych kroków; `handleRerunMatch` ma SSE ale brakuje `steps` prop.

## Pożądany stan końcowy

Każdy flow vision+matching (upload, rerun-vision, rerun-match) pokazuje modal z krokami. Krok 1 „Analiza obrazu" trwa ~12s (samo vision), krok 2 „Dopasowywanie do baz książek" ~57s z paskiem postępu i tytułami. Brak podwójnego matchowania.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego |
|---|---|---|
| PhotoUploader — zmiana UI? | Nie — tylko URL `/process?skipMatch=1` | UI (2-step ProgressModal) jest już gotowe i poprawne |
| Ekstrakcja SSE w DetectionReview | Shared helper `runSSEMatch(photoId): Promise<void>` | DRY — identyczna logika w `handleRerunMatch` i `runRerunVision`; Promise pozwala na `await` |
| `steps` dla rerun-match-only | Jeden krok `{label:'Dopasowywanie', status:'active'}` | Spójne z PhotoListIsland; user widzi nazwany krok zamiast gołego labela |
| E2E route pattern | URL predicate `(url) => url.pathname === ...` | Glob `**/path` nie matchuje query stringa — precedens z bieżącej sesji |
| Test `manual-rematch.spec.ts` | Dodać mock `match-stream` (primary SSE path) | Po refaktorze `handleRerunMatch` próbuje SSE najpierw; test musi go mockować |

## Zakres

**W zakresie:**
- `PhotoUploader.tsx` — 1 linia (URL `/process?skipMatch=1`)
- `DetectionReview.tsx` — ekstrakcja `runSSEMatch`, update `runRerunVision`, `steps` prop
- Testy jednostkowe (`PhotoUploader.test.tsx`) i E2E (`upload-flow`, `match-sse-progress`, `manual-rematch`)

**Poza zakresem:**
- `PhotoListIsland` — już naprawiony
- `ProgressModal` komponent — API wystarczające
- Inne formularze (bulk-accept, confirm dialogs)

## Architektura / Podejście

```
PhotoUploader.processPhoto:
  /process?skipMatch=1 (~12s) → stage='processing' → krok 1 active
  runMatch SSE (~57s)         → stage='matching'   → krok 2 active

DetectionReview.runRerunVision:
  /process?skipMatch=1 → rerunVisionPhase='vision'   → krok 1 active
  runSSEMatch()        → rerunVisionPhase='matching'  → krok 2 active
  window.location.reload()

DetectionReview.handleRerunMatch:
  runSSEMatch()  → steps=[{Dopasowywanie, active}] + pasek
  window.location.reload()
```

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. PhotoUploader + testy | Fix 1 linii + aktualizacja 4 plików testów | URL predicate w 2 E2E specs musi objąć oba call sites |
| 2. DetectionReview refactor | Ekstrakcja helper + 2-step modal + update manual-rematch | `handleRerunMatch` jest nieprzysiężona — refaktoryzacja do Promise musi zachować fallback `/match` |

**Wymagania wstępne:** branch `change/match-progress-all-flows`; zmiana `match-vision-progress-sse` zmergowana (SSE endpoint gotowy)  
**Szacowany nakład pracy:** ~1 sesja, 2 fazy

## Otwarte ryzyka i założenia

- `manual-rematch.spec.ts` test "progress modal" polegał na fallbacku `/match` przez SSE error × 3 — po refaktorze należy zweryfikować że nowy mock `match-stream` nie zmienia logiki asercji (`progress-modal` visible podczas held request)
- `DetectionReview` nie ma unit testów dla `runRerunVision`/`handleRerunMatch` — weryfikacja jest E2E + manualna

## Kryteria sukcesu (podsumowanie)

- Upload zdjęcia → modal z 2 krokami, krok 1 ~12s, krok 2 ~57s z paskiem
- Ponów vision → identyczny 2-step modal + reload
- Ponów match → 1-step modal z paskiem + reload
- Brak podwójnego matchowania (Network tab: 1x `/process?skipMatch=1` + 1x `/match-stream` per run)
