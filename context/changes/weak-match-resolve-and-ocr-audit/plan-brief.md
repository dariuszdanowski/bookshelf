# Weak-match AI-resolution gate + historia korekt OCR — Krótki plan

> Pełny plan: `context/changes/weak-match-resolve-and-ocr-audit/plan.md`

## Co i dlaczego

Dwie naprawy odkryte przy manualnej analizie zdjęcia: (1) przycisk „Rozwiąż przez AI" jest widoczny wyłącznie gdy detekcja ma ZERO kandydatów, ale BN potrafi zwrócić do 5 kompletnie niezwiązanych kandydatów (score 0.27-0.38, głęboko poniżej progu 0.55) dla niemal dowolnego zapytania — użytkownik utyka bez ratunku AI mimo że żaden kandydat nie jest wiarygodny; (2) `rematch.ts`/`refine.ts` nadpisują oryginalny odczyt OCR (`raw_title`/`raw_author`) bez żadnego logu — po jednym kliknięciu „Szukaj po tytule" lub „Doprecyzuj odczyt" oryginalny odczyt vision ginie bezpowrotnie.

## Punkt wyjścia

`correct.ts` (Popraw/wpis ręczny) już robi to poprawnie — zostawia `detections.raw_title` nietknięte, loguje `corrections.original_raw_title` osobno. `rematch.ts`/`refine.ts` nie mają tego zabezpieczenia. `resolve.ts` (S-50, mój wcześniejszy slice) nie dotyka `raw_title` w ogóle i już poprawnie usuwa istniejących (słabych) kandydatów przy sukcesie — nie wymaga zmian.

## Pożądany stan końcowy

Przycisk AI-resolution pojawia się też, gdy najlepszy kandydat ma `matchScore < MATCH_MID`, nie tylko przy zerze kandydatów. Każdy rematch/refine loguje oryginalną wartość do `corrections` przed nadpisaniem. Nowy panel na karcie detekcji (wzorzec `CostPanel`) pokazuje chronologiczną historię: co było odczytane → na co skorygowane, kiedy, jakim mechanizmem.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego (1 zdanie) |
|---|---|---|
| Próg bramki AI-resolution | `!top \|\| top.matchScore < MATCH_MID (0.55)` | Reużywa istniejącą stałą, już ustalony próg "wymaga potwierdzenia" w tym repo |
| Nowe `correction_type` | `'rematch'`, `'refine'` | Zwięzłe, spójne ze stylem istniejących wartości |
| Gdzie logować | Tylko `rematch.ts`/`refine.ts` | `resolve.ts`/`correct.ts` już nie nadpisują `raw_title` w miejscu |
| Dedupe logowania | Brak — zawsze loguj | User świadomie kliknął akcję; prostsze niż warunkowe porównanie wartości |
| `resolve.ts` przy słabym-ale-niepustym matchu | Bez zmian | Gałąź `found` już bezwarunkowo usuwa istniejących kandydatów przed insertem |
| UI historii | Nowy panel we wszystkich 3 widokach (nie asymetryczny wzorzec `CostPanel`, tylko Karty) | Parytet z `AiResolutionButton`/`RefineButton`; user explicite chce to zawsze widzieć |

## Zakres

**W zakresie:** migracja (rozszerzony CHECK), fix `rematch.ts`/`refine.ts` (logowanie przed nadpisaniem), rozszerzenie warunku widoczności `AiResolutionButton`, nowy endpoint + komponent historii korekt, testy jednostkowe + E2E.

**Poza zakresem:** zmiana scoringu/BN-owego wyszukiwania, migracja historycznych (już utraconych) danych, funkcja "przywróć oryginalny odczyt" (rollback), zmiana semantyki `detections.status`.

## Architektura / Podejście

`rematch.ts`/`refine.ts` → insert `corrections` (wzorzec `confirmDetectionToCatalog`) PRZED `UPDATE detections`. `DetectionReview.tsx` → warunek `!top || top.matchScore < MATCH_MID` w 3 widokach (bez zmian w `AiResolutionButton`/`handleAiResolve`/`resolve.ts`). Nowy `GET /api/detections/[id]/history` + `CorrectionHistoryPanel.tsx` (lazy-fetch popover, wzorzec `CostPanel`) osadzony we wszystkich 3 widokach.

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. Schemat | Migracja 0028 (rozszerzony CHECK) | — |
| 2. Historia OCR | Insert `corrections` w rematch/refine przed nadpisaniem | Brak — non-blocking insert, wzorzec już sprawdzony w repo |
| 3. Bramka AI-resolution | Rozszerzony warunek widoczności w 3 widokach | Istniejący E2E scenariusz wymaga dostosowania (kandydat musi mieć wysoki score) |
| 4. UI historii | Endpoint + komponent + wiring w 3 widokach | Nowa powierzchnia UI — trzeba dopasować styl do istniejących popoverów |
| 5. Testy | Unit + E2E dla obu punktów | — |

**Wymagania wstępne:** lokalny stack Supabase (WSL) do aplikacji migracji.
**Szacowany nakład pracy:** ~5 faz, rozmiar porównywalny do pojedynczego średniego slice'a (mniejszy niż S-50).

## Otwarte ryzyka i założenia

- Brak — zakres jest w pełni ugruntowany w kodzie przeczytanym w tej sesji (rematch.ts, refine.ts, correct.ts, confirm.ts, DetectionReview.tsx, score.ts, migracje 0008/0027).

## Kryteria sukcesu (podsumowanie)

- Detekcja ze słabym (ale niepustym) matchem pokazuje przycisk „Rozwiąż przez AI"
- Rematch/refine nie tracą już oryginalnego odczytu OCR — widoczny w panelu historii
- Panel historii dostępny we wszystkich 3 widokach review
