# Interaktywny edytor bbox — Plan Brief

> Full plan: `context/changes/bbox-editor-interactive/plan.md`

## What & Why

Użytkownik może rysować, przesuwać, skalować i usuwać ramki detekcji (bbox) bezpośrednio na zdjęciu półki — bez wpisywania współrzędnych. Motywacja: vision LLM nie zawsze prawidłowo lokalizuje wszystkie grzbiety, a ręczna korekta bbox-ów odblokuje istniejący Refine (OCR fragmentu) na precyzyjnie zaznaczonym obszarze.

## Starting Point

`PhotoDetectionOverlay` wyświetla bbox-y read-only z zoom/pan/focus (slice `photo-detection-overlay`). Brak endpointów do mutacji bbox-ów i tworzenia nowych detekcji. Istniejący `POST /api/detections/[id]/refine` działa bez zmian — wystarczy bbox w DB.

## Desired End State

User klika "Edytuj ramki" → overlay wchodzi w edit mode (zoom reset do 1×), narzędzia edycji. Rysuje nowe bbox (click+drag), resize 8 uchwytów, move drag po wnętrzu, × usuwa. "Zastosuj zmiany" → batch API call persystuje wszystkie zmiany; nowe detekcje pojawiają się jako `pending` w liście review i można na nich kliknąć Refine.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Re-analiza rozszerzona | Osobny slice | Znacznie inny kontrakt (LLM cały kadr + hints) — ten slice atomowy jako bbox editor | Plan |
| Zoom w edit mode | Reset do 1×, disable scroll-zoom | Eliminuje konieczność transformacji pointer-coords z przestrzeni scaled viewport | Plan |
| Usuwanie detekcji | Soft: `POST /reject` as-is | "Nie mogą zginąć" + telemetria; endpoint działa bez zmian | Plan |
| Save timing | Przycisk "Zastosuj" → batch `Promise.allSettled` | Jeden świadomy commit; partial failures raportowane bez cofania sukcesów | Plan |
| Nowa detekcja raw_title | `''` (pusty string), status='pending' | Kontrola kosztu LLM; user decyduje kiedy Refine; raw_title nullable w schemacie | Plan |
| vision_run_id dla nowej det. | Lookup: latest dla foto | Bez nowej migracji; semantycznie rozszerza istniejącą sesję analizy | Plan |
| Apply state management | `BboxEditSet` emitowany przez overlay, obsługiwany przez Review | Review woła API + zarządza `isBboxEditing` → blokuje bulk-confirm w edit mode | Plan |

## Scope

**In scope:**
- `BboxCoords` / `BboxEditSet` jako nazwane typy w `src/lib/photos/schema.ts`
- `PATCH /api/detections/[id]/bbox` (nowy endpoint)
- `POST /api/photos/[id]/detections` (nowy endpoint)
- Edit mode w `PhotoDetectionOverlay`: draw, resize (8 handles), move, delete (×)
- `onApplyEdits` integration w `DetectionReview` z batch API
- Unit testy nowych endpointów + overlay edit mode
- E2E test `bbox-editor.spec.ts`

**Out of scope:**
- Re-analiza vision rozszerzona (cały kadr z hints LLM)
- Zoom/pan w edit mode (reset przy wejściu)
- Undo/redo
- Modyfikacje `reject.ts` / `refine.ts` / pipeline vision

## Architecture / Approach

```
DetectionReview (isBboxEditing state + handleApplyEdits)
  └── PhotoDetectionOverlay (edit mode UI)
        ├── draw new bbox → editChanges.added
        ├── resize/move → editChanges.updated
        └── × → editChanges.removed
  [Apply] → Promise.allSettled([
    PATCH /api/detections/[id]/bbox   (per updated)
    POST /api/detections/[id]/reject  (per removed, as-is)
    POST /api/photos/[id]/detections  (per added)
  ]) → setDetections(...)
```

Istniejący `POST /api/detections/[id]/refine` działa bez zmian po tym sliceu.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. API endpoints | PATCH bbox + POST nowa det. + typy + unit testy | `vision_run_id NOT NULL` — wymaga lookup, nie migracji |
| 2. Overlay edit mode | Draw/resize/move/delete UI w PhotoDetectionOverlay | Konflikt pointer events draw vs existing pan handlers |
| 3. Review integration + E2E | Apply flow, batch API, update state, e2e spec | Promise.allSettled partial failure UX |

**Prerequisites:** Działający Supabase (lokalny lub remote) + zielone automaty na `main` (97/97 Vitest + 38 Playwright).
**Estimated effort:** ~3 sesje (1 per faza); faza 2 największa (pointer event handling).

## Open Risks & Assumptions

- `raw_title text` w `detections` jest nullable w faktycznym schemacie (weryfikacja: `\d detections` przed implementacją — jeśli NOT NULL wymagana krótka migracja).
- Pointer events (draw + resize + move) na tym samym viewport wymagają precyzyjnego `stopPropagation` — source najczęstszych bugów w bbox editorach.
- Blend z istniejącym zoom/pan: edit mode reset do 1× akceptowalny w MVP; feedback po manualnym teście może odkryć potrzebę innego podejścia.

## Success Criteria (Summary)

- Nowo narysowana ramka persystuje po reloadzie; Refine na niej daje wynik OCR.
- Resize/move istniejącej ramki persystuje po reloadzie; numeracja kart się nie zmienia.
- Pełna pętla `npm run typecheck && npm run lint && npm run test && npm run test:e2e` zielona.
