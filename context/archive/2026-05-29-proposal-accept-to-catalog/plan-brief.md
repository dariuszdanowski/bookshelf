# Proposal Accept → Catalog (S-05) — Plan Brief

> Full plan: `context/changes/proposal-accept-to-catalog/plan.md`

## What & Why

Gwiazda przewodnia. S-04 dał read-only przegląd propozycji rozpoznanych ze zdjęcia; S-05 dodaje **decyzje** — accept / reject / correct / manual-entry (pojedynczo i hurtowo) — i persystuje zaakceptowane książki do katalogu z pozycją na półce i statusem przeczytania. Domyka Flow A end-to-end (US-01) i niesie KPI acceptance-rate + time-to-first-shelf.

## Starting Point

`DetectionReview.tsx` (`client:load`) renderuje tierowane propozycje + flagi duplikatów, ale tylko wyświetla. Schema ma `books`, `shelf_entries`, `corrections`, `detections` — ale **brak statusu przeczytania** i **brak wartości telemetrii** dla accept/reject/manual. `/shelves/[id]` jest photo-centric (tylko `PhotoListIsland`), `book_count` to placeholder 0.

## Desired End State

Na `/photos/[id]` przy każdej detekcji są akcje Akceptuj / Odrzuć / Popraw (+ inline „Wpisz ręcznie" przy braku matchu) i przycisk „Akceptuj pre-zaznaczone". Po akceptacji user ląduje na `/shelves/[id]` z gridem okładek w kolejności „od lewej", każda z toggle „przeczytana" 1-klik. Lista półek pokazuje realne liczby książek. Każda decyzja zostawia ślad telemetryczny; exact-duplicate (ten sam ISBN) jest blokowany komunikatem.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
| --- | --- | --- | --- |
| Read status | `books.is_read boolean default false` | read = cecha książki, nie placementu; RLS już pokrywa; binarny wg PRD | Plan |
| Telemetria | rozszerz enum `corrections.correction_type`, loguj każdą decyzję | literalnie spełnia FR-037 (accept/reject/manual) | Plan |
| Pozycja „od lewej" | `detection.position_index`; manual→max+1 | vision numeruje od lewej — fizyczna kolejność za darmo | Plan |
| Pola correct | title/author/publisher/rok | zgodne z FR-019 | Plan |
| Endpointy | osobne confirm/reject/correct (PRD §8) + wspólny helper | 1:1 z PRD; helper eliminuje duplikację insert-do-katalogu | Plan |
| Bulk accept | dedykowany `confirm-batch` | atomowość + 1 round-trip (KPI 5 min) | Plan |
| Exact-dup | blokada 409 CONFLICT | PRD §11; backstop przez unique 23505 | Plan |
| Read toggle | `PATCH /api/books/[id] {is_read}` | rozszerzalny endpoint książki | Plan |
| Widok półki | rozszerz `/shelves/[id]` (grid nad zdjęciami) | książki + źródłowe zdjęcia razem | Plan |
| Manual entry | wariant `correct` bez candidate_id + inline form | jeden endpoint na edycję i manual | Plan |
| book_count | policz realnie teraz | książki istnieją; domyka FR-009 | Plan |
| correct re-search | NIE (typed pola, bez re-query) | zgodne z intencją roadmap; re-match post-MVP | Plan |

## Scope

**In scope:** migracja 0008 (is_read + enum); endpointy confirm/reject/correct/confirm-batch + helper; `PATCH /api/books/[id]`; `GET /api/shelves/[id]/books`; realny book_count; przepisanie `DetectionReview` (akcje + bulk + manual); `BookCard` + `ShelfBooksIsland` + rozszerzenie `/shelves/[id]`; telemetria; E2E golden path.

**Out of scope:** Flow B (S-06), przenoszenie+historia lokalizacji (S-07), wyszukiwarka/filtry (S-08), re-search przy correct, strojenie progów, paleta kolorów, edycja `books` poza `is_read`.

## Architecture / Approach

Backend-first. Współdzielony helper `confirmDetectionToCatalog` (pre-check dup → books → shelf_entries → status confirmed → corrections) konsumowany przez confirm/correct/batch. `shelf_id` derywowany z `photo.shelf_id` (nie z inputu) → bezpieczne mimo luki RLS na shelf_id. Widok półki: React island fetchujący nowy GET, toggle przez PATCH (optimistic).

## Phases at a Glance

| Phase | Dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Substrat danych | migracja 0008 + Zod/DTO | poprawne odtworzenie CHECK constraint |
| 2. Endpointy decyzji | confirm/reject/correct/batch + helper | kolejność insertów bez transakcji (częściowy błąd) |
| 3. Read/list API | toggle + GET books + book_count | regres perf listy półek (count w pętli) |
| 4. Review UI | akcje + bulk + manual w `DetectionReview` | stan per-detekcja po decyzji |
| 5. Widok półki | BookCard + island + `/shelves/[id]` | optimistic toggle rollback |
| 6. E2E | golden path Flow A (mock) | kompletność mocków decyzyjnych tras |

**Prerequisites:** S-04 zarchiwizowany (✓); lokalny stack Supabase do testu migracji.
**Estimated effort:** ~5-6 sesji (6 faz), backend lżejszy, UI + E2E cięższe.

## Open Risks & Assumptions

- Brak transakcji multi-statement w Supabase REST — kolejność insertów dobrana tak, by częściowy błąd zostawiał spójny, retry-bezpieczny stan.
- `database.types.ts` regen wymaga lokalnego stacku; offline fallback = ręczny dopis `is_read`.
- Migracja na prod dopiero po merge (`supabase db push`) — testy w branchu na Vitest mocks + lokalny stack.

## Success Criteria (Summary)

- Użytkownik akceptuje (bulk + pojedynczo + correct + manual), odrzuca propozycje; zaakceptowane książki widać na półce z okładkami w kolejności od lewej.
- Toggle „przeczytana" działa 1-klik i persystuje; exact-duplicate blokowany komunikatem.
- Każda decyzja ma wiersz telemetrii; E2E golden path zielony (mock).
