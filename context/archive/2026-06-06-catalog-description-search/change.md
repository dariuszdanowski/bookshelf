---
change_id: catalog-description-search
roadmap_slice: S-17
status: archived
created: 2026-06-06
updated: 2026-06-06
archived_at: 2026-06-06T20:26:58Z
---

# S-17 — Opis z bazy publicznej w full-text search

Full-text search (`/library`, FR-032) obejmuje „krótki opis z publicznej bazy":
capture `description` z Google Books w kliencie S-04, persystencja w
`book_candidates` + `books`, propagacja przez wszystkie ścieżki tworzenia/aktualizacji
książki (confirm, confirm-batch, identify, manualny POST z kandydata), rozszerzenie
GENERATED kolumny `search_text` o opis. Ostatni otwarty kawałek PRD MVP.

Świadome cięcia: bulk re-fetch backfill (rate limit GB; per-book refresh przez
istniejące `identify`), ekspozycja opisu w UI (follow-up), capture z OpenLibrary/BN
(wymagałby dodatkowych requestów / brak danych w źródle).
