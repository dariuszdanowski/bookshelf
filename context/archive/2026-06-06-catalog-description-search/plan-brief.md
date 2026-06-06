# S-17 Catalog Description Search — Plan Brief

> Full plan: `context/changes/catalog-description-search/plan.md`

## What & Why

Pełnotekstowa wyszukiwarka `/library` ma objąć „krótki opis z publicznej bazy" — ostatni otwarty kawałek FR-032 i całego PRD MVP. Użytkownik znajdzie książkę po motywie fabularnym („coś o smokach"), nie tylko po tytule/autorze/wydawcy. Opis był świadomie wycięty z S-08 jako follow-up.

## Starting Point

S-08 dostarczył `search_text` (GENERATED STORED: title+authors+publisher, IMMUTABLE helper, escaped ILIKE) i działającą wyszukiwarkę. Opis NIE jest dziś capture'owany nigdzie: klienci S-04 go nie pobierają, tabele nie mają kolumny, ścieżki confirm/identify go nie przenoszą.

## Desired End State

Nowo potwierdzane książki mają opis z Google Books; fraza występująca tylko w opisie znajduje książkę w `/library`; stare książki zyskują opis przy ręcznym „Wyszukaj po danych" (identify). Zero zmian w UI wyszukiwarki — działa „w tle".

## Key Decisions Made

| Decyzja | Wybór | Dlaczego |
| --- | --- | --- |
| Źródło opisu | Tylko Google Books | `description` jest w tej samej odpowiedzi search (zero dodatkowych requestów); OL wymaga 2. requestu `/works` per kandydat, BN nie ma opisów |
| Backfill istniejących książek | **Bez bulk re-fetch**; per-book przez „Wyszukaj po danych" w trybie edit BookModal (PATCH) | N wywołań GB = rate limit; `book_candidates` nie ma danych do backfillu; BookModal edit już nadpisuje metadane z kandydata — opis dołącza po nawleczeniu pola. ⚠ adaptacja vs literalny Outcome roadmapy; uwaga: `identify` endpoint okazał się martwy z UI (plan-review F1) |
| Długość opisu | Truncate do 2000 znaków przy capture | „Krótki opis" z PRD; STORED search_text rośnie per wiersz; GB potrafi zwrócić wielotysięczne teksty |
| Zmiana GENERATED | DROP COLUMN → DROP FUNCTION → CREATE 4-arg → ADD COLUMN | GENERATED nie da się ALTER-ować; ADD przelicza wszystkie wiersze (darmowy „backfill" search_text); pattern IMMUTABLE helper z 0011 |
| Dowód poprawności | Test integracyjny na realnej DB (CI) | Unit mock GENERATED kolumny to tautologia; CI `supabase start` waliduje migrację pre-merge |
| UI | Zero zmian (ekspozycja opisu = follow-up) | Slice domyka FR-032; wyświetlanie/edycja opisu to osobna wartość |
| Mechanika search | Bez zmian (escaped ILIKE) | NFR p95 < 1 s na ~1000 rekordów/user spełnione wzorcem S-08; tsvector/GIN = przedwczesna optymalizacja |

## Scope

**In scope:** migracja 0019 (kolumny + funkcja 4-arg + search_text v2), capture w googleBooks.ts (truncate 2000), `BookCandidate.description`, persist w pipeline match, propagacja: confirm, confirm-batch, identify, manualny POST (opis tylko z kandydata), testy unit + integracyjny.

**Out of scope:** bulk re-fetch backfill, UI opisu (wyświetlanie/edycja), capture z OpenLibrary/BN, zmiana mechaniki wyszukiwania.

## Architecture / Approach

```
Google Books search ──description──▶ BookCandidate ──▶ book_candidates (match pipeline)
                                          │
            confirm / confirm-batch / identify / POST(z kandydata)
                                          ▼
                            books.description ──(GENERATED)──▶ search_text ──ILIKE──▶ /library
```

DB-first: faza 2 typowana na kolumnach z fazy 1; `database.types.ts` dopisany ręcznie (regen z żywej DB post-merge).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Substrat DB + dowód integracyjny | Kolumny, search_text v2, test na realnej bazie | Kolejność DROP/CREATE w migracji; 42P17 przy utracie IMMUTABLE |
| 2. Capture + propagacja + testy | Opis płynie GB→candidates→books wszystkimi ścieżkami | Pominięcie którejś ścieżki zapisu (4 miejsca); typ wymusza decyzję w każdym mapperze |

**Prerequisites:** brak (S-08 done; branch `change/catalog-description-search` założony)
**Estimated effort:** ~1 sesja, 2 fazy (migracja jest mała; propagacja to mechaniczne 6–8 plików + testy)

## Open Risks & Assumptions

- Zakładamy, że `volumeInfo.description` jest obecne dla sensownego odsetka polskich książek w GB — jeśli pokrycie okaże się niskie, wartość featuru spada (telemetrii nie dodajemy; ocena na realnej kolekcji usera).
- Adaptacja scope: brak bulk backfillu — Outcome S-17 w roadmapie do korekty przy `/10x-archive`.

## Success Criteria (Summary)

- Fraza obecna tylko w opisie znajduje książkę w `/library` (dowód: test integracyjny na realnej DB + manual post-merge)
- Wszystkie 4 ścieżki zapisu książki przenoszą opis (dowód: testy unit)
- Zero regresji: pełna suita unit + integracja + E2E zielona
