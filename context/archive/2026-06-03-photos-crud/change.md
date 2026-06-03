---
change_id: photos-crud
title: Pełny CRUD zdjęć — usuwanie, przenoszenie, zakładki Książki/Zdjęcia
status: archived
created: 2026-06-03
updated: 2026-06-04
archived_at: 2026-06-03T22:13:03Z
---

## Notes

S-29 z roadmapy. Prerequisites S-03, S-05, S-30 — wszystkie done (S-30 vision-cost-preservation
zmergowany jako ostatni PR, FK `vision_runs`/`refine_calls` już CASCADE→SET NULL).

Research (2026-06-03) wykazał, że część scope'u z roadmapy już istnieje:
- Lista zdjęć per półka: `GET /api/shelves/[id]/photos` (bogaty `PhotoListItemDTO`).
- `/shelves/[id].astro` renderuje już `ShelfBooksIsland` + `PhotoListIsland` — jako **stackowane**
  sekcje, nie zakładki.

Pozostaje do dowiezienia: DELETE + PATCH endpointy, konwersja sekcji w zakładki, akcje
zarządzania zdjęciem w UI (usuń/przenieś), badge dla zdjęć z NULL hash.

## Outcome

(uzupełnione przy /10x-archive)
