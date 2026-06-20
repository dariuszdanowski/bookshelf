---
id: photo-delete-and-move
title: "Usuń i przenieś zdjęcie z widoku /photos/[id]"
status: implementing
branch: change/photo-delete-and-move
created: 2026-06-20
updated: 2026-06-20
---

## Summary

Dodanie akcji DELETE i MOVE na stronie detalu zdjęcia `/photos/[id]`.
Aktualnie te akcje istnieją tylko w PhotoListIsland (zakładka Zdjęcia na `/shelves/[id]`),
ale są niedostępne gdy user jest na widoku detalu konkretnego zdjęcia.

## Scope

- Przyciski DELETE + MOVE w DetectionReview.tsx (toolbar)
- E2E testy dla obu operacji z `/photos/[id]`
