---
change_id: weak-match-resolve-and-ocr-audit
title: Weak-match AI-resolution gate + historia korekt OCR
status: implemented
created: 2026-07-13
updated: 2026-07-13
archived_at: null
---

## Notes

Odkryte przy manualnej analizie zdjęcia `f07dad97-62b1-4a02-a87e-75fa6433a25e` (detekcje #16/#19/#20, 2026-07-13): BN zwraca do 5 niezwiązanych kandydatów dla słabo dopasowanych OCR-tytułów (score < MATCH_MID), co blokuje przycisk „Rozwiąż przez AI" (widoczny dziś tylko przy `candidates.length === 0`). Przy okazji ustalono, że `rematch.ts`/`refine.ts` nadpisują `detections.raw_title`/`raw_author` bez logowania — w przeciwieństwie do `correct.ts`, który poprawnie zachowuje historię przez `corrections`.

Zobacz `context/changes/weak-match-resolve-and-ocr-audit/plan-brief.md` i `plan.md`.

**Faza 6 (dodana podczas manualnej weryfikacji Fazy 5, 2026-07-13)**: user zauważył, że `RematchForm` pre-fillsuje ostatnio przypisaną wartość (potencjalnie błędną z poprzedniego rematch/refine), nie oryginalny odczyt OCR — user decyzją rozszerzył ten plan zamiast otwierać follow-up slice.
