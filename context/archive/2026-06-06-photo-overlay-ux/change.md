---
change_id: photo-overlay-ux
title: "S-24: Lightbox zdjęcia w review (scope-reduced)"
status: archived
created: 2026-06-06
updated: 2026-06-07
archived_at: 2026-06-07T00:20:00Z
---

## Notes

Slice S-24 z roadmapy, **scope-reduced za notą alignmentu w roadmapie (2026-06-06)**:
część (a) — toggle show/hide ramek — już istnieje (`toggle-bboxes-button` + `showBoxes`
w `PhotoDetectionOverlay`), zoom/pan 1–4× też. Resztkowa wartość = część (b): lightbox.

## Outcome

Kliknięcie zdjęcia w review (poza trybami edycji) otwiera lightbox — pełnoekranowy
modal React (zgodnie z konwencją: in-app dialog, nie natywne okna) z obrazem i
numerowanymi ramkami bbox. Zamknięcie: Esc / klik tła / przycisk ✕. Klik po pan-dragu
(przesunięcie > próg) NIE otwiera lightboxa.
