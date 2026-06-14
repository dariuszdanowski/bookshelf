# Metadane zakupu książki — Plan Brief

> Full plan: `context/changes/book-purchase-metadata/plan.md`

## What & Why

Dodajemy opcjonalne atrybuty zakupu do każdej książki: datę (już w DB), cenę (PLN), miasto
i wydarzenie (np. „Targi Książki Warszawa"). Użytkownik może wpisywać je per-książka w
BookModal lub hurtowo w panelu na stronie photo review — wtedy data/miasto/wydarzenie
propagują automatycznie do każdej zatwierdzonej książki ze zdjęcia. Biblioteka (/library)
dostaje nowe filtry wyszukiwania po tych atrybutach. Slice jest prerequisite dla M8
`purchase-add-book-merge` (unifikacja „Dodaj zakup" z BookModal).

## Starting Point

Tabela `books` ma już `purchase_date` (nullable, ustawiany tylko przez Flow B). Brak
`purchase_price`, `purchase_city`, `purchase_event`. Tabela `photos` nie ma żadnych
purchase_* kolumn. `BookModal` nie pokazuje pól zakupu. Search filters nie znają zakupu.

## Desired End State

Każda książka może mieć cenę/miasto/wydarzenie zakupu — edytowalne w BookModal. Na
`/photos/[id]` nowy panel „Informacje o zakupie tej partii" zapisuje te dane na zdjęciu
i propaguje je do potwierdzanych książek. Biblioteka filtruje po wydarzeniu (dropdown z
unikalnych wartości), mieście (freetext), zakresie dat i zakresie ceny.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Source |
|---|---|---|---|
| Schema | Kolumny na books + photos | Spójne z istniejącym purchase_date; 1 zakup/książka | Plan |
| Cena propagacja | NIE propaguje ze zdjęcia → per-książka | Cena jest indywidualna | Plan |
| Waluta | PLN, numeric(10,2) | Kolekcja jednego usera = jedna waluta | Plan |
| search_text | Rozszerzony o purchase_city + purchase_event | q= też szuka po lokalizacji zakupu | Plan |
| Photo panel | Persystowane w photos DB, nie in-memory | Przeżywa reload strony | Plan |
| Filtry biblioteki | Dropdown event + city freetext + date range + price range | Użyteczne dla powracających targów | Plan |
| Autocomplete | GET /api/books/purchase-hints?type=event|city | Jeden endpoint, dwa użytki | Plan |
| Confirm propagacja | confirm + confirm-batch + correct → kopiują photo.purchase_* | Wszystkie ścieżki tworzące books | Plan |

## Scope

**In scope:**
- 3 nowe kolumny na books (purchase_price, purchase_city, purchase_event)
- 3 nowe kolumny na photos (purchase_date, purchase_city, purchase_event)
- Rebuild search_text GENERATED COLUMN (include purchase_city, purchase_event)
- PATCH /api/books/[id] i PATCH /api/photos/[id] — obsługa nowych pól
- Propagacja date/city/event ze zdjęcia przy confirm/batch/correct
- GET /api/books/purchase-hints?type=event|city
- BookModal — sekcja PurchaseSection (add + edit mode)
- /photos/[id] — PhotoPurchasePanel (collapsible, auto-save)
- CatalogSearchIsland — 4 nowe filtry
- GET /api/books/search — filtry purchase_event/city/date_from-to/price_min-max
- E2E testy: 5 scenariuszy

**Out of scope:**
- Wielowalutowość
- Historia zakupów (wiele zakupów per-książka)
- Panel statystyk wydatków / timeline
- Eksport CSV
- M8 purchase-add-book-merge

## Architecture / Approach

Migracja 0026 dodaje kolumny do obu tabel i przebudowuje `books_search_text` (DROP/CREATE
wzorzec z 0019). Warstwa API rozszerzana w miejscu — nowe pola opcjonalne w schematach Zod,
propagacja w istniejących confirm/batch/correct endpoint-ach przez rozszerzenie SELECT photo.
Dwa nowe komponenty React (`PurchaseSection`, `PhotoPurchasePanel`) + integracja z BookModal
i photos/[id].astro. Autocomplete przez dedykowany endpoint hints. Filtry search: nowe query
params w SearchBooksQuerySchema + warunkowe `.eq/.ilike/.gte/.lte` w 2-step books query.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migracja DB | `books` i `photos` mają purchase_* kolumny; search_text rozszerzony | Rebuild GENERATED STORED wymaga DROP/CREATE — wzorzec sprawdzony w 0019 |
| 2. Warstwa API | Wszystkie endpointy propagują / filtrują purchase info; endpoint hints | Ręczna edycja database.types.ts (bez żywej DB w branchu) |
| 3. BookModal UI | Użytkownik edytuje purchase per-książka; autocomplete | BookModal jest największym komponentem w repo (782 linie) |
| 4. Photo panel + filtry + E2E | Full flow photo → confirm propaguje; filtry w /library; 5 E2E | DetectionReview island + nowy panel — kolejność mount i fetch hints |

**Prerequisites:** Brak zewnętrznych; plan samodzielny.
**Estimated effort:** ~3-4 sesje, 4 fazy.

## Open Risks & Assumptions

- Ręczna edycja `database.types.ts` może być niekompletna — po `db push` na prod wymagana
  regeneracja `supabase gen types` i follow-up commit.
- `correct.ts` też tworzy books row (weryfikuj w Phase 2 że fetches photo.purchase_*).
- `PhotoPurchasePanel` auto-save debounced 600ms — jeśli user potwierdza książkę zanim
  debounce się spłucze, purchase info może nie być jeszcze na photos row.

## Success Criteria (Summary)

- Wpisanie purchase info w BookModal edit → pole w Supabase Studio zaktualizowane.
- Photo z purchase_city = „Kraków" → każda potwierdzona z niej książka ma `purchase_city = „Kraków"`.
- `/library` filtr Wydarzenie zwraca tylko książki z danego eventu; filtry dat/ceny działają.
