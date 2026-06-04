# S-15 „Źródłowe zdjęcie" na karcie książki — Plan Brief

> Full plan: `context/changes/review-page-nav-entry/plan.md`

## What & Why

Karta książki na `/shelves/[id]` i `/library` dostaje link „Źródłowe zdjęcie" → `/photos/[photo_id]`
(strona review zdjęcia, z którego książkę skatalogowano). Domyka lukę z S-29: po usunięciu zdjęcia
`shelf_entries.photo_id` → NULL i książka cicho traci związek ze źródłem — ten slice obsługuje to
gracefully (brak linku) i daje normalną nawigację do źródła, gdy zdjęcie istnieje.

## Starting Point

Oba widoki renderują przez **jeden wspólny** `BookCard.tsx`. `shelf_entries.photo_id` istnieje od
migracji 0001 jako `NULLABLE`, FK `ON DELETE SET NULL`. Oba endpointy filtrują `is_current=true`, ale
żaden nie selectuje `photo_id`. Strona `/photos/[id]` jest gotowa (auth, RLS, breadcrumbs, graceful 404).

## Desired End State

Książka skatalogowana ze zdjęcia pokazuje na obu widokach link do swojego zdjęcia review; klik
nawiguje do `/photos/[photo_id]`. Książka ręczna lub z usuniętym zdjęciem nie pokazuje linku — bez
błędu, bez martwego linku.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Zachowanie przy `photo_id=NULL` | **Ukryj link** (bez „zdjęcia już nie ma") | Dane nie odróżniają usuniętego zdjęcia od wpisu ręcznego — oba NULL; komunikat byłby mylący | Plan |
| Miejsce wstawienia | Wspólny `BookCard` (1 plik) | Pokrywa `/shelves/[id]` + `/library` naraz; zgodne z twardym wymogiem E1 „identyczne wszędzie" | Plan |
| Migracja DB | **Brak** | `photo_id` już istnieje i jest `SET NULL` od 0001 | Plan |
| Nowy endpoint | **Brak** | Rozszerzamy 2 istniejące selecty + DTO | Plan |
| Pole DTO | `photo_id` na `ShelfBookDTO` (bazowy) | `CatalogBookDTO` dziedziczy → jedno pole zasila oba widoki | Plan |

## Scope

**In scope:** `photo_id` w `ShelfBookDTO` + 2 endpointy; warunkowy link w `BookCard`; E2E.

**Out of scope:** migracje; nowy endpoint; komunikat „zdjęcia już nie ma"; refaktor układów/`BookCard` (E1/S-34); zmiany w `/photos/[id].astro`.

## Architecture / Approach

`shelf_entries.photo_id (is_current=true)` → select w `books.ts` / `search.ts` → `ShelfBookDTO.photo_id`
→ prop `book` w `BookCard` → warunkowy `<a href="/photos/{photo_id}">`. Bez zmian w islandach pośrednich.

## Phases at a Glance

| Faza | Co dowozi | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Plumbing photo_id | `photo_id` w DTO + obu odpowiedziach API | Pominięcie pola w mapie `placement` w `search.ts` |
| 2. Link w BookCard + E2E | Warunkowy link na obu widokach + testy | Link pokazany dla `null` (martwy link) — pokryte E2E negatywnym |

**Prerequisites:** S-04, S-05 (done); S-29 (done — tworzy przypadek usuniętego zdjęcia).
**Estimated effort:** ~½–1 sesja, 2 atomowe commity.

## Open Risks & Assumptions

- Zakładamy, że `detection_id` też idzie NULL przy kasacji zdjęcia (kaskada) → potwierdza brak sposobu
  na odróżnienie „usunięte" vs „ręczne". Jeśli kiedyś dojdzie kolumna „był ze zdjęcia", można dodać
  komunikat — poza zakresem.

## Success Criteria (Summary)

- Link „Źródłowe zdjęcie" obecny i nawiguje na obu widokach dla książek ze zdjęcia.
- Brak linku dla wpisu ręcznego i po usunięciu zdjęcia.
- `typecheck` + `unit` + `e2e` zielone.
