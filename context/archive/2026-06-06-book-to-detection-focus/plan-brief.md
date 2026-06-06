# S-37: Deep-link książka → review z fokusem na detekcji — Plan Brief

> Full plan: `context/changes/book-to-detection-focus/plan.md`

## What & Why

Link „Źródłowe zdjęcie" (S-15) prowadzi do strony review, ale user musi sam szukać,
która z kilkudziesięciu ramek odpowiada jego książce. Slice dodaje deep-link z
`?detection=<id>` — overlay od razu fokusuje właściwą ramkę, lista scrolluje do pozycji.

## Starting Point

Wszystkie klocki istnieją: `shelf_entries.detection_id` w DB (zapisywany przy confirm),
mechanizm `focusedDetectionId` + scroll w DetectionReview/PhotoDetectionOverlay (S-18),
link na karcie książki (S-15). Brakuje wyłącznie wiringu: pole w DTO/API + query param
+ initial state.

## Desired End State

Klik na karcie książki → `/photos/<photo_id>?detection=<detection_id>` → 1 podświetlona
ramka + lista na właściwej pozycji. Ręczne wpisy / skasowane detekcje → link bez query,
zachowanie jak dziś.

## Key Decisions Made (Fast track — zawetuj wyjątki)

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Walidacja query param | `parseUuidParam` w SSR (`.astro`), śmieci → null, bez redirectu | Istniejący helper F-02; graceful degradation zamiast 404 (strona jest poprawna, tylko param zły) |
| Zmiany w `GET /api/photos/[id]` | **Brak** | detekcje już niosą swoje `id` — match po stronie island |
| Persystencja fokusu w URL podczas sesji review | **Nie** — tylko initial focus z query | Minimalny scope; pushState przy każdym kliku to osobna decyzja UX poza kontraktem slice'a |
| Nieznane id w query | Cichy no-op (pełny widok) | Detekcja mogła zniknąć po re-process; błąd byłby fałszywym alarmem |
| Scroll | Reużycie logiki `handleMarkerContextMenu` (testid per viewMode) | Działa we wszystkich 3 trybach S-25 bez nowego mechanizmu |

## Scope

**In scope:** `detection_id` w ShelfBookDTO/CatalogBookDTO + 2 endpointy; BookCard href;
parsowanie param w `[id].astro`; initial focus + scroll w DetectionReview; testy unit + E2E.

**Out of scope:** migracje DB; zmiany `GET /api/photos/[id]`; deep-linki z innych miejsc;
URL-sync fokusu w trakcie sesji.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. detection_id w books API | Pole płynie DB → DTO → klienci | niskie — pattern `photo_id` 1:1 |
| 2. UI wiring | Deep-link działa end-to-end + E2E | timing scrollu po renderze listy |

**Prerequisites:** S-15, S-18, S-25 (done) · **Estimated effort:** 1 sesja, 2 fazy (S)

## Open Risks & Assumptions

- Scroll wymaga wyrenderowanej listy — effect po `loading=false`; jeżeli flaky w E2E,
  asercja na fokus overlay (deterministyczna) + `scrollIntoView` weryfikowany unit-owo.

## Success Criteria (Summary)

- Karta książki z detekcją linkuje z `?detection=`; bez detekcji — jak dotąd
- Wejście z parametrem = fokus 1 ramki + scroll; param zniekształcony/nieznany = pełny widok
- Lint/typecheck/unit/E2E zielone; manual na realnej kolekcji (user-only)
