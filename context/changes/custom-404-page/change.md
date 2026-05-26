---
change_id: custom-404-page
title: Custom Astro 404 page z nawigacją z powrotem
status: in-progress
created: 2026-05-26
updated: 2026-05-26
archived_at: null
---

## Notes

S-10 w roadmapie (Stream E micro-slice bucket). Astro renders `src/pages/404.astro` dla unmatched routes — chcemy mieć customową stronę zamiast Astro default. Dla zalogowanego usera: powitanie + link „Wróć do biblioteki". Dla niezalogowanego: middleware już redirektuje na `/login` zanim 404 się renderuje, więc default behavior dla nich się nie zmienia.
