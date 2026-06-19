---
id: progress-modal
title: Progress modal dla długich operacji (vision, rematch)
status: archived
created: 2026-06-19
updated: 2026-06-19
archived_at: 2026-06-19T21:43:27Z
---

Długie operacje (vision-analiza zdjęcia ~10s, rematch/refine ~3-5s) pokazują
progress tylko jako stan na przycisku/inline-spinner — zbyt subtelnie. User może
nie zauważyć trwającego procesu, przejść na inną stronę i stracić wynik.

Rozwiązanie: blokujący overlay z opisem bieżącego kroku i indeterminate paskiem
postępu, auto-zamykający się po zakończeniu.
