---
change_id: review-page-nav-entry
slice: S-15
title: Przycisk „Źródłowe zdjęcie" na karcie książki
status: plan_reviewed
created: 2026-06-04
updated: 2026-06-04
---

# S-15 — review-page-nav-entry

Karta książki (`BookCard`, wspólna dla `/shelves/[id]` i `/library`) dostaje link
„Źródłowe zdjęcie" → `/photos/[photo_id]` z aktywnego `shelf_entry` (`is_current=true`).
Gdy `photo_id` jest NULL (wpis ręczny **lub** zdjęcie usunięte po S-29) — link się nie renderuje.

Domyka lukę z S-29: po usunięciu zdjęcia `shelf_entries.photo_id` → NULL; bez tego slice'a
książka cicho traci jakikolwiek związek ze źródłem, a z nim — graceful brak linku.

Zakres rozszerzony o `/library` zgodnie z backlog D2 ([[backlog-s29-review-2026-06-04]]).
