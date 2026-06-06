---
change_id: book-to-detection-focus
title: "S-37: Deep-link książka → review z fokusem na jej detekcji"
status: plan_reviewed
created: 2026-06-06
updated: 2026-06-06
archived_at: null
---

## Notes

Slice S-37 z roadmapy (Backlog Handoff: „Prereqs done (S-15 link, S-18 fokus overlay);
czyste wiring — `detection_id` w books API + `?detection=` w DetectionReview; zero migracji").
Realizowany w trybie Fast track — decyzje w plan-brief, bez rundy pytań.

## Outcome

Kliknięcie „Źródłowe zdjęcie" na karcie książki prowadzi do `/photos/[photo_id]?detection=<detection_id>`,
gdzie overlay pokazuje wyłącznie ramkę tej detekcji (istniejący mechanizm `focusedDetectionId`),
a lista detekcji scrolluje do odpowiedniej pozycji. Graceful degradation: brak `detection_id`
(ręczny wpis / FK SET NULL po re-process) → link bez query param, review działa jak dotąd;
nieistniejące/zniekształcone id w query → ignorowane.
