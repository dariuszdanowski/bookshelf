---
change_id: cost-analysis-view
title: "S-41: Widok analizy kosztów per klucz API / typ / okres na /account"
status: impl_reviewed
created: 2026-06-07
updated: 2026-06-07
---

## Notes

Slice S-41 z roadmapy (dodany w uwagi-round3, 2026-06-07). Substrat gotowy:
atrybucja `api_key_id` w `vision_runs`/`refine_calls` (migracja 0020 + zapis
defensywny przy callach), `cost_by_key` w `GET /api/account/stats`, chip sumy
przy kluczu na /account (M27).

S-41 dokłada interaktywny drill-down: sekcja „Koszty analizy" klikalna →
modal z listą wywołań filtrowaną per klucz / typ (vision/OCR) / okres,
z paginacją i linkiem do zdjęcia źródłowego.
