# Move Book Between Shelves + History (S-07) — Plan Brief

> Full plan: `context/changes/move-book-and-history/plan.md`

## What & Why

Użytkownik może przenieść książkę z dowolnej półki (w tym „Zakupione") na inną. Przeniesienie zapisuje **wersjonowaną historię lokalizacji** (FR-038): poprzedni wpis staje się historyczny, nowy bieżący. Risk note roadmapy: historia to dług tani do zaciągnięcia teraz, drogi do dorobienia wstecz — dlatego materializujemy dane historyczne od razu.

## Starting Point

`shelf_entries` ma już kolumny `is_current`/`confirmed_at`, ale wersjonowanie nie jest uruchomione — każdy wpis to `is_current=true`, zero historii. RLS waliduje już oba FK (migracja 0009 dodana defensywnie pod ten slice). `BookCard` ma per-book akcję (toggle read) + wzorzec optimistic update; `/library` pobiera już listę półek.

## Desired End State

Przy każdej książce w `/library` i na widoku półki jest picker „Przenieś na półkę…". Wybór półki przenosi książkę (znika z poprzedniej, ląduje na końcu docelowej); status przeczytania, data zakupu i metadane zachowane. W bazie powstaje wiersz historyczny + bieżący; dokładnie jeden bieżący na książkę (niezmiennik DB).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Model historii | mark-historical + insert-new (nie UPDATE in-place) | UPDATE shelf_id nie tworzy historii — FR-038 wymaga wersji | Plan |
| Realizacja | dwa typowane zapisy w endpoincie (INSERT bieżący → UPDATE stary) | rpc/funkcja nie przejdzie typecheck (pusty `Database.Functions`, brak DB w branchu) | Plan-review F1 |
| Kolejność | insert-first | przy błędzie książka nigdy nie znika (najwyżej chwilowo na 2 półkach) | Plan-review F1 |
| Niezmiennik | brak partial unique index; FR-029 app-level (status quo) | insert-first łamałby index; index i tak wymagałby DB | Plan-review F1/F2 |
| Migracja | brak — kolumny już istnieją | `is_current`/`confirmed_at` od 0001; RLS oba-FK od 0009 | Research |
| Endpoint | `POST /api/books/[id]/move` (sub-route, nie PATCH pola) | move to operacja tworząca historię, nie patch pola | Plan |
| Kontrolka UI | natywny `<select>` w BookCard | najprostsza, dostępna; współdzielona przez obie wyspy | Plan |
| Widok historii | poza zakresem (dane tak, ekran nie) | timeline „gdzie była" = follow-up; risk note ceni dane, nie UI | Plan |
| RLS | bez zmian | 0009 już waliduje oba FK | Research |

## Scope

**In scope:** akcja przeniesienia (UI + endpoint), atomowa funkcja DB, partial unique index, zachowanie is_read/purchase_date/metadanych, testy unit + E2E.

**Out of scope:** widok historii lokalizacji, bulk move, drag-and-drop, reorder w obrębie półki, specjalna logika dla „Zakupione".

## Architecture / Approach

`BookCard` (select półki) → wyspa `handleMove` (optimistic + rollback) → `POST /api/books/[id]/move` (auth/uuid/zod + RLS pre-selecty książki/półki/bieżącego wpisu) → INSERT nowego bieżącego (max+1 na docelowej) → UPDATE starego na `is_current=false`. RLS (oba-FK od 0009) egzekwuje ownership; FR-029 app-level.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Warstwa danych | Zod, endpoint move (dwa zapisy), unit testy | mock łańcuchów Supabase dla wielu wywołań `from()` |
| 2. UI | picker w BookCard, podpięcie 2 wysp (optimistic), E2E | seeding książki w E2E może być kruchy |

**Prerequisites:** S-05, S-02 (done). Branch `change/move-book-and-history` (utworzony).
**Estimated effort:** ~1 sesja, 2 fazy (bez migracji).

## Open Risks & Assumptions

- Brak atomowości dwóch zapisów — przy rzadkim błędzie sieci między INSERT a UPDATE książka chwilowo na 2 półkach (widoczna, naprawialna); zgodne z istniejącym non-atomic `confirm.ts`.
- FR-029 egzekwowane app-level (jak dziś) — bez DB constraintu.
- E2E seeduje książkę ścieżką ręcznego zakupu (S-06, bez vision → zero kosztu LLM).

## Success Criteria (Summary)

- Przeniesienie książki przenosi ją między półkami, zachowując is_read / purchase_date / metadane.
- W bazie powstaje historia (≥2 wiersze, dokładnie jeden `is_current`).
- Przeniesienie z „Zakupione" działa identycznie; próba na tę samą półkę → 409.
