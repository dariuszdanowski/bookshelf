---
change_id: photo-detection-overlay
title: Pełne zdjęcie z numerowanymi ramkami detekcji w widoku review
status: implemented
created: 2026-05-30
updated: 2026-05-30
archived_at: null
---

## Notes

Roadmap S-18 (slice B). Uwagi usera #3 + #4:

- Po kliknięciu w zdjęcie user ma zobaczyć **pełny obraz** (nie tylko thumbnail).
- Jeśli zdjęcie przeszło detekcję — na obrazie nałożone **numerowane ramki (bbox)** wykrytych książek, a **poniżej** numerowana lista pozycji skorelowana z ramkami (numerek = `position_index`).
- Miejsce: **widok review** `/photos/[id]` (`DetectionReview.tsx`) — już renderuje `#{position_index}` per karta, więc korelacja jest naturalna.

Substrat z S-04 gotowy (zob. memory `s04-detection-spatial-region-model`):
- `detections.bbox_x1..y2` (znormalizowane 0..1) w DB, mapowane do `DetectionDTO.bbox` w `src/lib/photos/schema.ts` — już fetchowane w `GET /api/photos/[id]`, tylko **nierenderowane**.
- `photos.original_path` z S-04.

Główne braki do domknięcia:
1. `GET /api/photos/[id]` **nie zwraca signed URL pełnego zdjęcia** — dodać (bucket `shelf-photos`, `createSignedUrl`).
2. Brak komponentu overlay renderującego bbox 0..1 na obrazie + numerki.
3. Korelacja overlay ↔ lista detekcji po `position_index`.

Kolejność realizacji uwag: **B (ten slice) → C (`manual-cover-match`, S-19) → A (`shelf-statistics`, S-20)**.
