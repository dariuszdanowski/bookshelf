# Photo Delete and Move (z /photos/[id]) — Krótki plan

> Pełny plan: `context/changes/photo-delete-and-move/plan.md`

## Co i dlaczego

Strona detalu zdjęcia `/photos/[id]` pozwala przeglądać i zatwierdzać detekcje, ale nie
oferuje akcji DELETE ani MOVE — tych dostępnych na `/shelves/[id]` w zakładce Zdjęcia.
User, który otworzył widok detalu, musi wracać do listy żeby usunąć lub przenieść zdjęcie.
Wyrównujemy tę lukę: delete i move dostępne z obu widoków.

## Punkt wyjścia

Backend jest gotowy: `DELETE /api/photos/{id}` i `PATCH /api/photos/{id}` z `shelf_id`
istnieją i działają. `DetectionReview.tsx` już ładuje `PhotoDTO` zawierające `shelf_id`,
ma `ConfirmDialog` na imporcie i `actionBusy` / `isBboxEditing` do blokowania przycisków.
Brakuje wyłącznie UI + handlera w DetectionReview i E2E testów.

## Pożądany stan końcowy

Na stronie `/photos/{id}` pojawia się kompaktowy pasek akcji z selectem „Przenieś na…"
i przyciskiem „Usuń" (z modalem potwierdzenia). Po delete user trafia na
`/shelves/{shelfId}?tab=photos`. Po move — na `/shelves/{targetShelfId}?tab=photos`.
Dwa nowe E2E testy pokrywają oba scenariusze przez mock API.

## Kluczowe podjęte decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Gdzie UI akcji | DetectionReview.tsx (React) | Komponent ma photo state i ConfirmDialog; unika oddzielnej wyspy w Astro | Plan |
| Dane półek (move) | Lazy fetch `GET /api/shelves` po załadowaniu `photo` | Spójne z PhotoListIsland; zero kosztu gdy user nie kliknie move | Plan |
| Redirect po delete | `/shelves/{photo.shelf_id}?tab=photos` | Zdjęcie nie istnieje → powrót do listy | Plan |
| Redirect po move | `/shelves/{targetShelfId}?tab=photos` | User widzi efekt na nowej półce | Plan |
| Blokada | `actionBusy || isBboxEditing || isDeleting || isMoving` | Design consistency z innymi przyciskami w DetectionReview | Plan |
| E2E | Nowy plik `photo-delete-and-move.spec.ts` | Spójny naming z innymi specs; nie zaśmiecamy photos-crud.spec | Plan |

## Zakres

**W zakresie:**
- Nowy photo-management-bar w DetectionReview.tsx (delete button + move select)
- Fetch półek (GET /api/shelves) po załadowaniu photo state
- ConfirmDialog dla delete (reuse istniejącego komponentu)
- 2 nowe E2E testy z pełnym mock API

**Poza zakresem:**
- Refaktoryzacja PhotoListIsland
- Multi-select delete/move
- Zmiana shelf_id w shelf_entries przy move (obecne zachowanie backendu pozostaje)
- Modyfikacja endpointów API (działają)
- Zmiany w /photos/[id].astro

## Architektura / Podejście

```
DetectionReview.tsx (istniejący)
  + allShelves state (lazy fetch GET /api/shelves)
  + showDeleteConfirm / isDeleting / isMoving state
  + handleDeletePhoto() → DELETE API → window.location.href
  + handleMovePhoto(targetId) → PATCH API → window.location.href
  + <div data-testid="photo-management-bar"> (nowy, przed PhotoDetectionOverlay)
      <select data-testid="move-photo-select">
      <button data-testid="delete-photo-button">
      <ConfirmDialog open={showDeleteConfirm} ...>
```

## Fazy w skrócie

| Faza | Co dostarcza | Kluczowe ryzyko |
|---|---|---|
| 1. UI w DetectionReview | photo-management-bar z delete i move działający w przeglądarce | Rozmiar DetectionReview (~3000 linii) — trudniejszy diff review |
| 2. E2E testy | 2 testy mock-based zielone lokalnie i w CI | Mock musi odzwierciedlić pełny shape `GET /api/photos/{id}` response |

**Wymagania wstępne:** Brak — backend gotowy, components gotowe.  
**Szacowany nakład:** ~1 sesja w 2 fazach.

## Otwarte ryzyka i założenia

- `GET /api/photos/{id}` response shape musi pasować do mokowanego w spec — sprawdzić dokładnie przy pisaniu testu
- `ConfirmDialog` props API — potwierdzić `data-testid` na przycisku OK przed pisaniem E2E

## Kryteria sukcesu (podsumowanie)

- Pasek delete+move widoczny na `/photos/{id}`, obie akcje działają z przekierowaniem
- 2 E2E testy zielone bez `test.skip`
- Brak regresji w istniejących testach
