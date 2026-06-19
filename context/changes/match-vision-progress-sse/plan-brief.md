# Match & Vision Progress (SSE) — Krótki plan

> Pełny plan: `context/changes/match-vision-progress-sse/plan.md`

## Co i dlaczego

Zastępujemy indeterminate ProgressModal w fazie dopasowywania książek realnym SSE streamem z backendu. Użytkownik widzi listę rozpoznanych tytułów pojawiających się jeden po drugim oraz determinate pasek postępu (X / N detekcji).

## Punkt wyjścia

ProgressModal (dostarczony w slice `progress-modal`, PR #109) to pulsujący pasek + statyczny label. Wszystkie operacje match używają synchronicznego `fetch` — klient czeka bez informacji. `runner.ts` już przetwarza detekcje w pętli (MAX=5 concurrent) — każde zakończenie jest naturalnym punktem do emisji eventu.

## Pożądany stan końcowy

Po zakończeniu: upload zdjęcia wchodzi w fazę matching → ProgressModal pokazuje sukcesywnie tytuy książek + pasek postępu „3 / 5 dopasowane". PhotoListIsland przy ponownym matchowaniu — identyczny UX. Faza vision pozostaje bez zmian (Claude Vision = 1 LLM call, cały JSON naraz).

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) | Źródło |
|---|---|---|---|
| Które operacje → SSE | Tylko match phase | Vision zwraca pełny JSON; match = N detekcji = natural X/total | Plan |
| Endpoint strategy | Nowy GET /match-stream, POST /match zostaje | EventSource wymaga GET; backwards compat; fallback sync | Plan |
| SSE transport | Native ReadableStream + TextEncoder (brak lib) | CF Workers native; projekt bez zewnętrznych HTTP libs | Plan |
| ProgressModal | Extend props (titles?, progress?) — nie nowy komponent | DRY; backwards compat | Plan |
| FE scope | PhotoUploader + PhotoListIsland (nie DetectionReview rematch) | Rematch = 1 detekcja, SSE overhead bez sensu | Plan |
| Fallback | EventSource error 3× → silent fallback do sync POST /match | Resilience bez crash UX | Plan |
| SSE dla vision | Nie | Claude Vision = 1 LLM call, full JSON jednorazowo | Plan |

## Zakres

**W zakresie:**
- `src/lib/matching/runner.ts` — NOWY: ekstrakcja `settledWithConcurrency` + `matchDetection` z `match.ts` + `onProgress`
- `src/pages/api/photos/[id]/match-stream.ts` — nowy GET SSE endpoint
- `src/components/ProgressModal.tsx` — extend props `titles?`, `progress?`
- `src/components/PhotoUploader.tsx` — EventSource dla match phase
- `src/components/PhotoListIsland.tsx` — EventSource dla runMatch
- E2E: page.route() mock SSE + asercje na modal

**Poza zakresem:**
- SSE dla vision/process phase
- SSE dla rematch/refine w DetectionReview
- Zmiany schematu DB
- Biblioteki SSE / polyfille

## Architektura / Podejście

```
FE: EventSource → GET /api/photos/[id]/match-stream
      ↓ (SSE stream)
BE: ReadableStream → runMatchingConcurrent(inputs, env, onProgress)
      ↓ (per detekcja)
    onProgress({index, total, title, detectionId})
      ↓
    controller.enqueue("event: progress\ndata: {...}\n\n")
      ↓ (na końcu)
    controller.enqueue("event: done\ndata: {...}\n\n")
    controller.close()
      ↓
FE: accumuluje titles[], updates progress{current, total}
    → ProgressModal(titles=..., progress=...)
```

Fallback: `EventSource.onerror` (3×) → `source.close()` → `fetch POST /match` (sync) → ProgressModal indeterminate.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Backend | runner.ts + GET /match-stream (weryfikowalny curl) | CF Workers ReadableStream flush timing |
| 2. ProgressModal | Extend UI (titles list + determinate bar) | Edge case total=0 (brak detekcji) |
| 3. Frontend EventSource | PhotoUploader + PhotoListIsland z live progress | EventSource error handling + fallback |
| 4. E2E tests | page.route() mock SSE → asercje na modal | Playwright SSE mock format (text/event-stream body) |

**Wymagania wstępne:** Zainstalowany Playwright (jest), ProgressModal zaimportowany w FE (jest). Uwaga: `runner.ts` NIE ISTNIEJE — Faza 1.1 tworzy go przez ekstrakcję z `match.ts`.
**Szacowany nakład:** ~2 sesje, 4 fazy atomiczne.

## Otwarte ryzyka i założenia

- CF Workers ReadableStream: backpressure przy bardzo dużej liczbie detekcji (>50) — w praktyce kolekcje domowe mają 5-20 detekcji, ryzyko minimalne
- Playwright `route.fulfill` z `text/event-stream` — EventSource parsuje eventy z body nawet bez chunked transfer encoding; weryfikować w Fazie 4

## Kryteria sukcesu (podsumowanie)

- Upload flow: matching phase → modal z tytułami i % (E2E green + manual)
- PhotoListIsland: ponowny match → ten sam UX
- Brak regresji w istniejących E2E (upload-flow, photo-crud, manual-rematch)
