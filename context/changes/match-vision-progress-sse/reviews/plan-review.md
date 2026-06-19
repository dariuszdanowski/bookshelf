<!-- PLAN-REVIEW-REPORT -->
# Przegląd planu: Match & Vision Progress (SSE)

- **Plan**: `context/changes/match-vision-progress-sse/plan.md`
- **Tryb**: Głęboki
- **Data**: 2026-06-20
- **Werdykt**: DO POPRAWY (naprawione)
- **Ustalenia**: 2 krytyczne | 1 ostrzeżenie | 0 obserwacji

## Werdykty

| Wymiar | Werdykt |
|---|---|
| Zgodność ze stanem końcowym | ZALICZONY |
| Oszczędne wykonanie | ZALICZONY |
| Dopasowanie architektoniczne | NIEZALICZONY → naprawione |
| Martwe punkty | OSTRZEŻENIE → naprawione |
| Kompletność planu | NIEZALICZONY → naprawione |

## Ugruntowanie

`5/6 ścieżek ✓ (runner.ts ❌ nie istnieje)`, `1/3 symboli ✓ (runMatchingConcurrent ❌, MatchInput ❌ — z nieistniejącego runner.ts)`, `brief↔plan ✓`

## Weryfikacja kluczowego ryzyka

PhotoUploader i PhotoListIsland używają wyłącznie `matched` + `rate_limited` z match response — `detections` ignorowane. SSE `done: {matched, rate_limited}` wystarczający. ✓

## Ustalenia

### F1 — Plan modyfikuje nieistniejący plik runner.ts

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🏃 NISKI — szybka decyzja; poprawka oczywista
- **Wymiar**: Dopasowanie architektoniczne
- **Lokalizacja**: Faza 1 — Wymagane zmiany §1.1
- **Szczegóły**: `src/lib/matching/runner.ts` nie istnieje. Concurrent runner to prywatna `settledWithConcurrency` wewnątrz `match.ts:28`. Sygnatura `matchDetection(det: DetectionRow, catalog: ExistingBook[])` — brak `env`, inny typ wejściowy. Typy `MatchInput`/`runMatchingConcurrent` nie istnieją w codebase. Plan mówił jednocześnie „match.ts bez zmian" — sprzeczność z potrzebą współdzielenia logiki.
- **Fix**: Faza 1.1 tworzy NOWY `src/lib/matching/runner.ts` przez ekstrakcję `settledWithConcurrency` + `matchDetection` z `match.ts`; eksportuje `runMatchingWithProgress(detectionRows, catalog, concurrency, onProgress?)`; `match.ts` otrzymuje import refactor (endpoint behavior bez zmian).
- **Decyzja**: ZASTOSOWANE ✓

### F2 — Nazwy faz w sekcji Postęp nie pasują do nagłówków w treści

- **Waga**: ❌ KRYTYCZNE
- **Wpływ**: 🏃 NISKI — `/10x-implement` nie przetworzy źle sformułowanej sekcji Progress
- **Wymiar**: Kompletność planu
- **Lokalizacja**: Sekcja `## Postęp`
- **Szczegóły**: 3 z 4 nagłówków `### Faza N:` w sekcji Postęp miały skrócone nazwy vs `## Faza N:` w treści: Faza 1 „runner + SSE" ≠ „runner.ts + match-stream endpoint"; Faza 2 „ProgressModal" ≠ „ProgressModal — rozszerzenie UI"; Faza 3 „Frontend EventSource" ≠ „Frontend — EventSource integration".
- **Fix**: Zmieniono 3 nagłówki Progress na dokładne kopie nagłówków z treści.
- **Decyzja**: ZASTOSOWANE ✓

### F3 — Spec match-stream.ts pomija guardy z match.ts

- **Waga**: ⚠️ OSTRZEŻENIE
- **Wpływ**: 🏃 NISKI — implementator by pominął guardy, powodując rozbieżność behavior vs match.ts
- **Wymiar**: Martwe punkty
- **Lokalizacja**: Faza 1 — §1.2 match-stream.ts, sekcja Kontrakt
- **Szczegóły**: Plan opisywał auth jako „parseUuidParam → createServerClient → getUser() → 401". Brakujące guardy: (1) `profiles.ai_enabled` check → 403 AI_DISABLED (match.ts:182-194); (2) scoping detekcji do `latestRun` (latest SUCCEEDED `vision_run`) zamiast wszystkich detekcji dla photo_id; (3) preload `catalog` (books usera) dla duplicate check w matchDetection.
- **Fix**: Dodano do §1.2 Kontraktu kolejność guardów + scoping latestRun + preload catalog.
- **Decyzja**: ZASTOSOWANE ✓
