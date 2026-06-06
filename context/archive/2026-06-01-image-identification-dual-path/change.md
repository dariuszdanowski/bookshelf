---
change_id: image-identification-dual-path
title: Dwa tory identyfikacji książek: OCR bez LLM i tani fallback LLM
status: archived
created: 2026-06-01
updated: 2026-06-06
archived_at: 2026-06-06T20:59:23Z
---

## Notes

User chce sprawdzić, czy skille 10xDevs mogą prowadzić ten temat "jak każdą inną zmianę" oraz przygotować pełny cykl artefaktów. Dodatkowo oczekuje dwóch planów: (1) OCR bez LLM, (2) fallback z drugim wywołaniem analizy obrazu tylko dla trudnych przypadków. Priorytet: ograniczenie kosztów Claude przy zachowaniu jakości.

## Outcome

- Phase 1 ukończone: detection-scoped refine API + crop utility + vision refine parser + testy API/unit.
- Phase 2 ukończone: akcja refine w UI (cards/list/tiles) + testy unit + Playwright scenario.
- Phase 3 ukończone: benchmark OCR offline (`tesseract.js` profile PSM6/PSM7) wygenerowany do:
	- `docs/image-analysis/ocr-benchmark-results-2026-06.json`
	- `docs/image-analysis/ocr-benchmark-report-2026-06.md`
- Decyzja po benchmarku: **NO-GO** dla OCR-first (brak poprawy recall@top1 vs baseline).
- Phase 4 pozostaje niewykonane zgodnie z gate warunkowym (uruchamiane tylko przy pozytywnym benchmarku).
