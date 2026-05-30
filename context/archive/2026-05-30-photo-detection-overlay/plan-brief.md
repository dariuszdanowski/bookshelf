# Pełne zdjęcie z numerowanymi ramkami detekcji w review — Plan Brief

> Full plan: `context/changes/photo-detection-overlay/plan.md`

## What & Why

W widoku review (`/photos/[id]`) użytkownik ma zobaczyć **pełne zdjęcie półki** z numerowanymi **ramkami (bbox)** wykrytych książek oraz skorelowaną numerowaną listę pozycji poniżej (numer ramki = `#position_index` na karcie). Dziś zdjęcie w ogóle nie trafia do UI, a bboxy są zapisane i serializowane, lecz nierenderowane. Uwagi usera #3 + #4.

## Starting Point

Substrat z S-04 gotowy: `detections.bbox_x1..y2` (znormalizowane 0..1, migracja 0006) już mapowane do `DetectionWithCandidatesDTO.bbox` i dociągane przez `GET /api/photos/[id]`. `storage_path` trzyma oryginał pełnej rozdzielczości w buckecie `shelf-photos`. `DetectionReview.tsx` renderuje karty z `#{position_index}`. Brakuje: signed URL pełnego zdjęcia w odpowiedzi API + komponentu rysującego ramki.

## Desired End State

Wchodząc w review przetworzonego zdjęcia, użytkownik widzi na górze pełny obraz z prostokątnymi ramkami wokół grzbietów; każda ramka ma badge z numerem zgodnym z kartą detekcji. Detekcje bez bbox są na liście bez ramki. Brak signed URL → review degraduje się do samych kart (bez błędu).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Źródło obrazu | signed URL `storage_path` (1h) | oryginał pełnej rozdz.; brak `original_path` | Plan |
| Render ramek | CSS absolutne `%`-boxy nad `<img>` | bbox 0..1, proporcje zachowane → `left:x1*100%`…; zero zależności | Plan |
| `photo_url` | pole odpowiedzi, nie w `PhotoDTO` | `PhotoDTO` współdzielone (process.ts); brak populacji wszędzie | Plan |
| Numeracja | badge = `position_index` | karty już pokazują `#N` → korelacja | Plan |
| Nowy plik | `PhotoDetectionOverlay.tsx` | izolacja + testowalność | Plan |
| Błąd storage | log + `photo_url:null`, nie 500 | overlay opcjonalny, nie wywraca review | Plan |

## Scope

**In scope:** signed URL pełnego zdjęcia w `GET /api/photos/[id]`; komponent overlay z numerowanymi ramkami; wpięcie w `DetectionReview` nad listą kart; unit + E2E.

**Out of scope:** hover-sync marker↔karta, click-to-crop/re-analiza fragmentu, edycja bbox, zmiany thumbnaili/pipeline, S-19 (okładki), S-20 (statystyki), nowa migracja.

## Architecture / Approach

Backend-first: Phase 1 dokłada `photo_url` (signed URL ze `storage_path`) do odpowiedzi GET. Phase 2 dodaje izolowany `PhotoDetectionOverlay` (kontener `relative` + `<img>` + absolutne `%`-ramki z bbox) i wpina go na górze `DetectionReview`. Współrzędne 0..1 mapują się wprost na proporcje oryginału (`deriveWorkingCopy` skaluje uniformnie), więc overlay jest poprawny bez korekty aspect-ratio.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API | `photo_url` (signed URL) w `GET /api/photos/[id]` + test | mock `storage` w teście endpointu |
| 2. UI | komponent overlay + wpięcie + unit + E2E | wyrównanie ramek do grzbieni (manual, user-only) |

**Prerequisites:** S-04 (bbox) — done. Brak migracji.
**Estimated effort:** ~1 sesja, 2 fazy (atomic commit per faza).

## Open Risks & Assumptions

- Dokładność wyrównania ramek zależy od jakości bbox z vision (best-effort); część detekcji bez bbox — świadomie bez markera.
- Pełnorozdzielczościowy obraz w review — pojedynczy load, akceptowalny dla desktop MVP.

## Success Criteria (Summary)

- Review pokazuje pełne zdjęcie z numerowanymi ramkami spiętymi z kartami.
- Ramki trzymają pozycję przy skalowaniu okna; brak regresji accept/reject/correct/bulk.
- Automaty (typecheck/lint/unit/E2E) zielone; manual (wyrównanie na realnym zdjęciu) potwierdzony user-only.
