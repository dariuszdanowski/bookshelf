---
change_id: photo-upload-skip-process
title: "S-36: Upload zdjęcia bez uruchamiania vision"
status: planned
created: 2026-06-07
updated: 2026-06-07
archived_at: null
---

## Notes

Slice S-36 z roadmapy. Backend gotowy w 100% (POST /api/photos już zapisuje
`status='uploaded'`; `/process` wywołuje klient; tab Zdjęcia z S-29 ma akcję
„Uruchom vision" dla stage=uploaded). Slice = decyzja routingu w PhotoUploader
+ lądowanie na tabie Zdjęcia.

## Outcome

Checkbox „Analizuj od razu" w PhotoUploader (domyślnie zaznaczony, persystowany
w localStorage). Odznaczony → upload kończy się na `status='uploaded'` (zero
wywołań vision/match = zero kosztu), bez resume-state w sessionStorage (pitfall
z roadmapy), redirect na `/shelves/{id}?tab=photos`, gdzie zdjęcie ma istniejącą
akcję „Uruchom vision". `useShelfTab` honoruje nowy param `?tab=`.

**Adaptacja względem litery roadmapy** (intent zachowany): przycisk w tabie
zostaje „Uruchom vision" (nie „Analizuj") — spójność z granularnym pipeline UI
S-29 („Uruchom vision" / „Uruchom match" to osobne kroki).
