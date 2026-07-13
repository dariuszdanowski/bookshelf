---
change_id: ai-book-resolution-fallback
title: Fallback identyfikacji książki przez AI z web search (S-50)
status: archived
created: 2026-07-13
updated: 2026-07-13
archived_at: 2026-07-13T07:21:55Z
---

## Notes

Roadmap S-50 (`context/foundation/roadmap.md`): fallback identyfikacji książki przez AI z web search (Claude `web_search` tool, klucz usera — BYOK), uruchamiany wyłącznie dla detekcji, dla których strukturalna kaskada (GB/OL/BN + S-48 word-level fallback) nie znalazła kandydata >= MATCH_MID. Zastępuje wcześniejszy pomysł „polish-grammatical-variants" (stemmer) — web search naturalnie radzi sobie z odmianą/literówkami OCR.

Wykryte przy manualnym teście #153 (2026-07-12): OCR „Złodziej książek" (l. pojedyncza) zamiast „Złodzieje książek" (l. mnoga) — BN zwraca zupełnie inne wyniki dla obu zapytań.

Zobacz `context/changes/ai-book-resolution-fallback/plan-brief.md` i `plan.md`.
